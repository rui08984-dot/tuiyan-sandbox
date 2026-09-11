'use strict';
/**
 * p1b/src/lib/oracleCast.js —— 独立玄学排盘「起卦三法」（p9 W1：时间起卦 + 随机起卦 + 数字起卦 wrapper）。
 *
 * 边界铁律（P8 拍板③，与 lib/oracle.js 同一字面，写死在代码里）：
 *   本模块只做「纯数学排盘」（架构口径 docs/specs/2026-09-07-推演沙盘-design.md §2.3）。
 *   「梅花查狼」实验（docs/sandbox/p2-yijing/oracle-experiment-result.md）已证判词
 *   无任何游戏研判效力 → 本功能是娱乐排盘，输出恒挂「娱乐参考」标注，
 *   绝不接入任何游戏研判功能；本模块返回值禁止被参谋/研判类模块引用。
 *
 * 【为何存在】meihua.js README（docs/sandbox/p2-yijing/README.md）Out-of-scope 明示
 *   「时间起卦（需农历/节气转换，后续接历法库再补）」——本模块即补这块：
 *   接 lunar-javascript（MIT，纯 JS，公历→农历年月日+时辰地支；2026-09-10 决策采
 *   npm 依赖而非手写农历压缩表，理由：纯 JS 零原生依赖、公开历表锚点实测全对
 *   ——中秋/春节/闰六月/年界/晚子时五组核验见 docs/sandbox/p1b/itest/p9-anchor-probe-out.txt）。
 *   卦理推导全部转调 meihua.qiGuaByNumbers，meihua.js 本体零改动零复制（P8 铁律）。
 *
 * ── 时间起卦口径（写死于此；出处与分歧逐条标注，不静默选边）────────────────
 *   取值（按本机本地时区的公历时刻 → 农历分量）：
 *     年支数 = 农历年地支序数，子1 丑2 … 亥12（1 基）；
 *     月数   = 农历月数 1..12（闰X月按本宫 X 计；lunar-javascript 以负数记闰月，取绝对值）；
 *     日数   = 农历日数，初一=1 … 三十=30；
 *     时支数 = 时辰地支序数，子1 … 亥12（23:00 起子时）。
 *   通行本《梅花易数》卷一「年月日时起例」（题宋·邵雍撰，明刊本体系；与 meihua.js
 *   README「所采规则与出处」同一口径家族）：
 *     上卦 = (年支+月+日) % 8 余0取8；下卦 = (年支+月+日+时支) % 8 余0取8；
 *     动爻 = (年支+月+日+时支) % 6 余0取6。
 *   本实现两数派生（喂给既有 qiGuaByNumbers，保持全产品唯一起卦管线）：
 *     数A = 年支数 + 月数 + 日数   → rem8(A) = 通行本上卦 ✓
 *     数B = 数A + 时支数           → rem8(B) = 通行本下卦 ✓
 *   已知分歧（如实标注）：动爻沿用 qiGuaByNumbers 统一规则 rem6(A+B)，
 *     即 rem6(2·(年月日)+时支)，与通行本 rem6(年月日+时支) 不同——因 meihua.js 本体
 *     禁改（P8 铁律：扩展只走新文件 wrapper），且「同一对两数在任何入口下同动爻」
 *     的产品内一致性优先；上/下卦（决定本/互/变卦主体展示）与通行本一致。
 *     任务书所述「月数作上卦、日数作下卦」为民间简法变体，与通行本卷一
 *     「年月日时起例」不符，未采用（核验脚本 docs/sandbox/p1b/itest/p9-anchor-probe.cjs 留档）。
 *   流派分歧（lunar-javascript 1.7.7 默认行为，公开历表事实实测冻结）：
 *     - 年界：按农历正月初一换年（2026-02-05 立春后春节前实测年支=巳，非立春界的午）；
 *       立春换年派可用 Lunar#getYearZhiByLiChun 另换，本实现不采用。
 *     - 闰月：闰X月按本宫X月计（2025-08-01 实测月=-6 → 取 6）；
 *       「闰月前半归上月/后半归下月」派未采用。
 *     - 晚子时：23:00-23:59 子时按当日计（2026-09-25 23:30 实测日仍十五、时支=子）；
 *       「晚子时换日」派未采用。
 *
 * ── 随机起卦口径（写死于此）────────────────────────────────────────────────
 *   两数各 = crypto.randomInt(1, 513)（含1不含513 → 1..512 均匀，CSPRNG）。
 *   取 1..512：与判词线哈希派生数域一致（lib/oracle.js 同为 %512+1）；512=8×64，
 *   数 %8 完全均匀；动爻 rem6(A+B) 因 512 ≡ 2 (mod 6) 存在 <1% 分布微偏（娱乐参考
 *   可接受，如实标注）。任务书备选「1-8/1-8/1-6 分层」因既有 qiGuaByNumbers 只收
 *   两数（动爻恒由 A+B 派生，无法注入独立 1-6）而弃用——保证三法同一条卦理管线。
 *   CSPRNG 只取「不可预测且无偏」性质，无安全语义（娱乐排盘）。
 *   randomIntFn 注入缝：测试可注入确定性伪随机（形状与确定性结构可测）。
 */
const crypto = require('crypto');
const path = require('path');
const meihua = require(path.join(__dirname, 'meihua.js'));
const { DISCLAIMER } = require('./oracle'); // 恒挂标注唯一来源（lib/oracle.js），不另立字符串

/** 地支序数（1 基，通行数卦口径）：子1 丑2 寅3 卯4 辰5 巳6 午7 未8 申9 酉10 戌11 亥12 */
const ZHI_NUMBER = { 子: 1, 丑: 2, 寅: 3, 卯: 4, 辰: 5, 巳: 6, 午: 7, 未: 8, 申: 9, 酉: 10, 戌: 11, 亥: 12 };

const RANDOM_MIN = 1;
const RANDOM_MAX = 512;

let lunarLibCache = null;
/** lunar-javascript 惰性加载：数字/随机起卦不依赖历法库；缺依赖时给可操作的报错而非顶层炸模块 */
function getLunarLib() {
  if (lunarLibCache) return lunarLibCache;
  try {
    lunarLibCache = require('lunar-javascript');
  } catch (e) {
    throw new Error('时间起卦需要历法库 lunar-javascript（p1b 下 npm install lunar-javascript）：'
      + (e && e.message ? e.message : e));
  }
  return lunarLibCache;
}

function lunarVersion() {
  try { return require('lunar-javascript/package.json').version || 'unknown'; } catch (e) { return 'unknown'; }
}

/** 本地时区 'YYYY-MM-DDTHH:mm:ss'（无时区后缀 = 本地 civil time；排盘输入留档用） */
function toLocalIso(d) {
  const p2 = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
    + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
}

/**
 * 公历 Date → 农历分量投影（时间起卦输入留档 + 测试缝）。口径与分歧见文件头注释。
 * @returns {{lunar_year:number, lunar_month:number, leap_month:boolean, lunar_day:number,
 *            year_zhi:string, year_zhi_number:number, hour_zhi:string, hour_zhi_number:number,
 *            local_time:string, calendar:string}}
 */
function lunarComponents(date) {
  const Lunar = getLunarLib().Lunar;
  if (!Lunar || typeof Lunar.fromDate !== 'function') {
    throw new Error('lunar-javascript 形状不符：缺 Lunar.fromDate');
  }
  const l = Lunar.fromDate(date);
  const monthRaw = l.getMonth(); // 闰月为负（实测 2025-08-01 → -6）
  const yearZhi = l.getYearZhi();
  const hourZhi = l.getTimeZhi();
  if (!ZHI_NUMBER[yearZhi] || !ZHI_NUMBER[hourZhi]) {
    throw new Error('历法库返回了未知地支: yearZhi=' + yearZhi + ' hourZhi=' + hourZhi);
  }
  const monthNum = Math.abs(monthRaw);
  if (!(monthNum >= 1 && monthNum <= 12) || !(l.getDay() >= 1 && l.getDay() <= 30)) {
    throw new Error('历法库返回了越界农历月/日: month=' + monthRaw + ' day=' + l.getDay());
  }
  return {
    lunar_year: l.getYear(),
    lunar_month: monthNum,
    leap_month: monthRaw < 0,
    lunar_day: l.getDay(),
    year_zhi: yearZhi,
    year_zhi_number: ZHI_NUMBER[yearZhi],
    hour_zhi: hourZhi,
    hour_zhi_number: ZHI_NUMBER[hourZhi],
    local_time: toLocalIso(date),
    calendar: 'lunar-javascript@' + lunarVersion(),
  };
}

/**
 * 时间起卦：公历时刻 → 年支数+农历月数+日数（数A）、再加时支数（数B）→ 既有 qiGuaByNumbers。
 * 口径与分歧见文件头注释（不在此重复）。
 * @param {Date} date 任意有效公历时刻（按本地时区取农历分量）
 */
function castByTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('castByTime: 需要有效的 Date，收到: ' + String(date));
  }
  const comp = lunarComponents(date);
  const a = comp.year_zhi_number + comp.lunar_month + comp.lunar_day; // 上卦数（通行本：年+月+日）
  const b = a + comp.hour_zhi_number;                                  // 下卦数（通行本：再加时支）
  const casting = meihua.qiGuaByNumbers(a, b); // 卦理唯一来源（动爻口径分歧见头注释，如实标注）
  return Object.assign({}, casting, {
    numbers: { a: a, b: b },
    derived_from: Object.assign({ method: 'time' }, comp),
  });
}

function defaultRandomInt(min, maxInclusive) {
  return crypto.randomInt(min, maxInclusive + 1);
}

/**
 * 随机起卦：CSPRNG 派生两数（1..512）→ 既有 qiGuaByNumbers。口径见文件头注释。
 * @param {(min:number, maxInclusive:number)=>number} [randomIntFn] 测试注入缝（缺省 crypto.randomInt）
 */
function castByRandom(randomIntFn) {
  const rand = typeof randomIntFn === 'function' ? randomIntFn : defaultRandomInt;
  const a = rand(RANDOM_MIN, RANDOM_MAX);
  const b = rand(RANDOM_MIN, RANDOM_MAX);
  for (const pair of [['A', a], ['B', b]]) {
    const label = pair[0], v = pair[1];
    if (!Number.isInteger(v) || v < RANDOM_MIN || v > RANDOM_MAX) {
      throw new RangeError('castByRandom: 随机数' + label + '越界(' + RANDOM_MIN + '..' + RANDOM_MAX + '): ' + String(v));
    }
  }
  const casting = meihua.qiGuaByNumbers(a, b);
  return Object.assign({}, casting, {
    numbers: { a: a, b: b },
    derived_from: {
      method: 'random',
      source: typeof randomIntFn === 'function' ? 'injected' : 'crypto.randomInt',
      domain: '1..512',
    },
  });
}

/**
 * 数字起卦 wrapper：卦理与既有数字口径完全一致（仅补 numbers/derived_from 留档壳），
 * 数值合法性（≥1 整数）由 meihua.qiGuaByNumbers 自校验透传。
 */
function castByNumbers(a, b) {
  const casting = meihua.qiGuaByNumbers(a, b);
  return Object.assign({}, casting, {
    numbers: { a: a, b: b },
    derived_from: { method: 'numbers', source: 'manual' },
  });
}

module.exports = {
  castByNumbers, castByTime, castByRandom, lunarComponents,
  ZHI_NUMBER, RANDOM_MIN, RANDOM_MAX, DISCLAIMER, toLocalIso,
};

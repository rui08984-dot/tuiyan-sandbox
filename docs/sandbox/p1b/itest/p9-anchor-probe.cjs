'use strict';
/**
 * p9-anchor-probe.cjs —— 时间起卦历法锚点探测（p9 W1 一次性脚本，留档可复跑）。
 * 目的：在写死测试锚点前，用已知公历事实交叉核验 lunar-javascript 的口径：
 *   1) 2026-09-25 = 中秋节（农历八月十五）——公开历表事实
 *   2) 2026-02-17 = 春节（正月初一）、2025-01-29 = 春节——公开历表事实
 *   3) 2025-08-01 落闰六月（2025 闰六月）——公开历表事实，验证闰月负数记法
 *   4) 2026-02-05（立春 02-04 之后、春节 02-17 之前）——探测 getYearZhi 年界口径
 *      （正月初一换年 → 巳；立春换年 → 午），实测后把口径写死进 lib 注释与测试
 *   5) 2026-09-25 23:30 晚子时——探测日数/时支取法（默认 sect）
 * 并打印按「年支+月+日 / +时支」两数法派生的起卦结果（meihua.qiGuaByNumbers 直验）。
 * 报告写入同目录 p9-anchor-probe-out.txt（UTF-8，避免 pwsh 重定向编码搅扰）。
 */
const fs = require('fs');
const path = require('path');
const P1B = 'E:/music player/p1b';
const lunar = require(path.join(P1B, 'node_modules', 'lunar-javascript'));
const meihua = require(path.join(P1B, 'src', 'lib', 'meihua.js'));
const Lunar = lunar.Lunar;

const ZHI_NUM = { 子: 1, 丑: 2, 寅: 3, 卯: 4, 辰: 5, 巳: 6, 午: 7, 未: 8, 申: 9, 酉: 10, 戌: 11, 亥: 12 };
const lines = [];
const log = (s) => { lines.push(s); };

function show(label, d) {
  const l = Lunar.fromDate(d);
  const yz = l.getYearZhi(), hz = l.getTimeZhi();
  const m = l.getMonth(), day = l.getDay();
  const leap = m < 0;
  const a = ZHI_NUM[yz] + Math.abs(m) + day;
  const b = a + ZHI_NUM[hz];
  const c = meihua.qiGuaByNumbers(a, b);
  log(label
    + ' | 农历: 年=' + l.getYear() + ' 月=' + m + (leap ? '(闰)' : '') + ' 日=' + day
    + ' 年干支=' + l.getYearInGanZhi() + ' 年支=' + yz + '(数' + ZHI_NUM[yz] + ')'
    + ' 时支=' + hz + '(数' + ZHI_NUM[hz] + ')'
    + ' | 两数: A=' + a + ' B=' + b
    + ' → 本卦=' + c.benGua.fullName + ' 互卦=' + c.huGua.fullName
    + ' 变卦=' + c.bianGua.fullName + ' 动爻=' + c.dongYao
    + ' 体=' + c.ti.trigram + c.ti.wuXing + ' 用=' + c.yong.trigram + c.yong.wuXing
    + ' ' + c.tiYongRelation);
}

log('== lunar-javascript 口径探测（本机时区运行，Date 用本地分量构造） ==');
show('A 2026-09-25 12:00 （锚:应八月十五·中秋）      ', new Date(2026, 8, 25, 12, 0, 0));
show('B 2026-02-17 00:00 （锚:应正月初一·春节）      ', new Date(2026, 1, 17, 0, 0, 0));
show('C 2025-08-01 12:00 （锚:应闰六月·m=-6）        ', new Date(2025, 7, 1, 12, 0, 0));
show('D 2026-02-05 12:00 （立春后春节前:探年界口径）  ', new Date(2026, 1, 5, 12, 0, 0));
show('E 2026-09-25 23:30 （晚子时:探日界/时支）      ', new Date(2026, 8, 25, 23, 30, 0));
show('F 2025-01-29 12:00 （锚:应正月初一·2025春节）  ', new Date(2025, 0, 29, 12, 0, 0));
show('G 2026-09-10 12:00 （拍板日,留档对照）         ', new Date(2026, 8, 10, 12, 0, 0));

const l2 = Lunar.fromDate(new Date(2026, 8, 25, 12, 0, 0));
log('');
log('API 形状: typeof getMonth()=' + typeof l2.getMonth() + ' typeof getDay()=' + typeof l2.getDay()
  + ' typeof getYear()=' + typeof l2.getYear() + ' getYearZhi()=' + l2.getYearZhi()
  + ' getTimeZhi()=' + l2.getTimeZhi()
  + ' has getTimeZhiIndex=' + (typeof l2.getTimeZhiIndex)
  + ' has getYearZhiByLiChun=' + (typeof l2.getYearZhiByLiChun));
log('package 版本: ' + require(path.join(P1B, 'node_modules', 'lunar-javascript', 'package.json')).version);
log('meihua 直验 A=30,B=37 → ' + meihua.qiGuaByNumbers(30, 37).benGua.fullName + ' 动' + meihua.qiGuaByNumbers(30, 37).dongYao);
log('');
log('期望核对（公开历表事实）: A 月=8 日=15（中秋）; B 月=1 日=1; C 月=-6; F 月=1 日=1;');
log('  D 年支: 巳=正月初一换年口径 / 午=立春换年口径（实测后写死）; E 时支=子、日仍 25（默认晚子时口径）');

const report = lines.join('\r\n') + '\r\n';
fs.writeFileSync(path.join(__dirname, 'p9-anchor-probe-out.txt'), report, 'utf8');
console.log('[probe done] ' + lines.length + ' lines -> p9-anchor-probe-out.txt');

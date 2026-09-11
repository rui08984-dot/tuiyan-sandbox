'use strict';
/**
 * meihua.js — 梅花易数「确定层」起卦模块（AI 推演沙盘 P2 · 易经）
 *
 * 纯 Node、零依赖、CommonJS。只做确定性推导：数字 → 本卦/互卦/变卦/动爻/体用/五行生克。
 * 不做吉凶断语（属推断层）。规则出处与流派分歧见同目录 README.md（"规则分歧"节明列，不静默选边）。
 *
 * 约定：
 *   - 爻序自下而上：数组第 0 位是初爻（第 1 爻），第 5 位是上爻（第 6 爻）。
 *   - 阳 = 1，阴 = 0。
 *   - 先天八卦数：乾1 兑2 离3 震4 巽5 坎6 艮7 坤8。
 *   - 上卦 = 数A % 8（余 0 取 8）；下卦 = 数B % 8（余 0 取 8）；动爻 = (数A+数B) % 6（余 0 取 6）。
 */

// ---------------------------------------------------------------------------
// 先天八卦：数、三爻（自下而上）、取象
// ---------------------------------------------------------------------------

/** 先天八卦数（伏羲先天卦数，通行本《梅花易数》口径） */
const TRIGRAM_NUMBERS = { 乾: 1, 兑: 2, 离: 3, 震: 4, 巽: 5, 坎: 6, 艮: 7, 坤: 8 };

/** 数 → 卦名（下标 1~8 对应先天数，0 号位弃用） */
const NUMBER_TRIGRAMS = ['', '乾', '兑', '离', '震', '巽', '坎', '艮', '坤'];

/** 经卦三爻，自下而上（阳=1 阴=0） */
const TRIGRAM_YAO = {
  乾: [1, 1, 1],
  兑: [1, 1, 0], // 下两爻阳、上爻阴
  离: [1, 0, 1],
  震: [1, 0, 0], // 初爻阳
  巽: [0, 1, 1], // 初爻阴
  坎: [0, 1, 0],
  艮: [0, 0, 1], // 上爻阳
  坤: [0, 0, 0],
};

/** 八卦取象（组成"火风鼎"式全名用） */
const TRIGRAM_IMAGE = { 乾: '天', 兑: '泽', 离: '火', 震: '雷', 巽: '风', 坎: '水', 艮: '山', 坤: '地' };
// ---------------------------------------------------------------------------
// 五行
// ---------------------------------------------------------------------------

/** 经卦五行：乾兑金、离火、震巽木、坎水、艮坤土 */
const TRIGRAM_WUXING = { 乾: '金', 兑: '金', 离: '火', 震: '木', 巽: '木', 坎: '水', 艮: '土', 坤: '土' };

/** 相生循环：金→水→木→火→土→金（SHENG[x] = x 所生之行） */
const SHENG = { 金: '水', 水: '木', 木: '火', 火: '土', 土: '金' };

/** 相克循环：金→木→土→水→火→金（KE[x] = x 所克之行） */
const KE = { 金: '木', 木: '土', 土: '水', 水: '火', 火: '金' };

// ---------------------------------------------------------------------------
// 64 卦名表：GUANAMES[上卦][下卦] → 卦名（通行本《周易》卦名）
// ---------------------------------------------------------------------------

const GUANAMES = {
  乾: { 乾: '乾', 兑: '履', 离: '同人', 震: '无妄', 巽: '姤', 坎: '讼', 艮: '遁', 坤: '否' },
  兑: { 乾: '夬', 兑: '兑', 离: '革', 震: '随', 巽: '大过', 坎: '困', 艮: '咸', 坤: '萃' },
  离: { 乾: '大有', 兑: '睽', 离: '离', 震: '噬嗑', 巽: '鼎', 坎: '未济', 艮: '旅', 坤: '明夷' },
  震: { 乾: '大壮', 兑: '归妹', 离: '丰', 震: '震', 巽: '恒', 坎: '解', 艮: '小过', 坤: '豫' },
  巽: { 乾: '小畜', 兑: '中孚', 离: '家人', 震: '益', 巽: '巽', 坎: '涣', 艮: '渐', 坤: '观' },
  坎: { 乾: '需', 兑: '节', 离: '既济', 震: '屯', 巽: '井', 坎: '坎', 艮: '蹇', 坤: '比' },
  艮: { 乾: '大畜', 兑: '损', 离: '贲', 震: '颐', 巽: '蛊', 坎: '蒙', 艮: '艮', 坤: '剥' },
  坤: { 乾: '泰', 兑: '临', 离: '明夷', 震: '复', 巽: '升', 坎: '师', 艮: '谦', 坤: '坤' },
};
// ---------------------------------------------------------------------------
// 基础函数
// ---------------------------------------------------------------------------

/** 以八除取余，余 0 作 8（通行"卦以八除"口径） */
function rem8(n) {
  const r = n % 8;
  return r === 0 ? 8 : r;
}

/** 以六除取余，余 0 作 6（通行"爻以六除"口径） */
function rem6(n) {
  const r = n % 6;
  return r === 0 ? 6 : r;
}

/** 先天数（任意正整数，内部以八除取余）→ 经卦名 */
function trigramFromNumber(n) {
  return NUMBER_TRIGRAMS[rem8(n)];
}

/** 三爻数组（自下而上）→ 经卦名 */
function trigramFromYao(y3) {
  for (const [name, yao] of Object.entries(TRIGRAM_YAO)) {
    if (yao[0] === y3[0] && yao[1] === y3[1] && yao[2] === y3[2]) return name;
  }
  throw new Error('非法三爻数组: ' + JSON.stringify(y3));
}

function assertPositiveInt(n, label) {
  if (!Number.isInteger(n) || n < 1) {
    throw new TypeError(label + ' 必须是 ≥1 的整数，收到: ' + String(n));
  }
}

/** 由上下经卦名组装一卦（含卦名、全名、六爻阴阳数组） */
function makeGua(upperName, lowerName) {
  const yao = TRIGRAM_YAO[lowerName].concat(TRIGRAM_YAO[upperName]);
  const name = GUANAMES[upperName][lowerName];
  const fullName = upperName === lowerName
    ? name + '为' + TRIGRAM_IMAGE[upperName] // 八纯卦：乾为天、坤为地……
    : TRIGRAM_IMAGE[upperName] + TRIGRAM_IMAGE[lowerName] + name; // 如 火风鼎
  return {
    name, // 卦名
    fullName, // 上象+下象+卦名（八纯卦为"X为Y"式）
    upper: upperName, // 上卦（经卦名）
    lower: lowerName, // 下卦（经卦名）
    yao, // 六爻，自下而上，阳=1 阴=0
    yinYang: yao.map((v) => (v === 1 ? '阳' : '阴')), // 六爻阴阳文字数组
  };
}
/**
 * 五行关系（a 对 b）：比和 / 我生（a生b）/ 生我（b生a）/ 我克（a克b）/ 克我（b克a）
 */
function wuXingRelation(a, b) {
  if (a === b) return '比和';
  if (SHENG[a] === b) return '我生';
  if (SHENG[b] === a) return '生我';
  if (KE[a] === b) return '我克';
  if (KE[b] === a) return '克我';
  throw new Error('非法五行对: ' + a + ',' + b);
}

/** 体用生克关系五分类（体五行对用五行，梅花通行口径） */
function tiYongGuanxi(tiWuXing, yongWuXing) {
  switch (wuXingRelation(tiWuXing, yongWuXing)) {
    case '比和': return '体用比和';
    case '我生': return '体生用';
    case '生我': return '用生体';
    case '我克': return '体克用';
    case '克我': return '用克体';
    default: throw new Error('unreachable: ' + tiWuXing + ',' + yongWuXing);
  }
}

// ---------------------------------------------------------------------------
// 起卦主流程
// ---------------------------------------------------------------------------

/**
 * 数字起卦（通行两数起卦法）。
 * 数A → 上卦 = a % 8（余0取8）；数B → 下卦 = b % 8（余0取8）；
 * 动爻 = (a + b) % 6（余0取6），爻序自下而上 1~6。
 */
function qiGuaByNumbers(a, b) {
  assertPositiveInt(a, '数A');
  assertPositiveInt(b, '数B');
  const upperName = trigramFromNumber(a);
  const lowerName = trigramFromNumber(b);
  const dongYao = rem6(a + b);
  return deriveGua(upperName, lowerName, dongYao);
}

/**
 * 总数起卦：把 total 拆成两个正整数再走两数起卦。
 * 默认拆法：对半拆 a = floor(total/2)、b = total - a（模块自定口径，README 有记）。
 * 传入 splitFn(total) => [a, b] 可自定义拆法（"拆 total 为两数由调用方决定"）。
 */
function qiGuaByTotal(total, splitFn) {
  assertPositiveInt(total, 'total');
  if (total < 2) {
    throw new RangeError('total 必须 ≥ 2（需能拆成两个 ≥1 的整数）');
  }
  let a, b;
  if (typeof splitFn === 'function') {
    const pair = splitFn(total);
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new TypeError('splitFn 必须返回 [a, b] 二元数组');
    }
    a = pair[0];
    b = pair[1];
  } else {
    a = Math.floor(total / 2);
    b = total - a;
  }
  return qiGuaByNumbers(a, b);
}
/**
 * 由上卦名、下卦名、动爻（1~6）推出完整卦象结构。
 * 本卦 → 互卦（取本卦 2,3,4 爻为下卦、3,4,5 爻为上卦）→ 变卦（动爻阴阳互变）。
 * 体用：动爻所在经卦为"用"，另一经卦为"体"（动爻在初~三爻属下卦，四~六爻属上卦）。
 */
function deriveGua(upperName, lowerName, dongYao) {
  if (!Number.isInteger(dongYao) || dongYao < 1 || dongYao > 6) {
    throw new RangeError('动爻必须是 1~6 的整数，收到: ' + String(dongYao));
  }
  const ben = makeGua(upperName, lowerName);

  // 互卦：本卦 2,3,4 爻为互卦下卦，3,4,5 爻为互卦上卦（爻序自下而上）
  const huLower = trigramFromYao(ben.yao.slice(1, 4));
  const huUpper = trigramFromYao(ben.yao.slice(2, 5));
  const hu = makeGua(huUpper, huLower);

  // 变卦：动爻阴阳互变，其余五爻不动
  const bianYao = ben.yao.slice();
  bianYao[dongYao - 1] = bianYao[dongYao - 1] === 1 ? 0 : 1;
  const bian = makeGua(trigramFromYao(bianYao.slice(3)), trigramFromYao(bianYao.slice(0, 3)));

  // 体用：动爻所在经卦为用，另一为体
  const dongInLower = dongYao <= 3;
  const yongName = dongInLower ? ben.lower : ben.upper;
  const tiName = dongInLower ? ben.upper : ben.lower;
  const tiWuXing = TRIGRAM_WUXING[tiName];
  const yongWuXing = TRIGRAM_WUXING[yongName];

  return {
    benGua: ben,
    huGua: hu,
    bianGua: bian,
    dongYao,
    ti: { trigram: tiName, wuXing: tiWuXing, position: dongInLower ? '上卦' : '下卦' },
    yong: { trigram: yongName, wuXing: yongWuXing, position: dongInLower ? '下卦' : '上卦' },
    tiYongRelation: tiYongGuanxi(tiWuXing, yongWuXing),
    names: { benGua: ben.name, huGua: hu.name, bianGua: bian.name },
  };
}

module.exports = {
  qiGuaByNumbers,
  qiGuaByTotal,
  deriveGua, // 卦象推导（已有卦名+动爻时直接复用）
  rem8,
  rem6,
  trigramFromNumber,
  trigramFromYao,
  makeGua,
  wuXingRelation,
  tiYongGuanxi,
  TRIGRAM_NUMBERS,
  NUMBER_TRIGRAMS,
  TRIGRAM_YAO,
  TRIGRAM_IMAGE,
  TRIGRAM_WUXING,
  SHENG,
  KE,
  GUANAMES,
};


/*__MH_PART5__*/

/*__MH_PART4__*/

/*__MH_PART3__*/

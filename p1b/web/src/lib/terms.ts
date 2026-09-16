/** 术语表单一真源（2026-09-15 · 渐进披露三层的数据层）
 * 字段：term=术语原词｜plain=人话｜definition=一句话定义｜basis=口径字段路径｜caveat=限制条件｜see=参见
 * 铁律：术语只收进第二层，界面上一个都不删。
 */
export type TermEntry = {
  id: string;
  term: string;
  plain: string;
  definition: string;
  basis: string;
  caveat?: string;
  see?: string;
};

export const TERMS: Record<string, TermEntry> = {
  baseRate: {
    id: 'baseRate',
    term: '基率',
    plain: '历史上这类情况占多少',
    definition: '过去同类中该事件发生的比例，是不看任何线索时的起点参照。',
    basis: 'evidence.baseRate.p（n=样本量，window=统计窗口）',
    caveat: 'n<30 不显示区间',
  },
  brier: {
    id: 'brier',
    term: '校准分',
    plain: '上次判断准不准',
    definition: '给概率打分的尺子：越接近 0 越准，0.25 相当于乱猜。',
    basis: 'stage4-run 分层 Brier；配对 bootstrap 95% CI',
    caveat: 'n<30 不出 CI',
  },
  cutoff: {
    id: 'cutoff',
    term: '信息截止',
    plain: '只能用哪天之前的信息',
    definition: '划定时点的界线：界线之后发生的事一律不得用于判断。',
    basis: 'evidence[0].cutoff / meta.cutoff',
    caveat: '不得用 created_at 派生',
  },
  layer: {
    id: 'layer',
    term: '分层',
    plain: '这件事有多难算',
    definition: '按可算程度把题分六层：L1 决定论、L2 系综、L3 短窗混沌、L4 自反、L5 不可约随机、L6 对抗。',
    basis: 'predictions.layer（L1-L6）',
    caveat: '分层间禁跨层池化',
  },
  g2Regime: {
    id: 'g2Regime',
    term: '规则域',
    plain: '按哪套规则算',
    definition: '判定规则的口径版本；只有 R4 域内才参与达标判定。',
    basis: 'g2_regime（R4 为现行）',
  },
  r4: {
    id: 'r4',
    term: 'R4 口径',
    plain: '现行这套判据',
    definition: '过程能力门的现行口径，五条判据齐备方可通过。',
    basis: 'g2-report 门读数 ①-⑤',
    caveat: '过程能力门，不含质量读数',
  },
  checklistHash: {
    id: 'checklistHash',
    term: '判据清单版本',
    plain: '这题按哪版清单判',
    definition: '判据清单的冻结版本号，改动即版本递进。',
    basis: 'checklist_hash（冻结后禁改）',
  },
  wilson: {
    id: 'wilson',
    term: 'Wilson 区间',
    plain: '这个比例的可信范围',
    definition: '小样本下算比例的置信区间，比正态近似更稳。',
    basis: 'l2_baseline 统计基率 + Wilson',
    caveat: 'n<30 不出区间',
  },
  aci: {
    id: 'aci',
    term: '短窗区间',
    plain: '窗口内读数的可信范围',
    definition: '短窗混沌层用的区间算法，窗外迅速失效。',
    basis: 'l3 短窗 stat_baseline + ACI',
    caveat: '超出窗口无效',
  },
  truthAnchor: {
    id: 'truthAnchor',
    term: '真值锚',
    plain: '拿什么校对答案',
    definition: '题面绑定的可核验真值来源；无真值锚的题不进账本。',
    basis: 'resolve.* / truth_vault',
    caveat: '无锚不入账（铁律③）',
  },
  prereg: {
    id: 'prereg',
    term: '预注册',
    plain: '开跑前先把规则写死',
    definition: '实验开跑前冻结判据与口径的文件；冻结后禁改，改动即版本递进。',
    basis: '.scratch/forecast-debate/PREREG-*.md',
    caveat: '冻结后禁改（铁律⑥）',
  },
  resolver: {
    id: 'resolver',
    term: '取数器',
    plain: '到哪儿取答案',
    definition: '按题型到外部源取真值的取数实现，一类题一个。',
    basis: 'p1b/scripts/corpus-resolve.cjs 内各 kind resolver',
  },
  bayesPrior: {
    id: 'bayesPrior',
    term: '先验',
    plain: '不看线索时的起点',
    definition: '不看任何线索时的起点参照（统计基率，含 n 与窗口口径）；它只是起点，本身不构成精度宣称。',
    basis: 'l2_baseline.js Wilson 统计基率（evidence.baseRate.p，n/window）',
    caveat: 'L1/L5 概率主干豁免（不算先验）',
  },
  likelihoodEvidence: {
    id: 'likelihoodEvidence',
    term: '似然证据',
    plain: '判词给出的线索',
    definition: '多路判词提供的证据行：文字倾向经固定正则机械抽取成数值后进入聚合，属证据口径，不是概率直出。',
    basis: 'verdictsStore 多路判词（implied_prob 末行正则机械抽取）',
    caveat: '不是似然函数；LLM 不出概率（铁律④）',
  },
  posteriorAgg: {
    id: 'posteriorAgg',
    term: '后验聚合',
    plain: '把线索合起来算的数',
    definition: '把先验与证据行按固定规则合成一个数；规则冻结、可复算，属聚合口径（不是新读数）。',
    basis: 'l6_structural.js 固定规则聚合；stage4-run 分层 Brier',
    caveat: '禁跨层池化',
  },
  calibrationAci: {
    id: 'calibrationAci',
    term: '校准（ACI）',
    plain: '让区间随漂移调整',
    definition: '在线校准层：只调整预测区间与披露，不改点估计；校准效果的披露随样本积累。',
    basis: 'l3_aci.js ACI 覆盖率披露（α/γ/EWMA；只调区间不调 p）',
    caveat: '点估计恒为基率',
  },
};

export const REQUIRED_TERM_IDS: string[] = [
  'baseRate', 'brier', 'cutoff', 'layer', 'g2Regime', 'r4',
  'checklistHash', 'wilson', 'aci', 'truthAnchor', 'prereg', 'resolver',
  'bayesPrior', 'likelihoodEvidence', 'posteriorAgg', 'calibrationAci',
];

export function getTerm(id: string): TermEntry | null {
  return Object.prototype.hasOwnProperty.call(TERMS, id) ? TERMS[id] : null;
}

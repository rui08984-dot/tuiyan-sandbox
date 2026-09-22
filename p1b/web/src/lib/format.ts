/**
 * 格式化单一真源（2026-09-22 全方面重构）
 *
 * 为什么要有这个文件：此前每个披露页各写各的格式化函数——
 *   CalibrationReportPage / BayesLensPage / ArenaPage 各有一份 `const f = (x) => x==null ? 'n/a' : x.toFixed(4)`
 *   AuditPage 有一份 `tri()` 与 `fmtCi()`。写法各异 ⇒ 空态文案容易漂移。
 *
 * ★ 与 dist.test.mjs 的关系（最易踩的坑）：
 *   该测试断言 **dist 产物必须含「样本不足」与「基率」字面量**。
 *   ⇒ 本文件的空态文案是**契约**，不是装饰。图形可以加，文字一个字都不许删，
 *     也不得改成「数据不足」/「无数据」之类近义改写（改了 dist 测试立刻红）。
 */

/** 三位小数；null/undefined/NaN ⇒ 样本不足（不编造、不用 0 填充） */
export function tri(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '样本不足' : v.toFixed(3);
}

/** 四位小数；空 ⇒ n/a（披露件沿用既有口径，与「样本不足」分工不同：n/a=件里本就没有该列） */
export function quad(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? 'n/a' : v.toFixed(4);
}

/** 百分比一位；空 ⇒ 样本不足 */
export function pct(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '样本不足' : (v * 100).toFixed(1) + '%';
}

/** 置信区间；任一端 null ⇒ n<30 不出 CI（原文保留，不许改写成「区间不可用」） */
export function fmtCi(lo: number | null | undefined, hi: number | null | undefined): string {
  if (lo === null || lo === undefined || hi === null || hi === undefined) return 'n<30 不出 CI';
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 'n<30 不出 CI';
  return '[' + lo.toFixed(3) + ', ' + hi.toFixed(3) + ']';
}

/** 薄格判定：n<30 只记方向不出结论（口径恒挂，与后端 conclusion_allowed 同源） */
export const THIN_CELL_NOTE = 'n<30 仅方向';

/** 整数千分位；空 ⇒ — */
export function int(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return Math.round(v).toLocaleString('en-US');
}

/** 判断是否为「有读数」的数值（图表用它决定画点还是画空态，绝不把 null 当 0） */
export function hasNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// ── 面向使用者的人话层（2026-09-22 二轮重构）───────────────────────────────
//
// 背景：审计发现 66 处「只对开发者有意义」的信息被印在界面上——
//   `源 stage4-run-five-layers-20260922.json`、`生成 2026-09-22T08:43:44.028Z`、
//   `生成命令：node p1b/scripts/calibration-report.cjs`。
//   使用者看到一串 ISO 时间与脚本名，第一反应是「页面出错了」——这正是用户反馈的现象。
//
// 纪律：内部标识（文件名/脚本名/hash）不是删除，而是**降级**——收进 title 悬浮提示，
//   既让界面干净，又保住「口径可追溯」这条铁律（需要时仍能查到确切出处）。

/** 内部件名 → 中文来源标签（未收录的返回「数据文件」，绝不把英文名直接甩给使用者） */
const SOURCE_LABEL: Record<string, string> = {
  'stage4-run': '引擎分层读数',
  'stage4-run-five-layers': '引擎分层读数',
  'calibration-report': '校准报告',
  'forecast-calendar': '到期日推算',
  'negative-results-ledger': '负结果账本',
  'forecastbench-baseline': '公开基准对照',
  'verdict-spread': '判词离散度',
  'g2-contract-frozen-r4': '判据契约',
};

/** 从内部件名（可能带日期后缀与 .json）取中文来源标签 */
export function sourceLabel(file: string | null | undefined): string | null {
  if (!file) return null;
  const base = String(file).replace(/\.json$/i, '').replace(/-\d{8}[a-z]?$/i, '');
  if (SOURCE_LABEL[base]) return SOURCE_LABEL[base];
  // 前缀匹配：stage4-run-five-layers-20260922 → stage4-run-five-layers
  for (const k of Object.keys(SOURCE_LABEL)) {
    if (base.indexOf(k) === 0) return SOURCE_LABEL[k];
  }
  return '数据文件';
}

/**
 * 时间戳 → 人话「更新于 09-22 08:43」。
 * ★ 只输出到分钟：秒与毫秒对使用者毫无意义（原实现把整个 ISO 串印出来）。
 * ★ 原始 ISO 串由调用方放进 title 悬浮提示，需精确追溯时不丢信息。
 */
export function humanTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 仅日期（用于「数据日期」这类不需要时刻的场景） */
export function humanDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 数据缺失时的人话提示。
 * ★ 原来这里印的是「生成命令：node p1b/scripts/calibration-report.cjs」——
 *   使用者不需要、也不该看到脚本名（用户反馈：以为是页面报错）。
 *   命令收进 title 悬浮提示，仅给维护者用。
 */
export const MISSING_TEXT = '这项数据还没准备好';
export const MISSING_HINT = '重新生成后即可显示';

/** 管线状态位 → 人话（scored / descriptive / blocked 是内部概念）
 * ★ 放在共享层：审计页与接题页都要用，各写一份会漂移。原始值由调用方放进 title。 */
const GATE_LABEL: Record<string, string> = {
  scored: '已计分',
  descriptive: '只记录',
  blocked: '未通过门禁',
};

export function gateHuman(g: string | null | undefined): string {
  if (g === null || g === undefined || g === '') return '—';
  return GATE_LABEL[g] ?? g;
}

/** 复合状态串（如「descriptive / blocked」）逐段翻译。
 *  ★ 同一层可能同时处于多个状态，后端用 ' / ' 拼接；整串查表查不到会原样漏出英文。 */
export function gateHumanMulti(g: string | null | undefined): string {
  if (!g) return '—';
  const raw = String(g);
  if (raw.indexOf(' / ') < 0) return gateHuman(raw);
  return raw.split(' / ').map((s) => gateHuman(s.trim())).join('、');
}

/** 算法配方位 → 人话（proc_calc / stat_baseline + Wilson 等是内部标识符） */
const ENGINE_LABEL: Record<string, string> = {
  'proc_calc': '程序复算',
  'stat_baseline + Wilson': '历史频率＋区间估计',
  'stat_baseline + ACI': '历史频率＋自适应区间',
  'none（classify-only）': '只分类不出数',
  'certified_dist': '认证随机源',
  'structural': '结构推断',
};

export function engineHuman(e: string | null | undefined): string {
  if (e === null || e === undefined || e === '') return '—';
  return ENGINE_LABEL[e] ?? e;
}

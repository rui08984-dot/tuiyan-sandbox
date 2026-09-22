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

/**
 * p1b/src/disclosure/habitRank.mjs —— 「你在哪类事上偏」的唯一口径（纯计算 · 零副作用）
 *
 * 【为什么把它抽出来】
 *   2026-09-30 实测：这段归并此前**只活在一个 React 组件里**
 *   （web/src/pages/WhereOffPage.tsx 的 habits useMemo），全仓后端零命中；
 *   上游 routes/disclosure.js 只逐格 map 出 cells、**不做任何归并**。
 *   ⇒ 本项目最核心的那个价值（不是读数，是「你老犯什么毛病」）没有一个可被调用的接口。
 *   抽到这里之后：只读端点、网页组件、测试三方共用**同一份**实现，同一个口径只有一处。
 *
 * 【纪律：判据原样搬运，一行都没改】
 *   · `delta_vs_half === null` 的格**不计**。注意是严格等 null（照抄原判据，
 *     `undefined` 不在这一列——原实现对 undefined 是照算的，这里不"顺手修"）。
 *   · 只有 `conclusion_allowed` 为真的格才进 `ok` / `d` 累加（那些格不给结论）。
 *   · `delta = d / ok` —— **除以格数 ok，不是题数 n**。这是最容易改错的一处。
 *   · 一个够样本的格都没有的域**不进榜**（`ok > 0`）。
 *   · 按 `|delta|` **降序**排；同值时保持入列次序（JS 排序稳定，靠下面那个普通对象保序）。
 *   · `n` 累加的是**全部**非 null 格（含薄格），所以榜上「N 条题 · K 格够样本」两句
 *     出自同一趟循环，不存在两趟循环口径打架的可能。
 *
 * 【零副作用】不读文件、不读库、不碰网络、不写任何全局量。同样的 cells 进 ⇒ 同样的结果出。
 *   因此它可以被后端（Node）与前端（浏览器）**同一份**加载。
 *
 * 【为什么是 .mjs（ESM）而不是仓里惯用的 CJS .js】
 *   vite 的打包与 dev 管线**只对 node_modules 做 CJS 转换**，源码目录里的
 *   `module.exports = …` 会被当成 ESM 处理而炸；反过来后端是 CommonJS 包。
 *   纯 ESM 两头都能吃：后端 `require()` 同步加载（Node ≥22.12 支持 require(ESM)），
 *   前端 vite 原生 import。类型走同目录的 habitRank.d.mts（只有声明，没有第二份实现）。
 */
'use strict';

/**
 * 一个格的最小形状（只声明本函数真读的四个字段，其余列运行时原样容忍）。
 * 与 routes/disclosure.js 服务的 calibration-report 件里的 cells 行同形。
 * ★故意不加索引签名：加了它就等于要求调用方的行类型也带索引签名，
 *   而网页的 Cell 是普通 interface（没有索引签名）⇒ 类型上直接不兼容。
 * @typedef {{ layer?: string, domain: string, scored_n: number,
 *              conclusion_allowed: boolean, delta_vs_half: number | null }} HabitCell
 */
/**
 * 榜上一行。**字段集与抽取前逐字一致**（抽取前的实现只吐这四个）——
 *   改这个集合会让"抽出来的结果 == 抽之前的逐字段相同"这条金样断言当场变红。
 * @typedef {{ domain: string, n: number, ok: number, delta: number }} HabitRow
 */
/**
 * 归并后的一个域（榜的原料，含 ok=0 的域）。`d` 是偏差之和，**不给比例**——
 *   比例只由 rankHabits 在 ok>0 时算出来。
 * @typedef {{ domain: string, n: number, ok: number, cells: number, d: number }} HabitBucket
 */

/**
 * 为什么这么排 —— 判据的人话版，**跟着计算走**。
 * 端点的返回体原样带上它：调用方不该拿到一个黑盒数字。
 * 页面也用它渲染那一段说明，避免"计算一处、解释另一处"。
 * @type {Readonly<Record<string, unknown>>}
 */
export const HABIT_RANK_BASIS = Object.freeze({
  what: '每个域给一个数：只有样本够的格参与的平均偏差（相对「一律报五成」的无信息线）。',
  order: '按 |平均偏差| 降序 —— 偏得最厉害的排最前，符号只决定"报大了/报小了"怎么写。',
  denominator: 'delta = 偏差之和 ÷ 够样本的格数（ok）。★不是除以题数 n：分母是格数。',
  cell_rules: [
    'delta_vs_half 为 null 的格不计（这一格算不出偏差）。',
    '样本不够的格（conclusion_allowed 为假）只计题数 n，不进偏差平均 —— 它们只记方向、不给比例。',
    'n 累加全部可算格（含薄格），所以「N 条题 · K 格够样本」两句出自同一趟循环。',
  ],
  dropped: '一个够样本的格都没有的域不进榜（ok=0 时整域剔除，不是排到最后一名）。',
  ties: '|偏差| 相同时保持入列次序（域首次出现的先后）——排序稳定，不许用别的键偷偷改次序。',
  n30: '格样本不足 30 ⇒ 只记方向、不给比例；这类格在页面上单列一栏，不混进本榜。',
  // ★页面上那段说明句也从这里取。放进来是因为"计算一处、解释另一处"就是口径的第二个真相；
  //   文案随判据走，判据改了这句也一起改，不会留下一个还在讲旧口径的段落。
  page_note: '按「相对无信息线的平均偏差」排（偏得最厉害的排最前）。只有样本够的格参与——样本不够的格一律不参与排序、只记方向，见下面那一栏。',
});

/**
 * 第一步：按域归并（**含 ok=0 的域**）。
 *
 * 为什么不把这一步藏在 rankHabits 里：端点要如实回答"某个域为什么不在榜上"，
 * 那就得能看见被剔掉的桶。自己再数一遍就等于有第二份口径 —— 所以归并只此一处，
 * rankHabits 与端点都从它派生。
 *
 * @param {ReadonlyArray<HabitCell>|null|undefined} cells calibration-report 的 cells 行
 * @returns {HabitBucket[]} 每个出现过的域一行，顺序＝域首次出现的次序
 */
export function habitBuckets(cells) {
  // 形状防御只挡 null/undefined（非数组），**不改变**任何合法入参的行为。
  const list = Array.isArray(cells) ? cells : [];
  const by = {};
  for (const c of list) {
    if (c.delta_vs_half === null) continue;
    const b = (by[c.domain] = by[c.domain] || { n: 0, ok: 0, d: 0, cnt: 0 });
    b.n += c.scored_n; b.cnt += 1;
    if (c.conclusion_allowed) { b.ok += 1; b.d += c.delta_vs_half; }
  }
  return Object.entries(by)
    .map(([domain, b]) => ({ domain, n: b.n, ok: b.ok, cells: b.cnt, d: b.d }));
}

/**
 * 第二步：出榜。按域归并「你老犯的毛病」。
 *
 * @param {ReadonlyArray<HabitCell>|null|undefined} cells calibration-report 的 cells 行
 * @returns {HabitRow[]} 按 |delta| 降序；没有可下结论格的域已被剔除
 */
export function rankHabits(cells) {
  return habitBuckets(cells)
    .filter((b) => b.ok > 0)
    .map((b) => ({ domain: b.domain, n: b.n, ok: b.ok, delta: b.d / b.ok }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

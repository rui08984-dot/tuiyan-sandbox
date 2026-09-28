/**
 * noteLookup —— 题源查历史的返回形状 → 页面该显示什么（2026-09-28 · 缺陷三）
 *
 * 【为什么把这件事抽出来】
 *   病象不是"少了一句提示"，是**两件不同的事被界面说成了一件**：
 *     ① 账本里**一道这种题都没有**（后端 known:false，连 base_rate 键都没有）
 *     ② 账本里有，但**还没结算**（base_rate.n = 0、rate = null）
 *   页面只读 `.base_rate`、从不看 `known`，落到 ① 时给出一个
 *   `{layer: undefined, engine: undefined, n: undefined}` ——**truthy 的空对象**，
 *   于是面板照渲染：层名「—」、判据 0 个、左注永远停在「在数…」，
 *   结论句还说「还没有同类已结算的题」。真相与界面各说各的。
 *   后端把原话（reason/hint）就放在响应里（p1b/src/routes/disclosure.js 的 lookup 分支），
 *   页面从来没读过它——那是最省事的修法：读它，别自己编。
 *
 *   这类"读形状"的判断天生该有单测，而组件级测试要 jsdom/Testing Library
 *   （本项目禁新依赖）⇒ 判定搬进纯函数，组件只负责渲染。
 *
 * 【三条纪律】
 *   ① **不认就是不知道**：`known !== true` 一律按"没有"处理——
 *      宁可少说一句，也不可替后端把没说的当成有。
 *   ② **null 与 0 严格区分**：读不出频率是 null（"没有"），
 *      rate=0 是"测了，确实一次没发生"（"有，且是 0"）。混起来就是误导。
 *   ③ **原话优先**：reason/hint 走后端原文。页面自己编的说法会与账本口径漂移。
 */

export interface LookupHint {
  n: number;            // 同类已结算的条数
  hit: number;          // 其中真发生的
  rate: number | null;  // 真发生频率；null = 没有（≠ 0）
  enough: boolean;      // 是否达 n>=30 线
  note: string;         // 后端给的人话口径说明
}

export interface NoteLookup {
  known: boolean;       // ★账本里有没有这种题
  kind: string;
  layer?: string;       // 仅 known 时有；unknown 时**必须**是 undefined（不许编层）
  engine?: string;
  totalN?: number;      // 同类题总数（含未结算）
  base: LookupHint | null;
  reason: string;       // known=false 时后端给的理由（原文）
  hint: string;         // known=false 时后端给的下一步（原文）
}

/** 「账本里一道这种题都没有」——与「有但还没结算」是两句话，不许合并 */
export const UNKNOWN_KIND_LINE =
  '账本里还没有这类题：没有同类记录可比，层与引擎也就无从推断。';

/** 「有这类题，但一条都还没结算」——与上面那句严格区分 */
export const NO_SETTLED_LINE = '还没有同类已结算的题，暂时没有历史频率可比。';

function obj(v: unknown): Record<string, unknown> {
  return (v && typeof v === 'object' && !Array.isArray(v)) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** 后端 lookup 响应 → 页面状态。坏响应一律按"不敢说它有"处理。 */
export function readLookup(j: unknown): NoteLookup {
  const o = obj(j);
  // 纪律①：只有显式 known===true 才算有
  if (o.known !== true) {
    return {
      known: false,
      kind: str(o.kind),
      base: null,
      reason: str(o.reason) || '后端没给出理由（响应形状不对），如实地说明这一点。',
      hint: str(o.hint),
    };
  }
  const sug = obj(o.suggestion);
  const ev = obj(o.evidence);
  const br = obj(o.base_rate);
  // 纪律②：读不出频率就是 null；畸形数字不許混进界面
  const n = num(br.n);
  const base: LookupHint | null = n === undefined ? null : {
    n,
    hit: num(br.hit) ?? 0,
    rate: num(br.rate) ?? null,
    enough: br.enough === true,
    note: str(br.note),
  };
  return {
    known: true,
    kind: str(o.kind),
    layer: str(sug.layer) || undefined,
    engine: str(sug.engine) || undefined,
    totalN: num(ev.total_n),
    base,
    reason: '',
    hint: '',
  };
}

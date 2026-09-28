/**
 * noteChecklist —— 记一笔页「判据清单」的唯一装配口径（2026-09-28 · 步骤 A）
 *
 * 【为什么必须抽成纯函数，而不是在组件里拼】
 *   判据契约是**后端硬约束**：`intake.js` 的决策树逐层必填，缺一个或长度不符直接 400。
 *   而 400 是**提交那一刻**才炸的东西，本地写、界面上看不出来。
 *   这类"只在发出去那一刻才判定"的逻辑天生该有单测，而组件级测试要
 *   jsdom / Testing Library（本项目禁新依赖）⇒ 装配搬进纯函数，组件只管递参。
 *
 * 【病象：每一道题都在第 1 步就被拒】
 *   后端 `intake.js:296-302` 按 `DECISION_ORDER=['L5','L6','L1','L3','L2']`
 *   **逐层**取 checklist，`layerGreen` 对缺键返回 null 而调用方直接 400；
 *   给了但长度不符则 `intake.js:191` 直接 400。
 *   旧版 `NotePage.buildChecklist` 只发「三问 + 系统建议的那一层」，
 *   其余四层**连键都没有** ⇒ 恒 400。
 *
 * 【三态，而不是二态：这是本文件唯一真正要紧的判断】
 *   `normTri`（`intake.js:174-184`）收三态：boolean / `'unknown'`。
 *   那四层用户**根本没被问到**——界面上只渲染建议层那一层的判据
 *   （见 `note-form.test.mjs` ①，25 个复选框是本轮刻意去掉的负担）。
 *   所以那四层只有两种填法：
 *     · `false` ＝ **替用户编造「不满足」**。决策树照样往下走、照样能过，
 *       可账本里留下的是一句用户从没说过的话 —— 那是把"没问"记成"问了，答否"，
 *       正是本项目最忌的那类静默失真（与"n 未知"写成 "n=0" 同一种病）。
 *     · `'unknown'` ＝ 如实说"没问"。`intake.js:186-192` 的注释写明
 *       「'unknown' 视作非全绿（不归该层）」⇒ 不编造、也不阻断。
 *   两者在"最终落到哪一层"上**结果相同**，在**账本是否诚实**上完全不同。
 *
 * 【判据一句没删，也没改后端】
 *   问数（`QUESTION_COUNT`）与顺序（`DECISION_ORDER`）与后端逐字对齐；
 *   L4 是后置叠加层（`intake.js:326`），本页不渲染它的判据 ⇒ 不发，
 *   后端 `layerGreen('L4', undefined)` 返回 null ⇒ 不误标 secondary。
 */

/** 各层二元问数量。与 `p1b/src/routes/intake.js:62` 的 QUESTION_COUNT 逐字对齐。 */
export const QUESTION_COUNT: Record<string, number> = { L5: 3, L6: 4, L1: 4, L3: 4, L2: 4, L4: 3 };

/** 决策树顺序。与 `p1b/src/routes/intake.js:60` 的 DECISION_ORDER 逐字对齐（最特殊优先）。 */
export const DECISION_ORDER: readonly string[] = ['L5', 'L6', 'L1', 'L3', 'L2'];

/** 「没问」的三态字面量。`normTri` 的 UNKNOWN_WORDS 认它（`intake.js:171`）。 */
export const UNASKED = 'unknown';

/** 拒收门三问（`intake.js:53-57`）。三态归一后任一非 true 即拒收。 */
export const GATE_KEYS: readonly string[] = ['Q0_1', 'Q0_2', 'Q0_3'];

/** 一次合法提交必须带齐的键：三问 + 决策树五层。少一个键后端就是 400。 */
export const REQUIRED_KEYS: readonly string[] = [...GATE_KEYS, ...DECISION_ORDER];

/** 后端收的 checklist 值形状（`intake.js:187-199`：boolean | 'unknown' | 它们的同义写法）。 */
export type Tri = boolean | string;
/** 一次提交的 checklist 本体，键即 REQUIRED_KEYS。 */
export type Checklist = Record<string, Tri | Tri[]>;

export interface BuildChecklistInput {
  /** 系统按「答案去哪里查」建议的那一层（`layer`）。null/空/未知层名 ⇒ 全按"没问"发。 */
  layer?: string | null;
  /** 用户**取消勾选**的判据序号（字符串，从 0 起，与界面上 over[layer] 存的一致）。 */
  off?: readonly string[];
}

/**
 * 该层名是不是决策树里的一层（只认白名单，不做前缀/大小写宽松匹配——
 * 宽松匹配会把一个拼错的层名当成某一层，等于替用户认领了他没答过的判据）。
 */
function isDecisionLayer(layer: string | null | undefined): layer is string {
  return !!layer && DECISION_ORDER.indexOf(layer) !== -1;
}

/** 「没问」那几层：长度必须逐层等于后端问数，否则 intake.js:191 直接 400。 */
function unaskedOf(layer: string): Tri[] {
  return Array.from({ length: QUESTION_COUNT[layer] }, () => UNASKED);
}

/**
 * 装配一份后端收得下的 checklist。
 *
 * ★注意三问恒填 true：那是本页**既定的填法**——界面上没有 Q0 的复选框
 *   （人只答题面与真值锚类型两件事，见 NotePage 文件头）。
 *   这里如实记下来，免得下一个人把它当成"用户逐条答过 Q0"。
 */
export function buildChecklist(x: BuildChecklistInput): Checklist {
  const c: Checklist = { Q0_1: true, Q0_2: true, Q0_3: true };
  const off = (x && x.off) || [];
  for (const layer of DECISION_ORDER) {
    if (layer === x.layer && isDecisionLayer(x.layer)) {
      // 建议层 ⇒ 发**用户真实勾选**：默认"是"（intake.js:192 的 every===true 才算全绿），
      // 用户取消的那几条如实发 false。取消哪几条就是判断本身，不许悄悄改回去。
      c[layer] = Array.from({ length: QUESTION_COUNT[layer] }, (_, i) => !off.includes(String(i)));
    } else {
      // 没问到 ⇒ 如实发"没问"，**不是** false（见文件头三态段）
      c[layer] = unaskedOf(layer);
    }
  }
  return c;
}

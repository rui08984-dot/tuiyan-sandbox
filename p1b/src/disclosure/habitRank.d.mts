/**
 * p1b/src/disclosure/habitRank.d.mts —— habitRank.mjs 的**类型声明**（零实现）
 *
 * 【它存在的唯一理由】
 *   web/tsconfig.json 是 `allowJs: false` + `strict: true`（隐含 noImplicitAny），
 *   而 WhereOffPage.tsx 要 import 这个共享模块 ⇒ 没有声明文件的话 tsc 会把它读成 any，
 *   那等于把类型检查在这一段上关掉。
 *
 * 【纪律】本文件**只有类型、没有一行可执行代码** —— 它不是第二份实现，
 *   判据的真身在 habitRank.mjs。若两边的字段名对不上，下面这条会当场红。
 */

/** calibration-report 里一行格（只声明 rankHabits 真读的字段；其余列运行时原样容忍）。 */
export interface HabitCell {
  layer?: string;
  domain: string;
  scored_n: number;
  conclusion_allowed: boolean;
  delta_vs_half: number | null;
}

/** 榜上一行：字段集与抽取前逐字一致（金样断言锁的就是它）。 */
export interface HabitRow {
  domain: string;
  /** 该域全部可算格的题数之和（含薄格） */
  n: number;
  /** 该域够样本、真正参与偏差平均的格数 */
  ok: number;
  /** 平均偏差 = 偏差之和 ÷ ok（★分母是格数，不是题数） */
  delta: number;
}

/** 归并后的一个域（榜的原料，含 ok=0 的域）。`d` 是偏差之和，不给比例。 */
export interface HabitBucket {
  domain: string;
  n: number;
  ok: number;
  /** 该域可算偏差的格数（无论够不够样本） */
  cells: number;
  /** 够样本格的偏差之和（原始和，未除） */
  d: number;
}

/** 为什么这么排：判据的人话版，端点原样带出，页面也用它渲染说明。 */
export interface HabitRankBasis {
  what: string;
  order: string;
  denominator: string;
  cell_rules: string[];
  dropped: string;
  ties: string;
  n30: string;
  /** 页面那段说明句也取自这里（计算一处、解释一处） */
  page_note: string;
}

export declare function habitBuckets(cells: readonly HabitCell[] | null | undefined): HabitBucket[];

export declare function rankHabits(cells: readonly HabitCell[] | null | undefined): HabitRow[];

export declare const HABIT_RANK_BASIS: Readonly<HabitRankBasis>;

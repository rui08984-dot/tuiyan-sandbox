/**
 * noteWait —— 记一笔页的等待态判定（2026-09-28 · 缺陷二）
 *
 * 【为什么把它从组件里搬出来】
 *   病象不是"少了个转圈"，是**等待和「查不到数据」在界面上长得一模一样**：
 *   选完「答案去哪里查」到「这类题历史上怎么样」出现之间有一整段空白，
 *   而"这个题源没有历史样本"也是一片空白。用户分不出"在等"和"没有"，
 *   只能盯着屏幕猜——而本页的核心动作就是算数，那段等待必然发生。
 *   根因在接线：`busy` 只覆盖 submit，选 kind 后那次取数 fetch 完全没人管。
 *
 *   这类判断天生该有单测，而组件级测试要 jsdom/Testing Library（本项目禁新依赖）。
 *   ⇒ 判定搬进纯函数：组件只管把三份状态递进来、把结果渲染出去。
 *     行为由 noteWait.test.mjs 真 import 本文件验证（不是扫源码的代理判据）。
 *
 * 【三条判定纪律】
 *   ① **错优先于等**：出错时不能还转圈——"正在处理"配一个红色叉是骗人。
 *   ② **两段等待两句话**：查历史与登记登记的是两件事，
 *      共用一句"在数…"等于没解释这次在等什么。
 *   ③ **没事就是 idle**：Wait 在 idle 时返回 null，所以常态页面一个像素都不多。
 */

/** 选源后的取数阶段：idle=没选 / freq=正在查历史 / done=查完了 */
export type NotePhase = 'idle' | 'freq' | 'done';
export type NoteWaitState = 'idle' | 'pending' | 'error';

export interface NoteWaitInput {
  /** 错误文案（非空即出错）。取数失败与提交失败共用它。 */
  err: string;
  /** 提交中（**只**指 submit；取数段由 phase 表达，不许借它表达） */
  busy: boolean;
  /** 取数阶段 */
  phase: NotePhase;
}

/** 这一刻界面该显示成什么等待态 */
export function waitStateOf(x: NoteWaitInput): NoteWaitState {
  if (x.err) return 'error';          // 纪律①
  if (x.busy) return 'pending';
  if (x.phase === 'freq') return 'pending';   // ★这就是上一轮漏掉的那段
  return 'idle';                       // 纪律③
}

/** 这一刻等待圈旁边该写什么话（空字符串＝骗人，所以任何时候都给得出话） */
export function waitWhatOf(x: { busy: boolean; phase: NotePhase }): string {
  if (x.busy) return '在登记这道题…';
  if (x.phase === 'freq') return '在数这类题历史上对了多少次…';
  return '在处理…';                    // idle/error 态不显示 this，但留个非空兜底
}

/** 组件唯一的入口：state 与 what 同源，杜绝"圈是转的、话是另一段的" */
export function waitViewOf(x: NoteWaitInput): { state: NoteWaitState; what: string } {
  return { state: waitStateOf(x), what: waitWhatOf(x) };
}

/**
 * noteSteps —— 记一笔页的**常驻步进指示**（2026-09-30 · 创始人实测报「我在填在这一步但是页面不会变」）
 *
 * 【病象：不是 bug，是缺一个指示】
 *   文件头把流程写成「第一步 选一个真值锚类型 → 第二步 门面查账本历史 → 第三步 只是参考建议」，
 *   创始人照着读，结果在第一步填的时候**看不出自己在第几步、也看不出页面动不动**。
 *   根因不在数据也不在时序（那条链 phase: idle → freq → done 一直跑得好好的），
 *   而在于：**页面上没有任何一处把"走到哪了"说出来**。
 *     · `phase` 只喂给 `<Wait>`（判定在 lib/noteWait.ts）⇒ 只是一行「在数这类题历史上对了多少次…」
 *     · 「在数」和「查完了」之间**没有别的可见差别** ⇒ 用户只能盯着屏幕猜
 *   ⇒ 这一层要补的不是新流程，是**把已有的 phase 说出来**。
 *
 * 【三条不许破的线，本文件的每条设计都为它们让路】
 *
 *   ① **`assigned_prob` 的唯一来源不许被显示层改写**（NotePage.tsx:234 附近的纪律注释）。
 *      本文件**只读** `myProb`，一个数都不算、不换算、不四舍五入。
 *      第 3 步那一格写的是"这个数从哪来"，不是"这个数是多少"——
 *      任何"顺手把它显示成 62%"的改动都会让显示层长出第二个来源，那正是本仓最贵的错。
 *
 *   ② **第二步查到的是读数，不是建议**。
 *      账本给的是「同类题历史频率」这个**客观读数**（事实），不是"你该怎么想"（判断）。
 *      两者混起来，产品就变成了"系统替你判断"——而本产品存在的理由恰恰是**人自己押**。
 *      ⇒ 步进指示里禁掉 推荐／建议／擅长／倾向／优先 这类词（firstRun.ts 的 FORBID_WORDS 同一条纪律）。
 *      本文件拿到的只有 kind（这一栏选了哪个）与 lookup 的有无，
 *      **拿到 base.rate 也没有任何地方用它写文案**——那正是第 ① 条要防的第二个来源。
 *
 *   ③ **拒收门三问不许降级**（真值锚可机检／cutoff 早于决定性时点／结果随实例变化）。
 *      本文件对门禁**只读不写**：它调用 `submitGuard` 拿到"还差什么"那句话，
 *      但**不参与放行、不改写条件、不新增旁路**。指示器是**读的**，不是**判的**——
 *      页面那一句「记下」能不能按，仍且只由 NotePage.submit 里那道闸决定。
 *
 * 【为什么是纯函数（禁新依赖的必然结果）】
 *   本项目禁 jsdom / Testing Library ⇒ 组件级测试测不了。
 *   而"这三步各自现在是什么状态、还差什么"恰恰是最该被单测的东西。
 *   ⇒ 判定与文案全在本文件（可被 `node --test` 直接 import 执行），.tsx 只负责画。
 *   与 lib/noteWait.ts / noteProb.ts / noteLookup.ts / noteChecklist.ts 同款做法。
 *
 * 【口径单一真源：文案不许另造第二套】
 *   · 「在数…」这一句直接取 `waitWhatOf`（lib/noteWait.ts）——<Wait> 与步进指示说同一句话。
 *     两处各写一遍的话，迟早有一处忘了改，而用户会看到两个互相打架的说法。
 *   · 「还差什么」直接取 `submitGuard` 的 why（lib/noteProb.ts）——指示器与真正拦人的那道闸
 *     读的是**同一个**返回值，所以两者永远不可能各说各话。
 *   · 「账本里没有这类题」/「还没有已结算的题」直接取 noteLookup.ts 那两句常量。
 */
/* ★import 写全 .ts 后缀（tsconfig 的 allowImportingTsExtensions 已开）：本文件要直接被
   `node --test` import（禁 jsdom ⇒ 组件级测不了，判定只能住在纯函数里），
   而 Node 的类型剥离加载器不解析无后缀的相对路径。写全后缀，测试与 Vite 两侧都能直接读。 */
import { waitWhatOf } from './noteWait.ts';
import type { NotePhase } from './noteWait.ts';
import { readMyProb, submitGuard } from './noteProb.ts';
import { UNKNOWN_KIND_LINE, NO_SETTLED_LINE } from './noteLookup.ts';
import type { NoteLookup } from './noteLookup.ts';

/* ══════════════ 形状 ══════════════ */

/** 三步。id 用机器读，label 给人读。 */
export type NoteStepId = 'kind' | 'history' | 'judgement';

/**
 * 每一步现在的状态。四档而不是两档：
 *   todo    还没到
 *   now     正在这一步（或正可用）
 *   done    走完了
 *   blocked ★这一步卡住了（不是"还在等"）
 * `blocked` 是刻意加的第四档：取数失败时 phase 也是 `done`，
 * 若只分 done/todo，「这次没查到」会被画成「查完了」——
 * 而这两件事的下一步完全不同（换一栏 vs 往下填）。见 lib/noteLookup.ts 纪律②。
 */
export type NoteStepState = 'todo' | 'now' | 'done' | 'blocked';

export interface NoteStepItem {
  id: NoteStepId;
  /** 1..3，机读与显示共用（页面上印的就是这个数） */
  n: number;
  /** 短标签（步进条上那几个字） */
  label: string;
  state: NoteStepState;
  /**
   * 状态的两三个字（步进条上印在标签下面）。
   * ★单独一个字段而不是让 .tsx 去 map：映射表也属于"口径"，放组件里就等于
   *   有一份文案没人能单测——改坏了只有肉眼看得出来。
   */
  stateWord: string;
  /** 这一步现在的话。**恒非空**——空白与"没这回事"同形＝骗人（同 noteWait 纪律）。 */
  note: string;
}

export interface NoteStepsView {
  steps: NoteStepItem[];
  /** 现在在第几步（1..3；全走完时停在 3）。机读。 */
  at: number;
  /** 取数段处在哪一档：原样透传 phase，供机检与调试用。 */
  phase: NotePhase;
  /**
   * 三件必答齐了没有。**与 submitGuard 同一个真源**，指示器绝不自己另判一遍。
   * ★注意它比「记下」那个键的 disabled 条件**更严**：那把键故意不放行"没给数"，
   *   好让点击时把话说清（见 NotePage.tsx 的按钮注释）。指示器说的是"按下会成"，不是"键亮不亮"。
   */
  ready: boolean;
  /** 还差什么（人话）。齐了时是**空串**——不是"没有差别"，是"确实没差的了"。 */
  lacking: string;
  /** 一句话说清"现在到哪了"。恒非空。 */
  headline: string;
  /** 齐了时的一句（"现在按记下就能落进账本"这类）。没齐时是空串。 */
  readyLine: string;
}

export interface NoteStepsInput {
  /** 题面。本文件**只判空不判内容**（它的长短与对错不由本页负责）。 */
  statement: string;
  /** 真值锚（选了哪一栏）。本文件**只用来判"选没选"**，不用来推断任何倾向。 */
  kind: string;
  /** 取数段（idle / freq / done）。原样透传，不改写。 */
  phase: NotePhase;
  /** 「你的判断」输入框的原始字符串。**只判合不合法，不读它的值**（纪律①）。 */
  myProb: string;
  /** 账本查回来的东西；null = 还没查 / 没查到。 */
  lookup: NoteLookup | null;
  /** 正在登记（submit 中）。 */
  busy: boolean;
}

/* ══════════════ 三步各自的判定 ══════════════ */

const KIND_LABEL = '选答案去哪里查';
const HISTORY_LABEL = '查账本里这类题的历史';
const JUDGE_LABEL = '给出你的判断';

/**
 * 状态 → 两三个字的短标签（印在步进条上）。
 * ★四档各有各的字，且 blocked 刻意**不叫"没做完"**：
 *   "卡住了"是"你换一栏题源就能解开"，"没做完"是"你还没开始"——下一步完全不同。
 * 映射放在这里（而不是 .tsx 里 map）是因为它也是口径：放组件里就没人能单测它。
 */
const STATE_WORD: Record<NoteStepState, string> = {
  todo: '还没到',
  now: '正在这一步',
  done: '已完成',
  blocked: '卡住了',
};

/** 选一栏真值锚。做完这一步，那道拒收门才开始有东西可查。 */
function kindStep(x: NoteStepsInput): NoteStepItem {
  const has = x.kind.trim() !== '';
  return {
    id: 'kind', n: 1, label: KIND_LABEL,
    state: has ? 'done' : 'now',
    stateWord: '',
    note: has
      ? '这一栏决定这道题到期时有没有地方能自动拿到真实答案。'
      : '还没选：到期时得有一个地方能自动拿到真实答案，否则这道题没法核对。',
  };
}

/**
 * 查账本历史。★这是三步里唯一**由机器推进**的一步，所以它的档位最多。
 *
 * 五个分支各说各的话（这是本文件最长的一段判断，长得有理由）：
 *   没选题源   → todo  「还没开始」（★不是"查完了什么都没有"）
 *   刚选中     → now   还没发出去的那一瞬
 *   freq       → now   **复用 waitWhatOf 的话**，与 <Wait> 同源，一个字不另造
 *   done+有读数 → done  **读数**出来了（纪律②：说"读数"，不说"建议"）
 *   done+无读数 → blocked ★这一档是本轮新增的：phase 也是 done，但不許画成"走完了"
 */
function historyStep(x: NoteStepsInput): NoteStepItem {
  const base = { id: 'history' as const, n: 2, label: HISTORY_LABEL, stateWord: '' };
  if (x.kind.trim() === '') {
    return { ...base, state: 'todo', note: '还没开始——先在上面选一栏「答案去哪里查」。' };
  }
  if (x.phase === 'freq') {
    // ★口径单一真源：这一句与 <Wait> 顶部那行是同一个字符串
    return { ...base, state: 'now', note: waitWhatOf({ busy: false, phase: 'freq' }) };
  }
  if (x.phase === 'done') {
    if (!x.lookup) {
      // ★取数失败：phase 也是 done。不许画成"查完了"——换一栏题源才会重查。
      return { ...base, state: 'blocked', note: '这一栏没查到历史样本。换一个「答案去哪里查」就会重查一次。' };
    }
    if (!x.lookup.known) {
      // 账本里一道这种题都没有（后端 known:false）
      return { ...base, state: 'done', note: UNKNOWN_KIND_LINE };
    }
    if (!x.lookup.base) {
      // 有这类题、但一条都还没结算
      return { ...base, state: 'done', note: NO_SETTLED_LINE };
    }
    // ★"读数出来了"——不是"建议你按它填"。base.rate 在这里被**刻意不用**：
    //   它是读数，用它写一句带倾向的话就等于让系统替人判断（纪律②）。
    return { ...base, state: 'done', note: '同类历史读数出来了，在下面那一栏，可以对着它填你自己的判断。' };
  }
  // kind 已选、phase 还停在 idle：effect 还没跑到 setPhase('freq') 的那一瞬。
  // 如实说"刚开始"，不说"在等"——那一刻确实还没发请求。
  return { ...base, state: 'now', note: '刚开始查。' };
}

/** 给出你的判断。★这一步是 `assigned_prob` 的唯一来源，本页只指路不算数。 */
function judgementStep(x: NoteStepsInput): NoteStepItem {
  const base = { id: 'judgement' as const, n: 3, label: JUDGE_LABEL, stateWord: '' };
  if (readMyProb(x.myProb).ok) {
    return { ...base, state: 'done', note: '填好了——账本里那条「你当时押多少」只来自这里。' };
  }
  if (x.busy) {
    return { ...base, state: 'now', note: waitWhatOf({ busy: true, phase: x.phase }) };
  }
  if (x.kind.trim() === '') {
    return { ...base, state: 'todo', note: '还没开始——先在上面选一栏「答案去哪里查」。' };
  }
  // ★"必填"与"它是账本里那条数的唯一来源"两句都要说：
  //   只说"必填"像表单校验；说清来源，用户才知道这一格为什么不能空。
  return { ...base, state: 'now', note: '必填，填 0 到 100 之间的百分数（如 62 表示你押六成）。账本里「你当时押多少」只来自这一格。' };
}

/* ══════════════ 出口 ══════════════ */

/**
 * 这一刻步进指示该画成什么样。
 *
 * ★"还差什么"取 submitGuard 的 why 而不是自己数一遍：这是**同一个返回值**，
 * 于是指示器与真正拦人的那道闸不可能各说各话。
 * 指示器**只读**这个结果——放行权仍在 NotePage.submit 手里（纪律③）。
 */
export function stepsViewOf(x: NoteStepsInput): NoteStepsView {
  /* stateWord 在这一处统一挂上：三处 builder 各自写一遍就可能写漏一处，
     而漏掉的那一处渲染出来是一个**空格子**（界面上少三个字，无声无息）。 */
  const steps: NoteStepItem[] = [kindStep(x), historyStep(x), judgementStep(x)]
    .map((s) => ({ ...s, stateWord: STATE_WORD[s.state] }));
  // 「现在在第几步」＝第一个还没走完的那一步；全走完时停在最后一步。
  // blocked 也算"没走完"——它停在原地，不许被当成进度。
  const firstOpen = steps.findIndex((s) => s.state !== 'done');
  const at = firstOpen < 0 ? steps.length : firstOpen + 1;

  const guard = submitGuard({ statement: x.statement, kind: x.kind, myProb: x.myProb });
  const ready = guard.ok;
  const lacking = ready ? '' : guard.why;

  // headline 恒非空。正在登记时直接说登记（复用 waitWhatOf 的提交口径）。
  const headline = x.busy
    ? waitWhatOf({ busy: true, phase: x.phase })
    : '第 ' + at + ' 步 / 共 ' + steps.length + ' 步 · ' + steps[at - 1].label;

  // 齐了的那一句要说清"按下去会发生什么"，而不只是"可以按了"——
  // 用户在按下之前就该知道这一笔会落到账本里，而不是只看到键亮了。
  const readyLine = ready && !x.busy ? '三样都齐了：现在按「记下」就会落进账本。' : '';

  return { steps, at, phase: x.phase, ready, lacking, headline, readyLine };
}

/** 三步的标签顺序（机检用：页面上印的 ①②③ 必须与这里的顺序一致）。 */
export const STEP_ORDER: NoteStepId[] = ['kind', 'history', 'judgement'];

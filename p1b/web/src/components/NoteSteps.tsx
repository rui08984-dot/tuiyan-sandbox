/**
 * NoteSteps —— 记一笔页的常驻步进指示（2026-09-30）
 *
 * 【它存在的理由：那一屏此前没有"我在第几步"这句话】
 *   选 kind 会触发 `phase: idle → freq → done` 的异步链，那条链一直跑得好好的，
 *   但**页面上没有任何一处把"走到哪了"说出来**。于是用户看着一个不动的页面猜——
 *   创始人原话：「我在填在这一步但是页面不会变还是什么」。
 *   ⇒ 本组件不新增任何流程，只把**已经存在的 phase** 画出来。
 *
 * 【三条不许破的线，这个组件一律不碰】
 *   ① `assigned_prob` 的唯一来源：本组件**收不到任何数字**。
 *      props 只有一个 `view`（含 id/label/state/文案），连 base 都没有——
 *      显示层因此**在类型上就长不出第二个数来源**。
 *   ② 第二步是读数不是建议：文案全部来自 lib/noteSteps.ts（那里有禁词闸），
 *      本组件**一个字都不另写**，只负责把 note 摆出来。
 *   ③ 拒收门不许降级：本组件是纯展示，**不含任何 disabled / 校验 / 提交逻辑**。
 *      它甚至不改那把「记下」键的 disabled 条件——那是 submitGuard 的事，与本页无关。
 *
 * 【机读：data-* 是给测试与读屏软件用的真接口，不是装饰】
 *   data-note-at / data-note-phase / data-note-ready / data-note-step-state
 *   落在**真实节点**上（本仓有一条闸专门查"源码里写了 data 属性但没真挂上"，
 *   见 noteSteps.test.mjs ⑨——它把本组件真渲染成 HTML 再查这几条）。
 *   另配 `aria-live="polite"`：状态一变，读屏软件会念出来，
 *   而"看不见也听不见"对读屏用户等价于"页面坏了"。
 */
import type { NoteStepsView, NoteStepState } from '../lib/noteSteps';
import '../styles/note.css';

export function NoteSteps({ view, testId = 'note-steps' }: { view: NoteStepsView; testId?: string }) {
  return (
    <section
      className="note-steps"
      data-testid={testId}
      /* 机读：走到第几步 / 取数段在哪一档 / 三件必答齐没齐。
         ★at 与 phase 必须挂在**同一个节点**上：分开放的话，
         测试读到的是"某个地方有个数字"，而不是"这个指示器现在到哪一步"。 */
      data-note-at={view.at}
      data-note-phase={view.phase}
      data-note-ready={view.ready ? 'yes' : 'no'}
      aria-label="记一笔走到第几步"
    >
      <p className="note-steps-head" role="status" aria-live="polite">
        <b className="note-steps-at">{view.headline}</b>
        {/* 状态变化要被听见：只看颜色/位置的指示对读屏用户等于没有 */}
        {view.lacking ? <span className="note-steps-lack">{view.lacking}</span> : null}
        {view.readyLine ? <span className="note-steps-ok">{view.readyLine}</span> : null}
      </p>

      <ol className="note-steps-list">
        {view.steps.map((s) => (
          <li
            key={s.id}
            className={'note-step is-' + s.state}
            data-note-step={s.id}
            data-note-step-state={s.state}
            /* 正在进行的那一步标 aria-current：读屏软件念到"第几步"时能定位到它 */
            aria-current={s.state === 'now' ? 'step' : undefined}
          >
            {/* 序号是 n（1..3），不是位置下标——两者今天相等，但语义不同：
                将来插入一步时页面上印的号必须是这一项自己的 n。 */}
            <span className="note-step-n" aria-hidden="true">{s.n}</span>
            <span className="note-step-txt">
              <span className="note-step-label">{s.label}</span>
              <span className="note-step-state">{s.stateWord}</span>
            </span>
          </li>
        ))}
      </ol>

      {/* 当前这一步的那句话。挑 note 非空、且状态最"靠前"的那条讲：
          正在查历史时该讲的是"在数"，不是"还没到"。 */}
      <p className="note-steps-note">{pickNote(view)}</p>
    </section>
  );
}

/**
 * 该显示哪一条 note。
 * 优先级：卡住 > 正在 > 没到 > 已完成。
 * ★"卡住"排第一是本轮的关键：查不到时 phase 也是 done，
 *   若按"最后一步优先"的写法，那一句"已完成"会盖住"卡住了"——
 *   而这两件事要用户做的事完全不同。
 */
function pickNote(v: NoteStepsView): string {
  const order: NoteStepState[] = ['blocked', 'now', 'todo', 'done'];
  for (const st of order) {
    const hit = v.steps.find((s) => s.state === st);
    if (hit) return hit.note;
  }
  /* 三步全 done 时上面会在最后一轮命中 done 并返回——这里只是为了让类型收口。
     真走到这里说明 steps 是空的：一个连一句话都给不出的指示器比没有更坏，
     所以宁可说清"没有可显示的步骤"，也不返回空串。 */
  return '没有可显示的步骤。';
}

export default NoteSteps;

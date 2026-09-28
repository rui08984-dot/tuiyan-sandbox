/** NotePage —— 记一笔（2026-08-27 八轮第七改 · **接题页的减负版**）
 *
 * 【病象：引擎的输入被摆在了人的作业面上】
 *   旧接题页要人勾 **3 道门 + 六层 22 问 = 25 个复选框**。
 *   而后端 `disclosure.js` 的编译器注释写得很清楚：
 *     「52 个 kind 全部单层（0 个跨层）⇒ kind→layer 可 100% 自动推断」
 *   且 `/api/disclosure/compiler` 的 how_it_works 原文：
 *     「第一步：选一个真值锚类型——它决定这道题能不能机检。
 *       第二步：门面查账本历史，给出这类题通常属于哪一层、用哪个引擎、有多少同类样本。
 *       第三步：这只是参考建议，不是判定。」
 *   ⇒ 选真值锚类型（kind）这件事**本来就该在人的作业面上**（它决定"能不能机检"），
 *     而六层归类 100% 可从它推出来。旧界面让人先做最难的一步（判层），
 *     再逼他对 22 个判据逐个表态。
 *
 * 【本轮怎么减负，而不是废除判据】
 *   ★**不删任何一个判据，也不改后端契约**（六层问答个数固定，勾选=是/未勾=否，
 *     数量不符后端 400；且判据属 PREREG 冻结范围，不该由界面单方面废掉）。
 *   ⇒ 改的是**人的负担**：
 *     ① 人先答**一句话题面** ＋ 选一个**真值锚类型**（kind）——这两件本来就是必填的；
 *     ② 系统用编译器接口回「这类题通常属于哪一层、用哪个引擎、有多少同类样本」；
 *     ③ 该层的判据**默认按"是"预填**，人只**改异议的那几条**；
 *        若系统建议与人的判断不一致，允许改并**记录分歧**（分歧本身是信息）。
 *   效果：从「判断 25 件事」降为「确认 1 件事 + 改 0～2 件事」。
 *
 * 【回执：把系统的答复放在人的动作正下方】
 *   旧界面答完之后只给一个 reason 枚举值。新回执必须说**人话**：
 *     · 收下了 → 到期日 + 「结果去哪里查」+「这类题你以前报过多少」
 *     · 收不了 → **是系统拒了你**，并说清是哪一条判据卡住、为什么这条判据存在
 *   ★拒收的因果方向很重要：旧文案读作"你没通过考试"，新文案读作
 *     "这道题没有能事后核对的地方，所以它永远没法判对错"——后者才是事实。
 *
 * 【铁律遵守】全文禁「预测」二字；本页只调既有接口，不做任何库写。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../api';
import type { IntakeClassifyResult } from '../types';
import '../styles/note.css';
import { Term } from '../components/ui';
import { Wait } from '../components/Wait';
import { KIND_GROUPS, kindLabel } from '../lib/kindLabel';
/* ★判定搬进纯函数：组件级测试要 jsdom/Testing Library（本项目禁新依赖），
   而"这段等待该显示成什么"恰恰是最该被单测的东西（空白与"查不到"同形＝骗人）。
   state 与 what 必须同一个来源，否则会出现"圈在转、话却是另一段"。 */
import { waitViewOf } from '../lib/noteWait';
import type { NotePhase } from '../lib/noteWait';
/* 同理：后端 lookup 有三种返回形状，读形状这件事必须能单测（禁 jsdom/Testing Library）。
   known:false 那一种连 base_rate 键都没有——不看 known 就会把"没有这类题"说成"还没结算"。 */
import { readLookup, UNKNOWN_KIND_LINE, NO_SETTLED_LINE } from '../lib/noteLookup';
import type { NoteLookup } from '../lib/noteLookup';
/* 判据清单是后端硬契约（缺层/层长不符一律 400），而 400 只在提交那一刻才炸、
   本地写和界面上都看不出来 ⇒ 装配口径抽成纯函数逐层单测（禁 jsdom/Testing Library）。
   ★"没被问到的那几层发 unknown 而不是 false"的理由写在 lib/noteChecklist.ts 文件头。 */
import { buildChecklist } from '../lib/noteChecklist';
/* 「你的判断」是 assigned_prob 的唯一来源：读数/换算/拒收理由全在纯函数里，
   因为它天天被用错的两件事——把 62 当 0-1 直接发（后端 400），
   以及拿历史频率顶替用户没填的数（账本里看着样样齐全，其实没有人数）。 */
import { submitGuard } from '../lib/noteProb';

/** 真值锚类型（来自 /api/disclosure/compiler 的 kinds 目录；此处只取展示用的代表若干）。 */
interface KindSpec { kind: string; required: string[]; one_of: string[][]; }

/** ★T4：后端 base_rate 的形状（只读聚合，口径见 p1b/src/routes/disclosure.js）。
 *  注意 rate 可为 **null** —— 那表示「同类还没有已结算的题」，
 *  与 rate=0（测了，确实一次没发生）**不是一回事**，绝不能混。 */
interface Hint {
  n: number;          // 已结算的同类题数
  hit: number;        // 其中真发生的
  rate: number | null;// 真发生频率；null = 没有
  enough: boolean;    // 是否达 n>=30 线
  note: string;       // 人话口径说明
}

const REASON_TEXT: Record<string, string> = {
  no_anchor: '这道题没有能事后核对的地方，所以它永远没法判对错。',
  leak: '写下题面的时候，答案可能已经公开了——那这道题就只是在抄答案。',
  tautology: '结果不会变。恒定不变的题面不能用来检验判断。',
  other: '有别的原因把它挡下来了。',
};

export default function NotePage() {
  const [kinds, setKinds] = useState<KindSpec[]>([]);
  const [kind, setKind] = useState<string>('');
  const [statement, setStatement] = useState('');
  /** ★缺陷三（2026-09-28）：原来这里是**两个** state（advice + base），
      因为旧代码无条件 setAdvice({...})，而那个对象哪怕三个字段全是 undefined
      也是 truthy ⇒ 面板照渲染。`advice` 与 `base` 现在都从 lookup 派生，
      一个 state 装下"这道题源在账本里到底有没有记录"这**一件事**。
      —— 拆成两个 state 就注定它们会各说各话（那正是旧病根的形状）。*/
  const [lookup, setLookup] = useState<NoteLookup | null>(null);
  /* ★缺陷二（2026-09-28）：这里曾写成 `const [, setPhase] = useState(...)`——
     读取侧被摘掉、4 处 setPhase 调用（下方选 kind 的 effect）照旧在跑，却驱动不了任何东西。
     而 <Wait> 那时只看 busy，busy 又只覆盖 submit ⇒ **选完「答案去哪里查」到数据返回
     之间，界面上一个字都没有**；那段空白和「这个题源查不到历史样本」长得一模一样，
     用户无从分辨"在等"和"没有"。
     现在 phase 接到 <Wait>（判定在 lib/noteWait.ts，组件只负责渲染），
     这段等待才有话可说。 */
  const [phase, setPhase] = useState<NotePhase>('idle');
  const [over, setOver] = useState<Record<string, string[]>>({});   // layer -> 被取消的序号
  const [res, setRes] = useState<IntakeClassifyResult | null>(null);
  /* ★账本回执（2026-09-28）：**落注成功之后**才有的那一行。
     之前这一页全程只读不写，回执只报 classify 判出来的层与到期日，
     读起来像"记下了"——而 predictions 账本里一行都没有。
     现在分开两个来源：`res` 是分类/判层的答复，`ledger` 是**真进了账本**的回执；
     两者不许互相顶替（ledger 为空就不许显示"收下了"）。 */
  const [ledger, setLedger] = useState<LedgerRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/disclosure/compiler')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setKinds((j?.kinds || []) as KindSpec[]))
      .catch(() => setKinds([]));
  }, []);

  const spec = useMemo(() => kinds.find((k) => k.kind === kind) || null, [kinds, kind]);

  // ★T3（M1）：后端给了、但尚未翻译的 kind —— 仍要出现在下拉里（标注「未译」）。
  //   静默丢弃会让人以为「没这个来源」，那比英文看不懂更坏。
  const untranslated = useMemo(
    () => kinds.map((k) => k.kind).filter((k) => kindLabel(k).label.indexOf('（未译）') >= 0),
    [kinds],
  );

  // ★T5：你的判断。留空＝先不给数，等你看到基率再决定——**顺序很重要**：
  //   先看到「这类题历史上 7.4%」再填，比先填一个数再被告知基率更不容易锚定。
  const [myProb, setMyProb] = useState<string>('');

  /** 选 kind ⇒ 向后端要：层 / 引擎 / 样本量 / ★历史真实频率（T4 新增） */
  useEffect(() => {
    setLookup(null);
    setPhase('idle');
    if (!kind) return;
    let alive = true;
    setPhase('freq');
    fetch('/api/disclosure/compiler?kind=' + encodeURIComponent(kind))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return;
        // ★缺陷三：后端 lookup 有**三种**返回形状，其中 known:false 那种
        //   **根本没有 base_rate 键**（只有 reason/hint）。旧代码直接读 .base_rate
        //   且不看 known ⇒ 「账本里一道这种题都没有」被说成「有、但还没结算」。
        //   现在读形状的活交给 readLookup（lib/noteLookup.ts，可单测）。
        if (!j) {
          // HTTP 非 2xx 时 r.json() 给的就是 null。旧代码在这里直接 return，
          // 于是 phase 永远停在 freq —— 缺陷二把 phase 接进 <Wait> 之后，
          // 那会变成**一个永远转下去的圈**：这是同一处的洞，一起堵上。
          setLookup(null); setPhase('done'); setErr('读不到这类题的历史样本');
          return;
        }
        setLookup(readLookup(j));
        setPhase('done');
      })
      .catch(() => { if (alive) { setLookup(null); setPhase('done'); setErr('读不到这类题的历史样本'); } });
    return () => { alive = false; };
  }, [kind]);

  /* ★缺陷三：advice 与 base 都由 `known` 把关。
     账本里没有这道题时，**不许造一个层出来**——层名「—」＋ 0 个复选框，
     看起来像"系统建议了一条空层"，实际上那个层根本不存在。
     面板这时整体不渲染，改显示后端给的理由（reason/hint 原文）。 */
  const advice = useMemo(
    () => (lookup && lookup.known ? { layer: lookup.layer, engine: lookup.engine, n: lookup.totalN } : null),
    [lookup],
  );
  const base: Hint | null = lookup && lookup.known ? lookup.base : null;

  /** 该层判据默认「是」；人只把不认同的序号放进 over。
   *  ★装配搬进纯函数 buildChecklist（lib/noteChecklist.ts）：后端逐层必填且层长不符即 400，
   *    这条只在你按下"记下"那一刻才发生，页面上看不出来 ⇒ 必须能单测。
   *    旧实现在这里只发「三问 + 建议层」，其余四层连键都没有 ⇒ 恒 400；
   *    而拿 false 顶上也不行——那是替用户编造"不满足"。发 unknown 才是"没问"。 */
  const checklist = useMemo(
    () => buildChecklist({ layer: advice?.layer ?? null, off: advice?.layer ? over[advice.layer] : undefined }),
    [advice, over],
  );

  const submit = useCallback(async () => {
    /* ★闸在发请求之前（不是之后）：三件必答的事少一件就不许发出去。
       其中「你的判断」是 `assigned_prob` 的**唯一来源**——不放行就等于
       记下一条没有人数的题，而回执还写"收下了"。宁可当场说清为什么。 */
    const v = submitGuard({ statement, kind, myProb });
    if (!v.ok) { setErr(v.why); setBusy(false); return; }
    setBusy(true); setErr('');
    try {
      /* 两步：先 classify 拿**层与到期口径**，再 create 把题与用户那个数落进账本。
         ★顺序不能反：层是 classify 判出来的，create 只是记账；先建再判等于
           建一条没有层的行（而分层的行才是那些读数认的东西）。 */
      const r = await api.classifyIntake({
        statement: statement.trim(),
        resolve_spec: { kind },
        checklist,
      } as never);
      setRes(r);
      // ★被拒收就不建行：拒收的题进的是 intake_rejects 台账，不是 predictions 账本。
      //   硬建一条进去＝把"系统拒收了这道题"和"账本里有一道题"同时说成真话。
      if ((r as unknown as { rejected?: boolean }).rejected) return;
      const c = await api.createPrediction({
        statement: statement.trim(),
        prob: v.prob,
        resolve_spec: { kind },
        layer: r.layer,
        secondary_layer: r.secondary,
        engine: r.engine,
        gate: r.gate,
        intake_question_id: r.intake_question_id,
      });
      // ★落注成功才把"记下了"说出口。setRes 在上面已经跑过一次，所以这里补的是**账本回执**。
      setLedger(c);
    } catch (e) {
      /* ★失败必须如实报错，不许显示「收下了」——那正是最会骗人的地方。
         两步之间的失败也会走这里：classify 过了但 create 没过时，
         `res` 已经是"收下了"，所以下面把它撤掉，别让界面停在一个半截状态上。 */
      setRes(null);
      setLedger(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [statement, kind, myProb, checklist]);

  /* ★两段等待说两句话：查历史说「在数」，登记说「在登记」。
     共用一句"在数同类题的历史样本"会让人以为提交时也在数数——那是在解释一件没发生的事。 */
  const wait = waitViewOf({ err, busy, phase });

  return (
    <div className="note">
      <header className="page-head note-head">
        <h1>记一笔</h1>
        <p className="page-sub">
          把一件还没发生的事写下来。到期后回来回答，就落定了。
        </p>
      </header>

      {/* ── 两件本来就得人做的事：题面 + 真值锚类型 ── */}
      <section className="note-in">
        <label className="note-label" htmlFor="note-stmt">这道题在问什么</label>
        <textarea
          id="note-stmt" className="note-text" rows={2} value={statement}
          placeholder="例：2026-09-30 伦敦日降水量超过 20mm 吗？"
          onChange={(e) => { setStatement(e.target.value); setRes(null); setLedger(null); }}
        />

        <label className="note-label" htmlFor="note-kind">答案去哪里查</label>
        <p className="note-hint">
          <Term id="truthAnchor" plain="这一栏决定这道题能不能机检——到期时有没有一个地方能自动拿到真实答案。选错了，题就废了。" />
        </p>
        {/* ★T3（M1）：从「27 个引擎标识平铺」改为「按领域分组的人话选项」。
            依据是用户凭什么判断选它——**到期时能不能去某处查到真实答案**，
            所以每项都带一句「去哪查」。分组的依据是"能不能扫读"，平铺没法扫。
            ★未收录的 kind **不静默丢**，仍出现在「其他」组并标注「未译」——
            丢了会让人以为"没这个来源"，那是更坏的错。 */}
        <select
          id="note-kind" className="note-select" value={kind}
          onChange={(e) => { setKind(e.target.value); setRes(null); setLedger(null); }}
        >
          <option value="">选一个…</option>
          {KIND_GROUPS.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.items.map((it) => (
                <option key={it.kind} value={it.kind}>{it.label} · {it.source}</option>
              ))}
            </optgroup>
          ))}
          {untranslated.length ? (
            <optgroup label="其他（尚未翻译的来源）">
              {untranslated.map((k) => (
                <option key={k} value={k}>{k}（未译）</option>
              ))}
            </optgroup>
          ) : null}
        </select>
        {spec ? (
          <p className="note-need">
            这类题还需要：{spec.required.join('、')}
            {spec.one_of && spec.one_of.length
              ? '（其中 ' + spec.one_of.map((o) => o.join(' 或 ')).join('；') + '）'
              : ''}
          </p>
        ) : null}
      </section>

      {/* ══ ★缺陷三：known=false 是**另一件事**，不是"没有历史频率" ══
          账本里一道这种题都没有 ⇒ 没有层可推、没有频率可比、判据无从谈起。
          旧界面在这个状态下照渲染算数面板（层名「—」、判据 0 个、左注停在「在数…」），
          等于把"没有"说成"还没结算"——而这两种情况的正确做法完全不同。
          这里改显示后端给的理由原文（reason/hint），面板整体不渲染。 */}
      {lookup && !lookup.known ? (
        <section className="note-answer" data-testid="note-unknown-kind">
          <h2 className="note-answer-h">这类题，账本里还没有记录</h2>
          <p className="note-advice-note">{lookup.reason}</p>
          {lookup.hint ? <p className="note-advice-note">{lookup.hint}</p> : null}
          <p className="note-advice-note">{UNKNOWN_KIND_LINE}</p>
        </section>
      ) : null}

      {/* ══ ★T5：算数露头 —— 两个数并排 + 一句结论 ══
          这是本产品**存在的理由**。过去写完题面什么都拿不到，
          用户不知道"我凭什么给这个数"、也不知道"历史上这类题怎么样"。
          现在并排给出：我的判断 vs 同类历史真实频率。

          ★2026-09-28 步骤 B：整块从 `{advice ? …}` 里**抬出来了**，条件改成 `kind`。
          原因不是排版，是**闸的可执行性**：
          「你的判断」是 `assigned_prob` 的唯一来源，而提交闸（lib/noteProb.ts）
          少一个数就不放行。输入框若仍关在 advice 门里，账本里一道这种题都没有时
          （lookup.known=false）**整块不渲染** ⇒ 闸把用户拦在一处他根本填不了的地方。
          拦下一件用户做不了的事、又不告诉他去哪儿做，比不拦更坏。
          左格在没有历史时显示「—」并说明为什么（理由/在数…），右格照常可填。 */}
      {kind ? (
        <section className="note-answer" data-testid="note-answer">
          <h2 className="note-answer-h">
            {advice ? '这类题，历史上怎么样' : '先记下你的判断'}
          </h2>

          <div className="note-nums">
            {/* 左：同类历史真实频率（后端 T4 实算，只读） */}
            <div className="note-num">
              <div className="note-num-lab">同类历史</div>
              <div className={'note-num-v' + (base && base.enough ? '' : ' is-thin')}>
                {base && base.rate != null ? Math.round(base.rate * 100) + '%' : '—'}
              </div>
              <div className="note-num-note">
                {base
                  ? (base.n > 0
                      ? (base.enough
                          ? ('已结算 ' + base.n + ' 条里对了 ' + base.hit + ' 条')
                          : ('只结算了 ' + base.n + ' 条，不足 30'))
                      : '同类还没有已结算的题')
                  : (lookup && !lookup.known ? '账本里还没有这类题' : '在数…')}
              </div>
            </div>

            {/* 右：你的判断 —— 放在看过基率之后填，减少锚定。
                ★必填：不填就提交不了（这是"记一笔"与"写个备忘"的区别）。 */}
            <div className="note-num">
              <div className="note-num-lab">你的判断</div>
              <input
                className="note-prob" inputMode="decimal" value={myProb}
                placeholder="填 0-100"
                onChange={(e) => { setMyProb(e.target.value); setRes(null); setLedger(null); }}
                aria-label="你判断这件事发生的概率，填 0 到 100 之间的百分数"
              />
              <div className="note-num-note">
                {myProbValid(myProb) ? '（如 62 表示你押 62%）' : '必填：到期后才知道自己偏了多少'}
              </div>
            </div>
          </div>

          {/* ★结论句：只有两个数都在场才有意义——这是整个产品唯一真正有价值的话。
              verdictText 三态齐全（known=false / 没有已结算的题 / 样本不足 / 差值），
              所以没有建议层时它照样给得出**诚实**的那一句。 */}
          <p className="note-verdict" data-testid="note-verdict">
            {verdictText(myProb, base, lookup ? lookup.known : true)}
          </p>

          {/* ★诚实线：样本不够时必须说「只记方向」，且不给看起来很确定的数 */}
          {base && !base.enough ? (
            <p className="note-thin-warn">
              ★同类样本不足 30 条 ⇒ <b>只记方向，不当结论用</b>。这个数只是"大致什么量级"，不是可靠基率。
            </p>
          ) : null}

          {advice ? (
            <>
          <div className="note-advice-h" style={{ marginTop: 16 }}>
            按账本历史，这类题通常算作
            <b>{advice.layer || '—'}</b>
            {advice.engine ? <>，用 <code>{advice.engine}</code></> : null}
            {typeof advice.n === 'number' ? <>，你写过 <b>{advice.n}</b> 道同类</> : null}
          </div>
          <p className="note-advice-note">
            上面这层判据我按「是」填好了——<b>不同意就取消勾选</b>，其余不用管。这是参考建议不是判定。
          </p>
          {(LAYER_Q[advice.layer || ''] || []).map((q, i) => {
            const off = (over[advice.layer || ''] || []).includes(String(i));
            return (
              <label key={i} className={'note-chk' + (off ? ' is-off' : '')}>
                <input
                  type="checkbox" checked={!off}
                  onChange={(e) => setOver((o) => {
                    const cur = new Set(o[advice.layer || ''] || []);
                    if (e.target.checked) cur.delete(String(i)); else cur.add(String(i));
                    return { ...o, [advice.layer || '']: [...cur] };
                  })}
                />
                <span>{q}</span>
              </label>
            );
          })}
            </>
          ) : null}
        </section>
      ) : null}

      {/* ★按钮只挡"没法提交"的（没题面/没选源/正在提交），
          **不挡"没给数"**：不给数是有话要说的（缺了它，账本里记下的不是你的判断），
          闷掉按钮只会让人以为已经记下了。那道话说清在 lib/noteProb.submitGuard。 */}
      <button
        type="button" className="note-go" disabled={busy || !statement.trim() || !kind}
        onClick={() => void submit()}
      >记下</button>

      {/* ★T2（M5）：等待态从按钮里挪出来。按钮变字**不是等待反馈**——
          用户真正要看到的是「在数什么」。失败态给重试，只报错不给出口＝把问题推给用户。
          ★缺陷二：state 不再是手写的 err/busy 三元（它看不见 phase，选源那段等于没接），
          改为整段消费 waitViewOf 的结果。 */}
      <Wait
        state={wait.state}
        what={wait.what}
        error={err || null}
        onRetry={err ? () => void submit() : undefined}
        testId="note-wait"
      />

      {/* ── 回执：人话，且拒收的因果方向要说清 ── */}
      {res ? <Receipt r={res} ledger={ledger} myProb={myProb} /> : null}
    </div>
  );
}

/** 落注返回里，回执要用到的那几项（其余不显示）。 */
type LedgerRow = {
  id: number;
  assigned_prob: number | null;
  layer: string | null;
  engine: string | null;
  gate: string | null;
  matures_at: string | null;
  matures_why: string | null;
  container?: { game_id: number; name: string; scope: string };
};

/**
 * 回执：系统的答复，用人说的话。
 *
 * ★2026-09-28 最重要的一处改动：**"收下了"只许在账本真的多了一行时出现**。
 *   旧实现只要 classify 过了就写「收下了」，而那时 predictions 账本里一行都没有
 *   ——那句话在替一件没发生的事作证。现在 `ledger` 为空就只报"判成了什么、
 *   但没落进账本"，并把后端的原话摆出来。
 */
function Receipt({ r, ledger, myProb }: { r: IntakeClassifyResult; ledger: LedgerRow | null; myProb: string }) {
  const rej = (r as unknown as { rejected?: boolean; reason?: string; detail?: string }).rejected;
  const reason = (r as unknown as { reason?: string }).reason || 'other';
  if (rej) {
    return (
      <div className="note-receipt is-reject" data-testid="note-receipt">
        <div className="note-receipt-h">这条收不了</div>
        <p className="note-receipt-why">{REASON_TEXT[reason] || REASON_TEXT.other}</p>
        <p className="note-receipt-sub">
          不是你没答对——是<strong>这道题没有能事后核对的地方</strong>。
          拒收已留痕（原因「{reason}」），改写成可核对的一条再记一次就行。
        </p>
      </div>
    );
  }
  const detail = r as unknown as { layer?: string; engine?: string; matures_at?: string };
  /* 判成了层、但没落进账本：这是**半截状态**，必须自己说出来。
     旧文案在这条路上直接写「收下了」——那正是最会骗人的地方。 */
  if (!ledger) {
    return (
      <div className="note-receipt is-reject" data-testid="note-receipt">
        <div className="note-receipt-h">判出来了，但没落进账本</div>
        <dl className="note-receipt-list">
          <dt>算作</dt><dd><b>{detail.layer || '—'}</b>{detail.engine ? <>（{detail.engine}）</> : null}</dd>
        </dl>
        <p className="note-receipt-sub">
          分类这一步过了，落注那一步没成——<b>账本里现在没有这道题，你填的数也没存下来</b>。
          上面那条报错说的是原因，照着改完再记一次。
        </p>
      </div>
    );
  }
  return (
    <div className="note-receipt is-ok" data-testid="note-receipt">
      <div className="note-receipt-h">收下了</div>
      <dl className="note-receipt-list">
        {/* ★这一行是本轮的核心：把用户填的数**原样报回去**。
            界面给的是 0-100 的百分数，账本存的是 0-1；不回显的话，
            用户无从知道自己押的到底是 62% 还是 0.62%。 */}
        <dt>你押的</dt>
        <dd className="u-mono">
          <b>{Math.round((ledger.assigned_prob ?? 0) * 1000) / 10}%</b>
          {myProbValid(myProb) ? '' : '（账本里存的是 ' + String(ledger.assigned_prob) + '，与你填的不一致——这是错的）'}
        </dd>
        <dt>算作</dt><dd><b>{ledger.layer || detail.layer || '—'}</b>{detail.engine ? <>（{detail.engine}）</> : null}</dd>
        <dt>到期</dt>
        <dd className="u-mono">
          {ledger.matures_at || '本题无日历到期日，按题目自身节奏结算'}
          {ledger.matures_why ? <div className="note-receipt-sub">{ledger.matures_why}</div> : null}
        </dd>
      </dl>
      <p className="note-receipt-sub">
        到期后去「待落定」回答一次，就算落定。这一页只新增、不改已有记录。
        {ledger.container ? (
          <>题目记在「{ledger.container.name}」下（<code>{ledger.container.scope}</code> 域）——
            那是个容器、<b>不是一局对局</b>，所以它不会混进任何对局统计里。</>
        ) : null}
      </p>
    </div>
  );
}

/** 我的判断是否是合法的 0-100 百分数 */
export function myProbValid(v: string): boolean {
  if (v.trim() === '') return false;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

/**
 * ★结论句：只有两个数都在场才有意义。
 * 这是整个产品**唯一真正有价值的话**——「你比基率更乐观/更保守」，
 * 只有当"你的判断"和"同类历史频率"并排出现时才存在。
 *
 * 诚实纪律：样本不够（enough=false）时**不给这个结论**——
 * 用 27 条样本说"你比基率乐观"是拿噪音当结论，正是本项目最要防的误读。
 * 那时只说"先看看这类题历史上什么量级"。
 *
 * ★缺陷三：还得分清**「账本里一道这种题都没有」**（known=false）与
 * 「有这类题、但一条都还没结算」（base 为 null）。两句都是"没有频率可比"，
 * 可它们对用户意味着完全不同的下一步：前者是"这个题源我没记过"，
 * 后者是"我记了，还没到期"。说成同一句＝把两件事糊成一件。
 */
export function verdictText(myProb: string, base: Hint | null, known: boolean = true): string {
  if (!known) return UNKNOWN_KIND_LINE;
  if (!base || base.rate == null) return NO_SETTLED_LINE;
  if (!base.enough) {
    return '同类样本只有 ' + base.n + ' 条，不足以说"你比基率更乐观还是更保守"——先当作方向参考。';
  }
  if (!myProbValid(myProb)) return '填上你的判断，才知道你是比历史更乐观还是更保守。';
  const mine = Number(myProb) / 100;
  const gap = mine - base.rate;
  const pct = (Math.abs(gap) * 100).toFixed(1);
  if (Math.abs(gap) < 0.05) return '你的判断和历史频率差不多（差 ' + pct + ' 个百分点）。';
  return gap > 0
    ? '你比历史更乐观：高 ' + pct + ' 个百分点。历史上这类题常不发生。'
    : '你比历史更保守：低 ' + pct + ' 个百分点。';
}

/** 六层判据的人话版（与旧接题页同源，判据一句不删） */
const LAYER_Q: Record<string, string[]> = {
  L1: ['可能的情况数得过来', '规则公开，没有隐藏的随机因素', '拿到公开信息就能推出同样结果', '电脑能算出结果，不需要人裁决'],
  L2: ['这类事反复发生过，性质稳定', '有 30 条以上同类历史结果', '单看这一次推不出结果', '有外部统计可以作参照'],
  L3: ['知道它大致怎么变化', '能算的窗口很短', '有实时数据可以持续修正', '结果会在这个短窗口内出来'],
  L5: ['结果来自公开的随机机制', '没人能靠公开信息提前知道', '题目本身没有可利用的偏倚'],
  L6: ['结果由利益相关的人现场决定', '对手能看到你的历史打法并调整', '可选策略多到数不完', '存在可以伪装、误导的空间'],
  L4: ['结果由人决定，而且决策者可能看到这个记录', '存在「看到结果又反过来影响结果」的回路', '不属于前面任何一类'],
};

export { NotePage };

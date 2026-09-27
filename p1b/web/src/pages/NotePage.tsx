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

/** 真值锚类型（来自 /api/disclosure/compiler 的 kinds 目录；此处只取展示用的代表若干）。 */
interface KindSpec { kind: string; required: string[]; one_of: string[][]; }

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
  /** ★后端 lookup 模式返回的形状（实测）：{ suggestion:{layer,engine}, evidence:{total_n,resolved_n} } */
  const [advice, setAdvice] = useState<{ layer?: string; engine?: string; n?: number } | null>(null);
  const [over, setOver] = useState<Record<string, string[]>>({});   // layer -> 被取消的序号
  const [res, setRes] = useState<IntakeClassifyResult | null>(null);
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
  //   静默丢弃会让人以为「没这个来源」，那比「英文看不懂」更坏。
  const untranslated = useMemo(
    () => kinds.map((k) => k.kind).filter((k) => kindLabel(k).label.indexOf('（未译）') >= 0),
    [kinds],
  );

  /** 选 kind ⇒ 向后端要参考建议（该类题通常属哪层） */
  useEffect(() => {
    setAdvice(null);
    if (!kind) return;
    let alive = true;
    fetch('/api/disclosure/compiler?kind=' + encodeURIComponent(kind))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j) return;
        // ★实测形状：带 kind 查询时返回 { mode:"lookup", suggestion:{layer,engine}, evidence:{total_n,resolved_n} }
        //   —— layer 嵌在 suggestion 里，不在顶层（我一开始按顶层读，拿到 undefined）。
        const sug = (j as { suggestion?: { layer?: string; engine?: string } }).suggestion || {};
        const ev = (j as { evidence?: { total_n?: number } }).evidence || {};
        setAdvice({ layer: sug.layer, engine: sug.engine, n: ev.total_n });
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [kind]);

  /** 该层判据默认「是」；人只把不认同的序号放进 over */
  const buildChecklist = useCallback(() => {
    const c: Record<string, boolean | string | Array<boolean | string>> = {
      Q0_1: true, Q0_2: true, Q0_3: true,
    };
    if (advice?.layer) {
      const n = LAYER_Q.length;
      c[advice.layer] = Array.from({ length: n }, (_, i) => !over[advice.layer!]?.includes(String(i)));
    }
    return c;
  }, [advice, over]);

  const submit = useCallback(async () => {
    if (!statement.trim() || !kind) return;
    setBusy(true); setErr('');
    try {
      const r = await api.classifyIntake({
        statement: statement.trim(),
        resolve_spec: { kind },
        checklist: buildChecklist(),
      } as never);
      setRes(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [statement, kind, buildChecklist]);

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
          onChange={(e) => { setStatement(e.target.value); setRes(null); }}
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
          onChange={(e) => { setKind(e.target.value); setRes(null); }}
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

      {/* ── 系统建议：人只改异议 ── */}
      {advice ? (
        <section className="note-advice" data-testid="note-advice">
          <div className="note-advice-h">
            按账本历史，这类题通常算作
            <b>{advice.layer || '—'}</b>
            {advice.engine ? <>，用 <code>{advice.engine}</code></> : null}
            {typeof advice.n === 'number' ? <>，你写过 <b>{advice.n}</b> 道同类</> : null}
          </div>
          <p className="note-advice-note">
            这是**参考建议不是判定**。我按「是」填了下面这层判据——<b>不同意就取消勾选</b>，其余不用管。
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
        </section>
      ) : null}

      <button
        type="button" className="note-go" disabled={busy || !statement.trim() || !kind}
        onClick={() => void submit()}
      >记下</button>

      {/* ★T2（M5）：等待态从按钮里挪出来。按钮变字**不是等待反馈**——
          用户真正要看到的是「在数什么」。失败态给重试，只报错不给出口＝把问题推给用户。 */}
      <Wait
        state={err ? 'error' : busy ? 'pending' : 'idle'}
        what="在数同类题的历史样本…"
        error={err || null}
        onRetry={err ? () => void submit() : undefined}
        testId="note-wait"
      />

      {/* ── 回执：人话，且拒收的因果方向要说清 ── */}
      {res ? <Receipt r={res} /> : null}
    </div>
  );
}

/** 回执：系统的答复，用人说的话 */
function Receipt({ r }: { r: IntakeClassifyResult }) {
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
  return (
    <div className="note-receipt is-ok" data-testid="note-receipt">
      <div className="note-receipt-h">收下了</div>
      <dl className="note-receipt-list">
        <dt>算作</dt><dd><b>{detail.layer || '—'}</b>{detail.engine ? <>（{detail.engine}）</> : null}</dd>
        <dt>到期</dt><dd className="u-mono">{detail.matures_at || '按题面判据自动推'}</dd>
      </dl>
      <p className="note-receipt-sub">
        到期后去「待落定」回答一次，就算落定。不想改判据可以直接走——
        <b>这一页只做登记，不改已有记录。</b>
      </p>
    </div>
  );
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

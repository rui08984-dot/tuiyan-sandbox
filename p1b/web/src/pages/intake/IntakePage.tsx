/**
 * IntakePage —— 开放接题页（#/intake；阶段 3 出口件界面面，2026-09-13）。
 *
 * 数据源（三个既有接口 + 一个只读列表，均不改契约）：
 *   POST /api/intake/classify   拒收门三问 + 六层判定 → 分层/gate/引擎位（拒收不是失败）
 *   GET  /api/intake/rejects    拒收原因分布（含 0 计数，防 Goodhart 可见性）
 *   GET  /api/intake/questions  接题库只读列表（最新 N 条）
 *
 * 六层问答个数固定（L5=3 / L6=4 / L1=4 / L3=4 / L2=4 / L4=3，与后端 QUESTION_COUNT 一致）：
 * 勾选=是、未勾=否；数量不符后端会 400，故本页控件按固定数量生成。
 *
 * UI 铁律（写死）：全文禁用宣称字样（以「审计／校准参考／分层账本／题面／判据」替代）；
 * 玄学件不掺和；本页只调用既有接题接口，不做任何库写（写库由后端按既有逻辑完成）。
 */
import { useCallback, useEffect, useState } from 'react';
import * as api from '../../api';
import type { IntakeClassifyResult, IntakeRejectsResult, IntakeQuestionsResult } from '../../types';
import '../../styles/intake.css';
import { IconPen, Term } from '../../components/ui';
import { gateHuman } from '../../lib/format';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const REASON_LABEL: Record<string, string> = {
  no_anchor: '没有可校对答案的来源', leak: '信息截止太晚（答案可能已泄露）', tautology: '结果恒定不变', other: '其他',
};

/** 六层判定顺序＝后端 DECISION_ORDER（src/routes/intake.js:54）——特殊性倒序，不是编号序。
 *  界面必须显式说明，否则用户以为排错序；首个全满足层即归属层。 */
const DECISION_ORDER_NOTE = '按特殊性倒序排查（L5→L6→L1→L3→L2），最先全部满足的那层就是归属层；L4 只作叠加标注。';

/** 拒收门三问（第 0 步；任一「否」即拒收）
 * termId：该问涉及的术语，渲染时包 <Term> 给出人话与口径（键与 testId 不变）。
 */
const GATE_QS: { key: string; label: string; hint: string; termId?: string }[] = [
  { key: 'Q0_1', label: '有地方可以查到这件事的真实结果', hint: '查不到就没法判对错', termId: 'truthAnchor' },
  { key: 'Q0_2', label: '看答案之前，答案还没发生', hint: '否则等于提前看到答案', termId: 'cutoff' },
  { key: 'Q0_3', label: '结果不是一成不变的', hint: '恒定的题没有判断价值', termId: 'prereg' },
];

/** 六层问答（数量固定；与后端 QUESTION_COUNT 一致，不可增删）
 *  plain＝人话问句（界面显示）｜formal＝判据原句（收进 Term 浮层，供专业核对）
 *  铁律：专业原句一个不删，只是不再糊在第一屏。
 */
const LAYERS: { id: string; name: string; qs: { plain: string; formal: string }[] }[] = [
  { id: 'L5', name: '纯运气', qs: [
    { plain: '结果来自公开的随机机制（如彩票摇号）', formal: '结果由认证随机源产生（机制可查）' },
    { plain: '没人能靠公开信息提前知道', formal: '不存在公开渠道的信息优势路径' },
    { plain: '题目本身没有可利用的偏倚', formal: '题面无统计学偏倚可利用' },
  ] },
  { id: 'L6', name: '有人跟你斗', qs: [
    { plain: '结果由利益相关的人现场决定', formal: '结果由利益相反的智慧主体决策直接产生' },
    { plain: '对手能看到你的历史打法并调整', formal: '对手能观测我方历史并调整' },
    { plain: '可选策略多到数不完', formal: '策略空间开放不可枚举' },
    { plain: '存在可以伪装、误导的空间', formal: '存在声称与意图可分离的伪装结构' },
  ] },
  { id: 'L1', name: '算得出来', qs: [
    { plain: '可能的情况数得过来', formal: '状态空间有限且完全可枚举' },
    { plain: '规则公开，没有隐藏的随机因素', formal: '转移规则完全已知且无隐藏随机源' },
    { plain: '任何人拿到公开信息都能推出同样结果', formal: '任一观察者仅凭公开状态即可推演' },
    { plain: '电脑能算出结果，不需要人裁决', formal: 'resolve 可程序复算（无裁判裁量）' },
  ] },
  { id: 'L3', name: '短期内可算', qs: [
    { plain: '知道它大致怎么变化', formal: '存在已知或可近似的演化机制' },
    { plain: '能算的窗口很短（v2 阈值 1.5）', formal: '窗口显著短于该系统的时界（v2 阈值 1.5）' },
    { plain: '有实时数据可以持续修正', formal: '有实时观测流可在窗口内同化' },
    { plain: '结果会在这个短窗口内出来', formal: 'resolve 落在窗口内' },
  ] },
  { id: 'L2', name: '有大量历史', qs: [
    { plain: '这类事反复发生过，性质稳定', formal: '题面定义于稳定可重复总体' },
    { plain: '有 30 条以上同类的历史结果', formal: '存在 ≥30 条同型历史结果' },
    { plain: '单看这一次推不出结果', formal: '单事件不可由现有信息决定性推出' },
    { plain: '有外部统计可以作为参照', formal: '存在外部统计源可作基率锚' },
  ] },
  { id: 'L4', name: '会被影响', qs: [
    { plain: '结果由人决定，而且决策者可能看到这个记录', formal: '由人类决策产生且决策者可能接触本账本' },
    { plain: '存在「看到结果又反过来影响结果」的回路', formal: '存在反馈回路证据或机制描述' },
    { plain: '不属于前面任何一类', formal: '无法归入 L1-L3／L5' },
  ] },
];
type Layers = Record<string, boolean[]>;
const emptyLayers = (): Layers => {
  const o: Layers = {};
  for (const l of LAYERS) o[l.id] = l.qs.map(() => false);
  return o;
};
const EMPTY_SPEC = { kind: '', url_template: '', field: '', threshold: '', cmp: '', date: '' };
type Spec = typeof EMPTY_SPEC;

export default function IntakePage() {
  const [statement, setStatement] = useState('');
  const [gate, setGate] = useState<Record<string, boolean>>({ Q0_1: true, Q0_2: true, Q0_3: true });
  const [layers, setLayers] = useState<Layers>(emptyLayers);
  /** 六层卡折叠态：默认展开决策序首层（L5），其余收起 ⇒ 一屏可见且不至于”看不到题“ */
  const [openLayers, setOpenLayers] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    if (LAYERS[0]) o[LAYERS[0].id] = true;
    return o;
  });
  const [spec, setSpec] = useState<Spec>(EMPTY_SPEC);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [result, setResult] = useState<IntakeClassifyResult | null>(null);
  const [rejects, setRejects] = useState<IntakeRejectsResult | null>(null);
  const [questions, setQuestions] = useState<IntakeQuestionsResult | null>(null);
  const [sideErr, setSideErr] = useState<string | null>(null);

  const refreshSide = useCallback(async () => {
    setSideErr(null);
    try {
      const [rj, qs] = await Promise.all([api.listIntakeRejects({ limit: 20 }), api.listIntakeQuestions({ limit: 20 })]);
      setRejects(rj); setQuestions(qs);
    } catch (e) { setSideErr(errMsg(e)); }
  }, []);
  useEffect(() => { void refreshSide(); }, [refreshSide]);

  const toggleGate = (k: string) => setGate((g) => ({ ...g, [k]: !g[k] }));
  const toggleQ = (lid: string, i: number) => setLayers((prev) => {
    const next: Layers = { ...prev, [lid]: prev[lid].slice() };
    next[lid][i] = !next[lid][i];
    return next;
  });
  const setSpecField = (k: keyof Spec, v: string) => setSpec((s) => ({ ...s, [k]: v }));

  const buildBody = () => {
    const checklist: Record<string, boolean | boolean[]> = { Q0_1: !!gate.Q0_1, Q0_2: !!gate.Q0_2, Q0_3: !!gate.Q0_3 };
    for (const l of LAYERS) checklist[l.id] = layers[l.id].slice();
    const rs: Record<string, unknown> = {};
    if (spec.kind.trim()) rs.kind = spec.kind.trim();
    if (spec.url_template.trim()) rs.url_template = spec.url_template.trim();
    if (spec.field.trim()) rs.field = spec.field.trim();
    if (spec.threshold.trim()) { const n = Number(spec.threshold); rs.threshold = Number.isFinite(n) ? n : spec.threshold.trim(); }
    if (spec.cmp.trim()) rs.cmp = spec.cmp.trim();
    if (spec.date.trim()) rs.date = spec.date.trim();
    const body: { statement: string; checklist: Record<string, boolean | boolean[]>; resolve_spec?: Record<string, unknown> } = { statement: statement.trim(), checklist };
    if (Object.keys(rs).length) body.resolve_spec = rs;
    return body;
  };

  const submit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setFormErr(null); setResult(null);
    if (!statement.trim()) { setFormErr('题面不能为空'); return; }
    setBusy(true);
    try {
      const r = await api.classifyIntake(buildBody());
      setResult(r);
      await refreshSide();
    } catch (err) {
      setFormErr(errMsg(err)); // 400：把后端 message 原样显示
    } finally { setBusy(false); }
  };
  return (
    <section className="page" data-testid="intake-page">
      <div className="intake-banner" role="note" data-testid="intake-banner">开放接题 · 只记不评 · 分层账本</div>

      <header className="intake-head">
        <h2><IconPen size={18} /> 开放接题</h2>
        <p className="intake-sub">填题面 → 过三道必答关 → 挑出它算哪一类；本页只做登记，不改已有记录。</p>
      </header>

      <div className="intake-grid">
        {/* ── 左栏：接题表单 ── */}
        <form className="intake-card" onSubmit={submit} data-testid="intake-form">
          <h3 className="intake-card-title">① 这道题在问什么</h3>
          <label className="intake-label" htmlFor="intake-statement">题面（必填）</label>
          <textarea id="intake-statement" className="intake-textarea" rows={3} value={statement}
            placeholder="例：2026-09-12 上海最高气温超过 35°C"
            onChange={(e) => setStatement(e.target.value)} data-testid="intake-statement" />

          <details className="intake-advanced">
            <summary>真值锚参数（可选，多数题不用填）</summary>
            <p className="intake-note" style={{ marginTop: 0 }}>
              想让系统自动核对这道题的结果，就在这里说明「去哪里查、查什么、怎么算过」。
              不确定就留空——留空不影响接题。
            </p>
            <div className="intake-spec-grid">
              <label>数据类型<input className="intake-input" value={spec.kind} onChange={(e) => setSpecField('kind', e.target.value)} placeholder="官方统计 / 比赛结果 / 价格" /></label>
              <label>查询地址<input className="intake-input" value={spec.url_template} onChange={(e) => setSpecField('url_template', e.target.value)} placeholder="https://…" /></label>
              <label>取哪一项<input className="intake-input" value={spec.field} onChange={(e) => setSpecField('field', e.target.value)} placeholder="如 当日最高气温" /></label>
              <label>判定阈值<input className="intake-input" value={spec.threshold} onChange={(e) => setSpecField('threshold', e.target.value)} placeholder="35" /></label>
              <label>比较方式<input className="intake-input" value={spec.cmp} onChange={(e) => setSpecField('cmp', e.target.value)} placeholder="大于 / 不小于 / 小于" /></label>
              <label>核对日期<input className="intake-input" value={spec.date} onChange={(e) => setSpecField('date', e.target.value)} placeholder="2026-09-12" /></label>
            </div>
            <p className="intake-note">六项都可留空；填了数据类型才会随请求提交。</p>
          </details>

          <h3 className="intake-card-title">② 三道必过关（不满足就不收）</h3>
          <div className="intake-gate-list">
            {GATE_QS.map((q) => (
              <label className={'intake-check intake-check-row' + (gate[q.key] ? ' is-on' : ' is-off')} key={q.key} data-testid={'intake-gate-' + q.key}>
                <input type="checkbox" checked={!!gate[q.key]} onChange={() => toggleGate(q.key)} />
                <span className="intake-check-text">
                  {q.termId ? <Term id={q.termId} plain={q.label} /> : q.label}
                  <i className="intake-hint">{q.hint}</i>
                </span>
                <span className="intake-check-mark" aria-hidden>{gate[q.key] ? '✓' : '—'}</span>
              </label>
            ))}
          </div>

          <h3 className="intake-card-title">③ 这道题算哪种类型</h3>
          <p className="intake-note">{DECISION_ORDER_NOTE}</p>
          <div className="intake-layer-grid">
            {LAYERS.map((l) => {
              const picked = layers[l.id].filter(Boolean).length;
              const total = l.qs.length;
              const full = picked === total;
              const open = openLayers[l.id];
              return (
                <div className={'intake-layer-card' + (full ? ' is-full' : '') + (open ? ' is-open' : '')} key={l.id} data-testid={'intake-layer-' + l.id}>
                  <button type="button" className="intake-layer-toggle" aria-expanded={open}
                    onClick={() => setOpenLayers((prev) => ({ ...prev, [l.id]: !prev[l.id] }))}>
                    <span className="intake-layer-id">{l.id}</span>
                    <span className="intake-layer-name"><Term id="layer" plain={l.name} /></span>
                    <span className="intake-layer-count">{picked}/{total}</span>
                  </button>
                  {open && (
                    <div className="intake-layer-body">
                      {l.qs.map((q, i) => (
                        <label className={'intake-check intake-check-row' + (layers[l.id][i] ? ' is-on' : '')} key={i}>
                          <input type="checkbox" checked={!!layers[l.id][i]} onChange={() => toggleQ(l.id, i)} data-testid={'intake-q-' + l.id + '-' + i} />
                          <span className="intake-check-text">
                            <Term id="layer" plain={q.plain} formal={q.formal} />
                          </span>
                          <span className="intake-check-mark" aria-hidden>{layers[l.id][i] ? '✓' : ''}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="intake-note">逐个核对：最先全部勾上的那层就是归属层；五层都没勾满则记为 unknown。</p>

          <button type="submit" className="intake-submit" disabled={busy} data-testid="intake-submit">
            {busy ? '提交中…' : '提交分类'}
          </button>
          {formErr && <div className="intake-error" role="alert" data-testid="intake-form-error">{formErr}</div>}
        </form>

        {/* ── 右栏：结果卡 + 拒收分布 + 接题库 ── */}
        <div className="intake-side">
          {result && (
            <div className={'intake-card intake-result ' + (result.rejected ? 'is-reject' : 'is-ok')} data-testid="intake-result">
              <h3 className="intake-card-title">分类结果</h3>
              {result.rejected ? (
                <p className="intake-verdict">
                  这道题没收 · 原因：<b>{result.reason === 'no_anchor' ? <Term id="truthAnchor" plain={REASON_LABEL[result.reason ?? ''] ?? '—'} /> : result.reason === 'leak' ? <Term id="cutoff" plain={REASON_LABEL[result.reason ?? ''] ?? '—'} /> : REASON_LABEL[result.reason ?? ''] ?? '—'}</b>
                </p>
              ) : (
                <p className="intake-verdict">
                  已收下 · 归为 <b>{result.layer ?? '—'}</b> 类{result.secondary ? '（另有叠加标记 ' + result.secondary + '）' : ''}
                </p>
              )}
              <div className="intake-kv"><span>判定结果</span><b>{result.rejected ? '未通过' : '通过'}</b></div>
              <div className="intake-kv"><span>归属层（机算）</span><b>{(result.layer ?? '—') + '（' + (result.computed_layer ?? '—') + '）'}</b></div>
              <div className="intake-kv"><span>叠加层</span><b>{result.secondary ?? '无'}</b></div>
              <div className="intake-kv"><span>取数引擎</span><b>{(result.engine ?? '—') + (result.engine_plan?.calibrator ? ' + ' + result.engine_plan.calibrator : '')}</b></div>
              <div className="intake-kv"><span>是否计分</span><b title={result.gate ? '原始状态：' + result.gate : undefined}>{gateHuman(result.gate) + (result.gate_reason ? '（' + result.gate_reason + '）' : '')}</b></div>
              <div className="intake-kv"><span><Term id="checklistHash" plain="判据版本号" /></span><b>{result.checklist_hash ?? '—'}</b></div>
              {typeof result.prob === 'number' && (
                <div className="intake-kv"><span>参考读数</span><b>{result.prob}{result.prob_ci ? '（区间 ' + result.prob_ci[0] + '–' + result.prob_ci[1] + '）' : ''}</b></div>
              )}
              {result.engine_note && <p className="intake-note">{result.engine_note}</p>}
              <details className="intake-fold"><summary>原始返回（逐字段核验）</summary><pre className="intake-pre">{JSON.stringify(result, null, 1)}</pre></details>
            </div>
          )}
          <div className="intake-card" data-testid="intake-rejects">
            <div className="intake-card-head">
              <h3 className="intake-card-title">拒收原因分布</h3>
              <button type="button" className="intake-mini" onClick={() => void refreshSide()} data-testid="intake-refresh">刷新</button>
            </div>
            {sideErr && <div className="intake-error" role="alert" data-testid="intake-side-error">{sideErr}</div>}
            {rejects ? (
              <>
                <p className="intake-note">合计 {rejects.total} 条 · 分布含 0 计数（防 Goodhart：分布须可见）</p>
                {rejects.by_reason.map((r) => (
                  <div className="intake-kv" key={r.reason} data-testid={'intake-reason-' + r.reason}>
                    <span>{r.reason} · {REASON_LABEL[r.reason] ?? ''}</span><b>{r.n}</b>
                  </div>
                ))}
              </>
            ) : <p className="intake-note">读取中…</p>}
          </div>

          <div className="intake-card" data-testid="intake-questions">
            <h3 className="intake-card-title">接题库（最新 20 条 · 只读）</h3>
            {questions ? (
              <div className="intake-table-wrap">
                <table className="intake-table" data-testid="intake-questions-table">
                  <thead><tr><th>编号</th><th>题面</th><th>层</th><th>是否计分</th><th>读数</th><th>落库时间</th></tr></thead>
                  <tbody>
                    {questions.items.map((q) => (
                      <tr key={q.id} data-testid={'intake-q-row-' + q.id}>
                        <td>{q.id}</td>
                        <td className="intake-stmt" title={q.statement}>{q.statement}</td>
                        <td>{q.layer ?? '—'}</td>
                        <td title={q.gate ? '原始状态：' + q.gate : undefined}>{gateHuman(q.gate)}</td>
                        <td>{q.prob == null ? '—' : q.prob}</td>
                        <td>{q.created_at}</td>
                      </tr>
                    ))}
                    {questions.items.length === 0 && <tr><td colSpan={6} className="intake-note">暂无接题记录</td></tr>}
                  </tbody>
                </table>
              </div>
            ) : <p className="intake-note">读取中…</p>}
            {questions && <p className="intake-note">{questions.note}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

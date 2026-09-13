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

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const REASON_LABEL: Record<string, string> = {
  no_anchor: '无真值锚', leak: '判据泄漏（cutoff 太晚）', tautology: '重言（结果恒定）', other: '其他',
};

/** 拒收门三问（第 0 步；任一「否」即拒收） */
const GATE_QS: { key: string; label: string; hint: string }[] = [
  { key: 'Q0_1', label: 'Q0-1 存在可机检／第三方可复核的真值锚', hint: '否 → 拒收 no_anchor' },
  { key: 'Q0_2', label: 'Q0-2 cutoff（判据冻结）早于事件决定性时点', hint: '否 → 拒收 leak' },
  { key: 'Q0_3', label: 'Q0-3 结果随实例变化（恒定即拒收）', hint: '否 → 拒收 tautology' },
];

/** 六层问答（数量固定；条目为判据摘要，禁形容词） */
const LAYERS: { id: string; name: string; qs: string[] }[] = [
  { id: 'L5', name: '不可约随机', qs: ['结果由认证随机源产生（机制可查）', '不存在公开渠道的信息优势路径', '题面无统计学偏倚可利用'] },
  { id: 'L6', name: '对抗', qs: ['结果由利益相反的智慧主体决策直接产生', '对手能观测我方历史并调整', '策略空间开放不可枚举', '存在声称与意图可分离的伪装结构'] },
  { id: 'L1', name: '决定论', qs: ['状态空间有限且完全可枚举', '转移规则完全已知且无隐藏随机源', '任一观察者仅凭公开状态即可推演', 'resolve 可程序复算（无裁判裁量）'] },
  { id: 'L3', name: '短窗混沌', qs: ['存在已知或可近似的演化机制', '窗口显著短于该系统的时界（v2 阈值 1.5）', '有实时观测流可在窗口内同化', 'resolve 落在窗口内'] },
  { id: 'L2', name: '系综', qs: ['题面定义于稳定可重复总体', '存在 ≥30 条同型历史结果', '单事件不可由现有信息决定性推出', '存在外部统计源可作基率锚'] },
  { id: 'L4', name: '自反（叠加层）', qs: ['由人类决策产生且决策者可能接触本账本', '存在反馈回路证据或机制描述', '无法归入 L1-L3／L5'] },
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
        <h2>✍️ 开放接题</h2>
        <p className="intake-sub">拒收门三问 → 六层判定 → 引擎位；本页只调用接题接口，不做任何库写。</p>
      </header>

      <div className="intake-grid">
        {/* ── 左栏：接题表单 ── */}
        <form className="intake-card" onSubmit={submit} data-testid="intake-form">
          <h3 className="intake-card-title">① 题面与判据</h3>
          <label className="intake-label" htmlFor="intake-statement">题面（statement，必填）</label>
          <textarea id="intake-statement" className="intake-textarea" rows={3} value={statement}
            placeholder="例：2026-09-12 上海最高气温 > 35°C（cutoff=2026-09-11 20:00，真值锚=气象台官方日最高气温）"
            onChange={(e) => setStatement(e.target.value)} data-testid="intake-statement" />

          <h3 className="intake-card-title">② resolve_spec（真值锚参数，全部可选）</h3>
          <div className="intake-spec-grid">
            <label>kind<input className="intake-input" value={spec.kind} onChange={(e) => setSpecField('kind', e.target.value)} placeholder="official_stat" /></label>
            <label>url_template<input className="intake-input" value={spec.url_template} onChange={(e) => setSpecField('url_template', e.target.value)} placeholder="https://…" /></label>
            <label>field<input className="intake-input" value={spec.field} onChange={(e) => setSpecField('field', e.target.value)} placeholder="daily_high_temp" /></label>
            <label>threshold<input className="intake-input" value={spec.threshold} onChange={(e) => setSpecField('threshold', e.target.value)} placeholder="35" /></label>
            <label>cmp<input className="intake-input" value={spec.cmp} onChange={(e) => setSpecField('cmp', e.target.value)} placeholder="gt / gte / lt" /></label>
            <label>date<input className="intake-input" value={spec.date} onChange={(e) => setSpecField('date', e.target.value)} placeholder="2026-09-12" /></label>
          </div>
          <p className="intake-note">resolve_spec 只在 kind 非空时随请求提交；六项皆可留空。</p>

          <h3 className="intake-card-title">③ 拒收门三问（默认勾选=是）</h3>
          {GATE_QS.map((q) => (
            <label className="intake-check" key={q.key} data-testid={'intake-gate-' + q.key}>
              <input type="checkbox" checked={!!gate[q.key]} onChange={() => toggleGate(q.key)} />
              <span>{q.label}<i className="intake-hint">{q.hint}</i></span>
            </label>
          ))}
          <h3 className="intake-card-title">④ 六层问答（勾选=是；个数固定）</h3>
          {LAYERS.map((l) => (
            <div className="intake-layer" key={l.id} data-testid={'intake-layer-' + l.id}>
              <div className="intake-layer-head"><b>{l.id}</b> {l.name}<span className="intake-layer-count">{l.qs.length} 问</span></div>
              {l.qs.map((q, i) => (
                <label className="intake-check" key={i}>
                  <input type="checkbox" checked={!!layers[l.id][i]} onChange={() => toggleQ(l.id, i)} data-testid={'intake-q-' + l.id + '-' + i} />
                  <span>{q}</span>
                </label>
              ))}
            </div>
          ))}
          <p className="intake-note">首个全绿层即归属层；五层皆非全绿 → unknown。L4 只作叠加标注（不单独作 primary）。</p>

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
                <p className="intake-verdict">已拒收 · reason=<b>{result.reason}</b>（{REASON_LABEL[result.reason ?? ''] ?? '—'}）· 留痕 reject_id={result.reject_id}</p>
              ) : (
                <p className="intake-verdict">通过 · layer=<b>{result.layer}</b>{result.secondary ? ' ＋ secondary=' + result.secondary : ''} · 已落接题库 id={result.intake_question_id}</p>
              )}
              <div className="intake-kv"><span>ok / rejected</span><b>{String(result.ok)} / {String(result.rejected)}</b></div>
              <div className="intake-kv"><span>layer（computed）</span><b>{(result.layer ?? '—') + '（' + (result.computed_layer ?? '—') + '）'}</b></div>
              <div className="intake-kv"><span>secondary</span><b>{result.secondary ?? '—'}</b></div>
              <div className="intake-kv"><span>engine</span><b>{(result.engine ?? '—') + (result.engine_plan?.calibrator ? ' + ' + result.engine_plan.calibrator : '')}</b></div>
              <div className="intake-kv"><span>gate</span><b>{(result.gate ?? '—') + (result.gate_reason ? '（' + result.gate_reason + '）' : '')}</b></div>
              <div className="intake-kv"><span>checklist_hash</span><b>{result.checklist_hash ?? '—'}</b></div>
              {typeof result.prob === 'number' && (
                <div className="intake-kv"><span>分层引擎参考读数</span><b>{result.prob}{result.prob_ci ? '（CI ' + result.prob_ci[0] + '–' + result.prob_ci[1] + '）' : ''}</b></div>
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
              <table className="intake-table" data-testid="intake-questions-table">
                <thead><tr><th>id</th><th>题面</th><th>层</th><th>gate</th><th>读数</th><th>落库</th></tr></thead>
                <tbody>
                  {questions.items.map((q) => (
                    <tr key={q.id} data-testid={'intake-q-row-' + q.id}>
                      <td>{q.id}</td>
                      <td className="intake-stmt" title={q.statement}>{q.statement}</td>
                      <td>{q.layer ?? '—'}</td>
                      <td>{q.gate ?? '—'}</td>
                      <td>{q.prob == null ? '—' : q.prob}</td>
                      <td>{q.created_at}</td>
                    </tr>
                  ))}
                  {questions.items.length === 0 && <tr><td colSpan={6} className="intake-note">暂无接题记录</td></tr>}
                </tbody>
              </table>
            ) : <p className="intake-note">读取中…</p>}
            {questions && <p className="intake-note">{questions.note}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

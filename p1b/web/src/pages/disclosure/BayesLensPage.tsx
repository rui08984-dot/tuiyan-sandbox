/**
 * BayesLensPage —— 贝叶斯语义透镜页（第 4 期 I6 · 2026-09-21）
 *
 * 依据：15 号件 §I6「做按题展示『先验／似然证据／后验聚合／校准』四标签的只读页——
 *   v3.0 第 5 层『可解释』原则的真实现」；前置＝terms.ts（术语真源）＋ stage4 读数件的 bayes_legend 六档语义。
 * 数据源：GET /api/disclosure/bayes-lens（后端只返回**精简投影**：六档语义 ＋ 按层/按域既有列；
 *   缺件 404 带生成命令 —— 本页如实显示 n/a，绝不编数）。
 * 纪律：①**零新读数**（只复用既有披露件的现成字段）②恒挂限定语块 ③UI 禁用铁律②所列禁词
 *   ④**页内声明口径差异**：本页读引擎重放口径（stage4 件），与 /api/audit/summary 的账本口径不可互搬。
 */
import { useEffect, useState } from 'react';
import { Term, IconChart } from '../../components/ui';

type Sem = { role: string; note: string };
type LayerRow = { layer: string; ledger_rows: number | null; scored_n: number | null; brier_engine: number | null };
type DomainRow = {
  layer: string; domain: string; scored_n: number; conclusion_allowed: boolean;
  mean_p: number | null; obs_rate: number | null; brier_engine: number | null;
};
type LensJson = {
  source_file: string; generated_at: string | null;
  bayes_legend: { source?: string; note?: string; map?: Record<string, Sem> } | null;
  layers: LayerRow[]; domains: DomainRow[];
  cells_total: number | null; cells_with_conclusion: number | null;
};
const QUALIFICATION_BLOCK = [
  '重放计分（读侧）：本页数字来自引擎重放，账本 gate=descriptive 未计分；baseline_brier 列从未写入。',
  '过程能力门（G2）不含质量读数（门定性恒挂限定语）；对外表述一律挂限定语。',
  'n<30 的格只记方向、不出结论；格间禁池化。',
];
/** 四标签 → terms.ts 的 term id（术语真源，不新造词） */
const LABELS: Array<{ key: string; termId: string; label: string; plain: string }> = [
  { key: 'prior', termId: 'bayesPrior', label: '先验', plain: '看线索之前的起点：历史基率' },
  { key: 'likelihood', termId: 'likelihoodEvidence', label: '似然证据', plain: '线索带来的证据行' },
  { key: 'posterior', termId: 'posteriorAgg', label: '后验聚合', plain: '证据合成后的读数' },
  { key: 'calibration', termId: 'calibrationAci', label: '校准', plain: '区间随漂移调整' },
];
const f = (x: number | null) => (x === null || x === undefined || !isFinite(Number(x))) ? 'n/a' : Number(x).toFixed(4);

export default function BayesLensPage() {
  const [data, setData] = useState<LensJson | null>(null);
  const [missing, setMissing] = useState<{ hint?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/disclosure/bayes-lens')
      .then(async (r) => { if (!r.ok) throw await r.json().catch(() => ({})); return r.json(); })
      .then((j) => { if (alive) setData(j as LensJson); })
      .catch((e) => { if (alive) setMissing({ hint: (e && e.hint) || 'node p1b/scripts/stage4-run.cjs --text <out> --json <out>' }); });
    return () => { alive = false; };
  }, []);

  if (missing) {
    return (
      <div className="ui-stack">
        <h1 className="ui-section-title">贝叶斯语义透镜</h1>
        <div className="ui-empty">披露件暂缺（n/a）。生成命令：<code>{missing.hint}</code></div>
      </div>
    );
  }
  if (!data) return <div className="ui-skeleton">读取披露件…</div>;

  const map = (data.bayes_legend && data.bayes_legend.map) || null;
  const layers = Array.isArray(data.layers) ? data.layers : [];
  const domains = Array.isArray(data.domains) ? data.domains : [];
  const okDomains = domains.filter((d) => d.conclusion_allowed);

  return (
    <div className="ui-stack">
      <h1 className="ui-section-title"><IconChart size={16} /> 贝叶斯语义透镜</h1>
      <p className="ui-note">
        一个分层账本里的读数，可以拆成四段看：<b>先验</b>（不看线索时的起点）→ <b>似然证据</b>（线索给了什么）→
        <b>后验聚合</b>（合成后的读数）→ <b>校准</b>（区间是否随漂移调整）。
        这一页让你看出「这次错在先验还是似然」。
      </p>

      <section className="ui-section">
        <h2 className="ui-section-title">限定语块</h2>
        <ul className="ui-note">{QUALIFICATION_BLOCK.map((q, i) => <li key={i}>{q}</li>)}</ul>
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">四标签</h2>
        <div className="ui-kv">
          {LABELS.map((l) => (
            <div className="ui-kv-row" key={l.key}>
              <span className="ui-kv-key"><Term id={l.termId}>{l.label}</Term></span>
              <span className="ui-kv-val">{l.plain}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">六层语义档（各层的概率角色）</h2>
        {map ? (
          <div className="ui-kv">
            {['L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map((L) => {
              const s = map[L];
              return (
                <div className="ui-kv-row" key={L}>
                  <span className="ui-kv-key">{L} · <Term id="layer">{s ? s.role : 'n/a'}</Term></span>
                  <span className="ui-kv-val">{s ? s.note : 'n/a（旧件无此键）'}</span>
                </div>
              );
            })}
          </div>
        ) : <div className="ui-empty">n/a（缺语义档）</div>}
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">按层读数（引擎重放口径）</h2>
        {layers.length ? (
          <table className="ui-matrix">
            <thead><tr><th>层</th><th>账本行</th><th>可计分 n</th><th>Brier</th></tr></thead>
            <tbody>
              {layers.map((r) => (
                <tr key={r.layer}><td>{r.layer}</td><td>{r.ledger_rows === null ? 'n/a' : r.ledger_rows}</td><td>{r.scored_n === null ? 'n/a' : r.scored_n}</td><td>{f(r.brier_engine)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <div className="ui-empty">n/a</div>}
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">可出结论的域（{okDomains.length} 格，n≥30）</h2>
        {okDomains.length ? (
          <table className="ui-matrix">
            <thead><tr><th>层</th><th>域</th><th>n</th><th>平均 p（先验/后验）</th><th>观测率</th><th>Brier</th></tr></thead>
            <tbody>
              {okDomains.map((d) => (
                <tr key={d.layer + '/' + d.domain}>
                  <td>{d.layer}</td><td>{d.domain}</td><td>{d.scored_n}</td>
                  <td>{f(d.mean_p)}</td><td>{f(d.obs_rate)}</td><td>{f(d.brier_engine)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="ui-empty">n/a（暂无 n≥30 的格）</div>}
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">口径边界（两口径不可互搬）</h2>
        <p className="ui-note">
          A｜账本口径：审计页 <code>/api/audit/summary</code> → <code>layer_calibration</code>（读账本 <code>assigned_prob</code>）。
          B｜引擎重放口径：<b>本页</b>（读 stage4 读数件 <code>{data.source_file}</code>）。
          两口径数字不同源、不可互相搬运；本页只用 B。
        </p>
      </section>
    </div>
  );
}

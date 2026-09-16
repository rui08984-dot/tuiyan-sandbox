/**
 * CalibrationReportPage —— 分域格校准报告页（P0-U8 页面化 · 2026-09-16）
 *
 * 数据源：GET /api/disclosure/calibration（只读披露件 `p1b/sim/out/calibration-report-<date>.json`；
 *   缺件时后端 404 带生成命令 —— 本页如实显示 n/a，绝不编数）。
 * 口径：只呈现既有读数件里的现成列（零新算）；n<30 的格只记方向；格间禁池化；
 *   限定语块恒挂（重放计分披露 / 过程能力门不含质量读数 / 对外挂限定语）。
 * 词汇：贝叶斯语义经 <Term> 渐进披露（术语真源 p1b/web/src/lib/terms.ts）。
 */
import { useEffect, useState } from 'react';
import { Term, IconChart } from '../../components/ui';

type Cell = {
  layer: string; domain: string; scored_n: number; conclusion_allowed: boolean;
  mean_p: number | null; obs_rate: number | null; brier_engine: number | null;
  delta_vs_half: number | null; delta_ci95: { lb: number | null; ub: number | null } | null;
};
type RepJson = {
  title: string; generated_at: string;
  stage4_present: boolean; stage4_file: string;
  qualification_block: string[];
  leakage_statement: { excluded_rows: number | null; fingerprint: string | null; text: string };
  bayes_semantics: Record<string, { role: string; note: string } | null> | null;
  cells: Cell[]; cells_total: number | null; cells_with_conclusion: number | null;
};
const SEM_LABEL: Record<string, string> = {
  L1: '决定论复算', L2: '先验', L3: '先验＋校准', L4: '标注层', L5: '认证分布', L6: '后验聚合',
};
const SEM_TERM: Record<string, string> = {
  L1: 'layer', L2: 'bayesPrior', L3: 'calibrationAci', L4: 'layer', L5: 'truthAnchor', L6: 'posteriorAgg',
};
const f = (x: number | null) => (x === null || x === undefined || !isFinite(Number(x))) ? 'n/a' : Number(x).toFixed(4);

export default function CalibrationReportPage() {
  const [data, setData] = useState<RepJson | null>(null);
  const [missing, setMissing] = useState<{ hint?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/disclosure/calibration')
      .then(async (r) => { if (!r.ok) throw await r.json().catch(() => ({})); return r.json(); })
      .then((j) => { if (alive) setData(j as RepJson); })
      .catch((e) => { if (alive) setMissing({ hint: (e && e.hint) || 'node p1b/scripts/calibration-report.cjs' }); });
    return () => { alive = false; };
  }, []);

  if (missing) {
    return (
      <div className="ui-stack">
        <h1 className="ui-section-title">分域格校准报告</h1>
        <div className="ui-empty">披露件暂缺（n/a）。生成命令：<code>{missing.hint}</code></div>
      </div>
    );
  }
  if (!data) return <div className="ui-skeleton">读取披露件…</div>;

  return (
    <div className="ui-stack">
      <h1 className="ui-section-title"><IconChart size={16} /> 分域格校准报告</h1>

      <section className="ui-section">
        <h2 className="ui-section-title">限定语块</h2>
        <ul className="ui-note">{data.qualification_block.map((q, i) => <li key={i}>{q}</li>)}</ul>
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">五层语义（记账语言）</h2>
        {data.bayes_semantics ? (
          <div className="ui-kv">
            {Object.keys(data.bayes_semantics).sort().map((L) => {
              const bs = data.bayes_semantics![L];
              return (
                <div className="ui-kv-row" key={L}>
                  <span className="ui-kv-key">{L} · <Term id={SEM_TERM[L]}>{SEM_LABEL[L]}</Term></span>
                  <span className="ui-kv-val">{bs ? bs.role + '（' + bs.note + '）' : 'n/a（旧件无此键）'}</span>
                </div>
              );
            })}
          </div>
        ) : <div className="ui-empty">n/a（缺读数件）</div>}
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">分域格校准表（{data.cells_total === null ? 'n/a' : data.cells_total + ' 格'}；可出结论 {data.cells_with_conclusion === null ? 'n/a' : data.cells_with_conclusion}）</h2>
        {data.cells && data.cells.length ? (
          <table className="ui-matrix">
            <thead><tr><th>层</th><th>域</th><th>n</th><th>平均 p</th><th>观测率</th><th>Brier</th><th>Δ(vs 0.5)</th><th>95% CI</th><th>结论</th></tr></thead>
            <tbody>
              {data.cells.map((c) => (
                <tr key={c.layer + '/' + c.domain}>
                  <td>{c.layer}</td><td>{c.domain}</td><td>{c.scored_n}</td>
                  <td>{f(c.mean_p)}</td><td>{f(c.obs_rate)}</td><td>{f(c.brier_engine)}</td><td>{f(c.delta_vs_half)}</td>
                  <td>{c.delta_ci95 && c.delta_ci95.lb !== null ? '[' + f(c.delta_ci95.lb) + ',' + f(c.delta_ci95.ub) + ']' : 'n/a'}</td>
                  <td>{c.conclusion_allowed ? '可出结论' : 'n<30 仅方向'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="ui-empty">n/a（缺读数件或缺分域键）</div>}
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">防泄漏声明</h2>
        <p className="ui-note">{data.leakage_statement.text}</p>
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">口径边界</h2>
        <p className="ui-note">
          A｜账本口径：审计页 /api/audit/summary → layer_calibration（读账本 assigned_prob）。
          B｜引擎重放口径：本报告（读 stage4 读数件）。两口径不可互相搬运；本报告只用 B。
        </p>
      </section>
    </div>
  );
}

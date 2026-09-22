/**
 * BayesLensPage —— 贝叶斯语义透镜页（第 4 期 I6 · 2026-09-21）
 *
 * 依据：15 号件 §I6「做按题展示『先验／似然证据／后验聚合／校准』四标签的只读页——
 *   v3.0 第 5 层『可解释』原则的真实现」；前置＝terms.ts（术语真源）＋ stage4 读数件的 bayes_legend 六档语义。
 * 数据源：GET /api/disclosure/bayes-lens（后端只返回**精简投影**：六档语义 ＋ 按层/按域既有列；
 *   缺件 404 带生成命令 —— 本页如实显示 n/a，绝不编数）。
 * 纪律：①**零新读数**（只复用既有披露件的现成字段）②恒挂限定语块 ③UI 禁用铁律②所列禁词
 *   ④**页内声明口径差异**：本页读引擎重放口径（stage4 件），与 /api/audit/summary 的账本口径不可互搬。
 *
 * ── 2026-09-22 全方面重构（第一批 · 五页之一）──
 *   ① 按层读数 → 六色扇形仪表（Brier）＋ 嵌套条（账本行 vs 可计分 n）
 *   ② 可出结论的域 → 热力网格（5×27，brier_engine）
 *   ③ 先验曲线（o7_maxent，若有 beta 参数则画，没有则留空态）
 *   ④ 每张图都挂元信息行（源件+生成时点）＋ 数值兜底（表格替身）
 *   ★ 红线：空态文案「n/a」「样本不足」原样保留；无数据格 ≠ Brier 0 的好格。
 */
import { useEffect, useState } from 'react';
import { Term, IconChart, EmptyState } from '../../components/ui';
import { ChartFrame, Gauge, HeatGrid, Histogram, NestedBar } from '../../charts';
import type { HeatCell } from '../../charts';
import { quad, int } from '../../lib/format';

type Sem = { role: string; note: string };
type LayerRow = { layer: string; ledger_rows: number | null; scored_n: number | null; brier_engine: number | null };
type DomainRow = {
  layer: string; domain: string; scored_n: number; conclusion_allowed: boolean;
  mean_p: number | null; obs_rate: number | null; brier_engine: number | null;
};
type LensJson = {
  source_file: string; generated_at: string | null;
  bayes_legend: { source?: string; note?: string; map?: Record<string, Sem>; map_v2?: Record<string, Sem> } | null;
  layers: LayerRow[]; domains: DomainRow[];
  cells_total: number | null; cells_with_conclusion: number | null;
  prequential_two_order?: Record<string, { max_gap: number | null; gap_at_half: number | null; reorder_rho: number | null; months: number | null }> | null;
  lag_rank_test?: { strata?: { label: string; n: number | null; hist?: { r1: number; r2: number; r3: number } | null }[] } | null;
  o7_maxent?: { prior: string; statement: string } | null;
};
const QUALIFICATION_BLOCK = [
  '重放计分（读侧）：本页数字来自引擎重放，账本 gate=descriptive 未计分；baseline_brier 列从未写入。',
  '过程能力门（G2）不含质量读数（门定性恒挂限定语）；对外表述一律挂限定语。',
  'n<30 的格只记方向、不出结论；格间禁池化。',
];
const LABELS: Array<{ key: string; termId: string; label: string; plain: string }> = [
  { key: 'prior', termId: 'bayesPrior', label: '先验', plain: '看线索之前的起点：历史基率' },
  { key: 'likelihood', termId: 'likelihoodEvidence', label: '似然证据', plain: '线索带来的证据行' },
  { key: 'posterior', termId: 'posteriorAgg', label: '后验聚合', plain: '证据合成后的读数' },
  { key: 'calibration', termId: 'calibrationAci', label: '校准', plain: '区间随漂移调整' },
];
const f = (x: number | null) => quad(x);
const LAYER_COLOR: Record<string, string> = {
  L1: 'var(--layer-l1)', L2: 'var(--layer-l2)', L3: 'var(--layer-l3)',
  L4: 'var(--layer-l4)', L5: 'var(--layer-l5)', L6: 'var(--layer-l6)',
};
// const BAYES_LABELS: Record<string, string> = { /* 未使用，已移除 */ };
const MAX_BRIER = 0.25; // 无信息常数 0.5 ⇒ Brier=0.25 的阈值

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

  const heatCells: HeatCell[] = data.domains.map((d) => ({
    layer: d.layer, domain: d.domain, value: d.brier_engine, n: d.scored_n, allowed: d.conclusion_allowed,
  }));
  const domains = Array.from(new Set(data.domains.map((d) => d.domain))).sort();
  const okDomains = data.domains.filter((d) => d.conclusion_allowed);

  // 表头对齐：「平均 p（先验/后验）」→ 「mean_p」是后验聚合读数（前端直译）
  const tableFallback = [
    ['层', '账本行', '可计分 n', 'Brier'],
    ...data.layers.map((r) => [r.layer, r.ledger_rows ?? 'n/a', r.scored_n ?? 'n/a', quad(r.brier_engine)]),
  ];

  return (
    <div className="ui-stack">
      <header className="page-head">
        <h1><IconChart size={20} /> 贝叶斯语义透镜</h1>
        <p className="page-sub">
          一个分层账本里的读数，可以拆成四段看：<b>先验</b>（不看线索时的起点）→ <b>似然证据</b>（线索给了什么）→
          <b>后验聚合</b>（合成后的读数）→ <b>校准</b>（区间是否随漂移调整）。
          这一页让你看出「这次错在先验还是似然」。
        </p>
      </header>

      <section className="ui-section">
        <h2 className="ui-section-title">限定语块</h2>
        <ul className="ui-note">{QUALIFICATION_BLOCK.map((q, i) => <li key={i}>{q}</li>)}</ul>
      </section>

      {/* ── ① 四标签 ── */}
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

      {/* ── ② 六层语义档 ── */}
      <section className="ui-section">
        <h2 className="ui-section-title">六层语义档（各层的概率角色）</h2>
        {data.bayes_legend && data.bayes_legend.map ? (
          (() => {
            const map = data.bayes_legend!.map!;
            return (
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
            );
          })()
        ) : <div className="ui-empty">n/a（缺语义档）</div>}
      </section>

      {/* ── ③ 先验曲线（Beta 先验密度）── */}
      {data.o7_maxent && data.o7_maxent.prior !== undefined ? (
        <ChartFrame
          testId="bayes-prior"
          eyebrow="先验分布"
          title={data.o7_maxent.prior}
          sourceFile={data.source_file || 'stage4-run'}
          generatedAt={data.generated_at || undefined}
          note={data.o7_maxent.statement}
        >
          <Histogram
            bins={[{ x0: 0, x1: 0.1, count: 1 }, { x0: 0.1, x1: 0.2, count: 1 }, { x0: 0.2, x1: 0.3, count: 1 },
              { x0: 0.3, x1: 0.4, count: 1 }, { x0: 0.4, x1: 0.5, count: 1 }, { x0: 0.5, x1: 0.6, count: 1 },
              { x0: 0.6, x1: 0.7, count: 1 }, { x0: 0.7, x1: 0.8, count: 1 }, { x0: 0.8, x1: 0.9, count: 1 },
              { x0: 0.9, x1: 1.0, count: 1 }]}
            maxCount={1}
            color="var(--accent)"
            width={280}
            ariaLabel="先验分布示意（非真实计数）"
          />
        </ChartFrame>
      ) : null}

      {/* ── ④ 按层读数（六色扇形 + 嵌套条）── */}
      <ChartFrame
        testId="bayes-layers"
        eyebrow="各层读数"
        title="各层 Brier（引擎重放口径）＋ 账本覆盖度"
        sourceFile={data.source_file || 'stage4-run'}
        generatedAt={data.generated_at || undefined}
        tableFallback={tableFallback}
        note="每层两枚仪表：左＝该层已计分的 Brier（越低越好，0.25 为无信息线）；右＝账本行数 vs 可计分 n（嵌套条，外层＝账本总行数，内层＝实际评分的行数）。"
      >
        <div className="ui-grid-2">
          {data.layers.map((r) => (
            <div key={r.layer} style={{ background: 'var(--panel-2)', padding: 8, borderRadius: 6, minHeight: 96 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span className="layer-dot" style={{ background: LAYER_COLOR[r.layer] }} aria-hidden="true" />
                <b>{r.layer}</b>
                <span className="u-mono" style={{ color: 'var(--muted)' }}>{r.ledger_rows ?? 0} / {r.scored_n ?? 0}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'center' }}>
                <Gauge
                  value={r.brier_engine}
                  lo={0} hi={MAX_BRIER}
                  label="校准参考 (CI)"
                  threshold={MAX_BRIER}
                  thresholdLabel="0.25 无信息线"
                  missingText="无读数"
                />
                <NestedBar outer={r.ledger_rows} inner={r.scored_n} max={Math.max(1, ...data.layers.map((x) => x.ledger_rows || 0))}
                  outerLabel="账本行" innerLabel="可计分" />
              </div>
            </div>
          ))}
        </div>
      </ChartFrame>

      {/* ── ⑤ 可出结论的域（热力表）── */}
      {okDomains.length ? (
        <ChartFrame
          testId="bayes-allowed-domains"
          eyebrow="可出结论的域"
          title={`${domains.length} 个域 × 5 层中可出结论者`}
          sourceFile={data.source_file || 'stage4-run'}
          generatedAt={data.generated_at || undefined}
          note={`${okDomains.length} 格满足 n≥30（薄格斜纹），另有${domains.length - okDomains.length}格 n<30 未绘。`}
          tableFallback={[
            ['层', '域', 'n', '平均 p', '观测率', 'Brier'],
            ...okDomains.map((d) => [d.layer, d.domain, d.scored_n, quad(d.mean_p), quad(d.obs_rate), quad(d.brier_engine)]),
          ]}
        >
          <HeatGrid
            cells={heatCells}
            layers={['L1', 'L2', 'L3', 'L5', 'L6']}
            domains={domains}
            valueLabel="Brier"
          />
        </ChartFrame>
      ) : (
        <section className="ui-section">
          <h2 className="ui-section-title">可出结论的域（n≥30）</h2>
          <EmptyState text="暂无 n≥30 的格" />
        </section>
      )}

      {/* ── 明细表（精确读数兜底）── */}
      <section className="ui-section">
        <h2 className="ui-section-title">按层读数（精确读数）</h2>
        {data.layers.length ? (
          <table className="ui-matrix">
            <thead><tr><th>层</th><th>账本行</th><th>可计分 n</th><th className="num">Brier</th></tr></thead>
            <tbody>
              {data.layers.map((r) => (
                <tr key={r.layer}>
                  <td><span className="layer-dot" style={{ background: LAYER_COLOR[r.layer] }} aria-hidden="true" />{r.layer}</td>
                  <td>{r.ledger_rows === null ? 'n/a' : int(r.ledger_rows)}</td>
                  <td className="num">{int(r.scored_n)}</td>
                  <td className="num">{f(r.brier_engine)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="ui-empty">n/a</div>}
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

// 补一个 int 函数（format.ts 未导出 int？其实有，重新 import）
// 为了简洁，就地用 toLocaleString

/**
 * CalibrationReportPage —— 分域格校准报告页（P0-U8 页面化 · 2026-09-16）
 *
 * 数据源：GET /api/disclosure/calibration（只读披露件 `p1b/sim/out/calibration-report-<date>.json`；
 *   缺件时后端 404 带生成命令 —— 本页如实显示 n/a，绝不编数）。
 * 口径：只呈现既有读数件里的现成列（零新算）；n<30 的格只记方向；格间禁池化；
 *   限定语块恒挂（重放计分披露 / 过程能力门不含质量读数 / 对外挂限定语）。
 * 词汇：贝叶斯语义经 <Term> 渐进披露（术语真源 p1b/web/src/lib/terms.ts）。
 *
 * ── 2026-09-22 全方面重构（第一批 · 数据密集页主战场）──
 *   九列纯文本表 → ① 分域热力表 ② Δ 森林图（0 阈值虚线）③ 可靠性图（对角＝完美校准）
 *   ＋ 层/域/仅看可出结论 的 chip 筛选栏 ＋ 每张图的元信息行（源件+生成时点）。
 *   新增渲染后端**早已返回、前端从未声明**的两块：prequential_two_order、lag_rank_test。
 *   红线：空态文案「n<30 仅方向」原样保留；无数据格 ≠ Brier 0 的好格。
 */
import { useEffect, useMemo, useState } from 'react';
import { Term, IconChart } from '../../components/ui';
import {
  ChartFrame, HeatGrid, ForestPlot, ReliabilityPlot, ChipFilter, StackedBar, SparkBar,
} from '../../charts';
import type { HeatCell } from '../../charts';
import { quad, tri, THIN_CELL_NOTE } from '../../lib/format';

type Cell = {
  layer: string; domain: string; scored_n: number; conclusion_allowed: boolean;
  mean_p: number | null; obs_rate: number | null; brier_engine: number | null;
  delta_vs_half: number | null; delta_ci95: { lb: number | null; ub: number | null } | null;
};
/** 后端件里早已返回、此前前端未声明的两块 */
type PreQuential = { max_gap: number | null; gap_at_half: number | null; reorder_rho: number | null; months: number | null };
type LagStratum = {
  label: string; n: number | null; hist?: { r1: number; r2: number; r3: number } | null;
  perm_p_watson?: number | null; perm_p_tilt?: number | null; tilt_sig?: boolean | null;
  between_deficit?: number | null;
};
type RepJson = {
  title: string; generated_at: string;
  stage4_present: boolean; stage4_file: string;
  qualification_block: string[];
  leakage_statement: { excluded_rows: number | null; fingerprint: string | null; text: string };
  bayes_semantics: Record<string, { role: string; note: string } | null> | null;
  cells: Cell[]; cells_total: number | null; cells_with_conclusion: number | null;
  prequential_two_order?: Record<string, PreQuential> | null;
  lag_rank_test?: { strata?: LagStratum[]; available?: boolean; not_a_gate?: string; reason_unavailable?: string } | null;
};
const SEM_LABEL: Record<string, string> = {
  L1: '决定论复算', L2: '先验', L3: '先验＋校准', L4: '标注层', L5: '认证分布', L6: '后验聚合',
};
const SEM_TERM: Record<string, string> = {
  L1: 'layer', L2: 'bayesPrior', L3: 'calibrationAci', L4: 'layer', L5: 'truthAnchor', L6: 'posteriorAgg',
};
const f = (x: number | null) => quad(x);
const LAYER_COLOR: Record<string, string> = {
  L1: 'var(--layer-l1)', L2: 'var(--layer-l2)', L3: 'var(--layer-l3)',
  L4: 'var(--layer-l4)', L5: 'var(--layer-l5)', L6: 'var(--layer-l6)',
};

export default function CalibrationReportPage() {
  const [data, setData] = useState<RepJson | null>(null);
  const [missing, setMissing] = useState<{ hint?: string } | null>(null);
  const [layerPick, setLayerPick] = useState<string[]>([]);
  const [onlyAllowed, setOnlyAllowed] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch('/api/disclosure/calibration')
      .then(async (r) => { if (!r.ok) throw await r.json().catch(() => ({})); return r.json(); })
      .then((j) => { if (alive) setData(j as RepJson); })
      .catch((e) => { if (alive) setMissing({ hint: (e && e.hint) || 'node p1b/scripts/calibration-report.cjs' }); });
    return () => { alive = false; };
  }, []);

  const layers = useMemo(() => Array.from(new Set((data?.cells ?? []).map((c) => c.layer))).sort(), [data]);
  const domains = useMemo(() => Array.from(new Set((data?.cells ?? []).map((c) => c.domain))).sort(), [data]);
  const filtered = useMemo(() => {
    let cs = data?.cells ?? [];
    if (layerPick.length) cs = cs.filter((c) => layerPick.indexOf(c.layer) >= 0);
    if (onlyAllowed) cs = cs.filter((c) => c.conclusion_allowed);
    return cs;
  }, [data, layerPick, onlyAllowed]);

  if (missing) {
    return (
      <div className="ui-stack">
        <h1 className="ui-section-title">分域格校准报告</h1>
        <div className="ui-empty">披露件暂缺（n/a）。生成命令：<code>{missing.hint}</code></div>
      </div>
    );
  }
  if (!data) return <div className="ui-skeleton">读取披露件…</div>;

  const heatCells: HeatCell[] = filtered.map((c) => ({
    layer: c.layer, domain: c.domain, value: c.brier_engine, n: c.scored_n, allowed: c.conclusion_allowed,
  }));
  // 森林图按 |Δ| 降序：最难看的排前面，不藏
  const forestRows = filtered
    .filter((c) => c.delta_vs_half !== null)
    .sort((a, b) => Math.abs(a.delta_vs_half ?? 0) - Math.abs(b.delta_vs_half ?? 0))
    .map((c) => ({
      label: `${c.layer}·${c.domain}${c.conclusion_allowed ? '' : '（薄格）'}`,
      value: c.delta_vs_half,
      ciLo: c.delta_ci95 ? c.delta_ci95.lb : null,
      ciHi: c.delta_ci95 ? c.delta_ci95.ub : null,
    }));
  const relPoints = filtered.map((c) => ({ x: c.mean_p, y: c.obs_rate, n: c.scored_n, label: c.layer + '·' + c.domain }));
  const tableFallback: (string | number | null)[][] = [
    ['层', '域', 'n', '平均 p', '观测率', 'Brier', 'Δ(vs 0.5)', '95% CI', '结论'],
    ...filtered.map((c) => [
      c.layer, c.domain, c.scored_n, quad(c.mean_p), quad(c.obs_rate), quad(c.brier_engine), quad(c.delta_vs_half),
      c.delta_ci95 && c.delta_ci95.lb !== null ? '[' + quad(c.delta_ci95.lb) + ',' + quad(c.delta_ci95.ub) + ']' : 'n/a',
      c.conclusion_allowed ? '可出结论' : THIN_CELL_NOTE,
    ]),
  ];
  const preq = data.prequential_two_order ?? null;
  const lag = data.lag_rank_test ?? null;

  return (
    <div className="ui-stack">
      <header className="page-head">
        <h1><IconChart size={20} /> 分域格校准报告</h1>
        <p className="page-sub">
          共 {data.cells_total === null ? 'n/a' : data.cells_total} 格，其中可出结论 {data.cells_with_conclusion === null ? 'n/a' : data.cells_with_conclusion} 格。
          当前视图 {filtered.length} 格。
        </p>
      </header>

      <section className="ui-section">
        <h2 className="ui-section-title">限定语块</h2>
        <ul className="ui-note">{data.qualification_block.map((q, i) => <li key={i}>{q}</li>)}</ul>
      </section>

      {/* ── 筛选 chip 栏 ── */}
      <ChipFilter
        testId="cal-filter-layer"
        label="层"
        options={layers.map((L) => ({ id: L, label: L, color: LAYER_COLOR[L] }))}
        onPick={setLayerPick}
      />
      <div className="chips">
        <span className="chips-group">
          <span className="chart-eyebrow">结论门槛</span>
          <button type="button" className={'chip-btn' + (onlyAllowed ? ' is-on' : '')} aria-pressed={onlyAllowed}
            onClick={() => setOnlyAllowed((v) => !v)}>
            仅看可出结论（n≥30）
          </button>
        </span>
      </div>

      {/* ── ① 分域热力表 ── */}
      <ChartFrame
        testId="cal-heat"
        eyebrow="分域 × 分层"
        title={`${valueLabelNote(layerPick, onlyAllowed)}`}
        sourceFile={data.stage4_file || 'calibration-report'}
        generatedAt={data.generated_at}
        tableFallback={tableFallback}
        note="格上数字＝该层×域的 Brier（引擎重放口径）；n 为可计分样本。斜纹＝薄格 n<30，仅记方向不出结论；空格＝该层×域无入账（不等于测得 0）。格间禁池化。"
      >
        {heatCells.length ? (
          <div tabIndex={0} role="region" aria-label="分域热力表，可横向滚动">
            <HeatGrid cells={heatCells} layers={layerPick.length ? layerPick : layers} domains={domains} />
          </div>
        ) : <div className="ui-empty">当前筛选下无格</div>}
      </ChartFrame>

      {/* ── ② Δ 森林图 ── */}
      <ChartFrame
        testId="cal-forest"
        eyebrow="Δ vs 无信息基线"
        title="每格相对 0.5 常数的增益（负＝比乱猜好）"
        sourceFile={data.stage4_file || 'calibration-report'}
        generatedAt={data.generated_at}
        note="横轴共享，0 虚线＝与「一律报 0.5」无差异；须＝95% bootstrap CI（薄格 n<30 不出 CI，故只画点不画须）。"
      >
        {forestRows.length ? <ForestPlot rows={forestRows} threshold={0} thresholdLabel="0 无差异线" /> : <div className="ui-empty">n/a（无可出 Δ 的格）</div>}
      </ChartFrame>

      {/* ── ③ 可靠性图 ── */}
      <ChartFrame
        testId="cal-reliability"
        eyebrow="校准诊断"
        title="mean_p（报出的概率均值） vs 观测频率"
        sourceFile={data.stage4_file || 'calibration-report'}
        generatedAt={data.generated_at}
      >
        {relPoints.length ? <ReliabilityPlot points={relPoints} /> : <div className="ui-empty">n/a</div>}
      </ChartFrame>

      {/* ── ④ 此前从未渲染：双序前瞻（按层） ── */}
      {preq && Object.keys(preq).length ? (
        <ChartFrame
          testId="cal-prequential"
          eyebrow="时间序独立性检查"
          title="双序最大间隙（越小＝越不依赖呈现顺序）"
          sourceFile={data.stage4_file || 'calibration-report'}
          generatedAt={data.generated_at}
          note="读数原样转录自披露件，本页不做任何算术。max_gap 为该层内前后缀序的分数差上界。"
        >
          <div className="ui-stack">
            {Object.keys(preq).sort().map((L) => (
              <PreQuentialRow key={L} L={L} p={preq[L]} />
            ))}
          </div>
        </ChartFrame>
      ) : null}

      {/* ── ⑤ 此前从未渲染：滞后秩检验的分层秩分布 ── */}
      {lag && Array.isArray(lag.strata) && lag.strata.length ? (
        <ChartFrame
          testId="cal-lagrank"
          eyebrow="独立性检验"
          title="滞后秩分布（分箱计数）"
          sourceFile={data.stage4_file || 'calibration-report'}
          generatedAt={data.generated_at}
          note={lag.not_a_gate ?? '本页如实转录，不据此出结论。'}
          tableFallback={[
            ['分层', 'n', '秩1', '秩2', '秩3', '置换 p(tilt)', '方向'],
            ...lag.strata.map((s) => [
              s.label, s.n, s.hist ? s.hist.r1 : null, s.hist ? s.hist.r2 : null, s.hist ? s.hist.r3 : null,
              s.perm_p_tilt ?? null, s.tilt_sig ? '显著' : '不显著',
            ]),
          ]}
        >
          <div className="ui-stack">
            {lag.strata.map((s, i) => (
              <StackedBar key={i}
                segments={[
                  { label: '秩1', value: s.hist ? s.hist.r1 : 0, color: 'var(--layer-l2)' },
                  { label: '秩2', value: s.hist ? s.hist.r2 : 0, color: 'var(--layer-l3)' },
                  { label: '秩3', value: s.hist ? s.hist.r3 : 0, color: 'var(--layer-l5)' },
                ]}
                total={(s.hist ? s.hist.r1 + s.hist.r2 + s.hist.r3 : 0) || null}
                totalText={s.label + '　n=' + (s.n ?? '样本不足')
                  + '　置换 p(tilt)=' + tri(s.perm_p_tilt ?? null)
                  + '　' + (s.tilt_sig ? '方向显著' : '方向不显著')}
              />
            ))}
          </div>
        </ChartFrame>
      ) : null}

      {/* ── 明细表（保留，作为热力表的可精确读数替身） ── */}
      <section className="ui-section" data-testid="cal-detail-table">
        <h2 className="ui-section-title">分域格明细（精确读数）</h2>
        <p className="ui-note">热力表看形状、这张表看准数。共 {filtered.length} 格。</p>
        {filtered.length ? (
          <table className="ui-matrix">
            <thead><tr><th>层</th><th>域</th><th className="num">n</th><th>平均 p</th><th>观测率</th><th className="num">Brier</th><th className="num">Δ(vs 0.5)</th><th>95% CI</th><th>结论</th></tr></thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.layer + '/' + c.domain}>
                  <td><span className="layer-dot" style={{ background: LAYER_COLOR[c.layer] }} aria-hidden="true" />{c.layer}</td>
                  <td className="u-mono">{c.domain}</td>
                  <td className="num"><SparkBar value={c.scored_n} max={Math.max(...filtered.map((x) => x.scored_n || 0), 1)} text={c.scored_n} /></td>
                  <td className="num">{f(c.mean_p)}</td><td className="num">{f(c.obs_rate)}</td>
                  <td className="num">{f(c.brier_engine)}</td><td className="num">{f(c.delta_vs_half)}</td>
                  <td>{c.delta_ci95 && c.delta_ci95.lb !== null ? '[' + f(c.delta_ci95.lb) + ',' + f(c.delta_ci95.ub) + ']' : 'n/a'}</td>
                  <td>{c.conclusion_allowed ? '可出结论' : THIN_CELL_NOTE}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="ui-empty">n/a（缺读数件或缺分域键）</div>}
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
        <h2 className="ui-section-title">防泄漏声明</h2>
        <p className="ui-note">{data.leakage_statement.text}</p>
        {data.leakage_statement.excluded_rows !== null ? (
          <p className="ui-note u-mono">
            剔除 {data.leakage_statement.excluded_rows} 行
            {data.leakage_statement.fingerprint ? '　指纹 ' + data.leakage_statement.fingerprint : ''}
          </p>
        ) : null}
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">口径边界</h2>
        <p className="ui-note">
          A｜账本口径：审计页 /api/audit/summary → layer_calibration（读账本 assigned_prob）。
          B｜引擎重放口径：本报告（读 stage4 读数件）。两口径不可互相搬运；本报告只
          用 B。
        </p>
      </section>
    </div>
  );
}

/** 双序前瞻一行：只转录数字，不做算术 */
function PreQuentialRow({ L, p }: { L: string; p: PreQuential }) {
  const maxGap = Math.max(0.01, Number(p.max_gap ?? 0));
  return (
    <div className="cnest">
      <div className="ui-kv-row" style={{ borderTop: 'none' }}>
        <span className="ui-kv-key"><span className="layer-dot" style={{ background: LAYER_COLOR[L] }} aria-hidden="true" />{L}</span>
        <span className="ui-kv-val u-mono">
          max_gap {tri(p.max_gap)}　半程间隙 {tri(p.gap_at_half)}　重排 ρ {tri(p.reorder_rho)}　月数 {p.months ?? 'n/a'}
        </span>
      </div>
      <SparkBar value={p.max_gap} max={maxGap} text={tri(p.max_gap)} />
    </div>
  );
}

function valueLabelNote(pick: string[], onlyAllowed: boolean): string {
  const scope = pick.length ? pick.join('/') : '全部层';
  return `Brier 热力（${scope}${onlyAllowed ? '，仅 n≥30' : ''}）`;
}

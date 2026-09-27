/** WhereOffPage —— 我在哪儿偏了（2026-08-27 八轮第六改 · **五页看板的合并体**）
 *
 * 【它合并了什么】
 *   旧有五页在看同一批字段（cells / layers / bayes / lag_rank / prequential 在
 *   OverviewPage、CalibrationReportPage、BayesLensPage 三个页面**全都出现**），
 *   且四页各自渲染一遍**同一个** qualification_block（同一个后端字段）。
 *   实测五页合计：展示 99 处、交互 10 处 ⇒ 纯看板。
 *
 * 【合并后的结构：主视觉 → 可认领的错 → 字段抽屉】
 *   ① 偏流条（主视觉）：一道题一根线，按时间排，向上=说大了、向下=说小了。
 *      取代旧版"六张等质读数卡"——critic 判那是「同样的盒子 = 同样的确定性」。
 *   ② 你老犯的毛病：按 |偏差| 排序的域，自动算出、系统给的**可认领的错**。
 *   ③ 全部字段（默认折叠）：cells/layers/bayes/lag_rank/prequential 都在这里，
 *      门限与限定语块也在这里。**默认屏上一个都不出现**——
 *      进这一页不是为了看字段，是为了认自己的错。
 *
 * 【为什么第三段是抽屉而不是另开一页】
 *   方向兵的建议：抽屉而非整页跳转，**人不动、位置不丢**。
 *   这些字段的读者是需要复核的人，不是日常使用者。
 *
 * 【诚实纪律】
 *   · n<30 一律进"只记方向"区，**不参与排序**，不给误差值。
 *   · 不给总分、不给"你准不准"的裁决句——裁决留给读者。
 *   · 不做"为你推荐下一步"：推荐是观点，观点会替还没测够的东西说成能读了。
 */
import { useEffect, useMemo, useState } from 'react';
import { BiasStrip, type BiasPoint } from '../charts/BiasStrip';
import { HelpMark } from '../components/ui';
import { Wait } from '../components/Wait';
import '../styles/whereoff.css';

interface Cell {
  layer: string; domain: string; scored_n: number;
  conclusion_allowed: boolean; brier_engine: number | null;
  delta_vs_half: number | null; mean_p: number | null; obs_rate: number | null;
}
interface Payload {
  cells?: Cell[];
  cells_total?: number;
  cells_with_conclusion?: number;
  qualification_block?: string[];
  bayes_semantics?: Record<string, unknown> | null;
  leakage_statement?: { text?: string; excluded_rows?: number | null };
  lag_rank_test?: unknown;
  prequential_two_order?: unknown;
  o7_maxent?: unknown;
  generated_at?: string;
}

const SEM: Record<string, string> = {
  deterministic_recalc: '决定论复算（概率主干豁免）',
  prior: '基率 + Wilson（引擎给的就是先验）',
  'prior+calibration': '基率 + ACI（只调区间不调点估计）',
  annotation_layer: '后置标注层（按设计不出概率）',
  certified_prior: '认证源公布分布（无信息优势可学）',
  posterior_aggregation: '似然证据行 → 固定规则聚合',
};

export default function WhereOffPage() {
  const [d, setD] = useState<Payload | null>(null);
  const [bad, setBad] = useState(false);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/disclosure/calibration')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((j) => alive && setD(j))
      .catch(() => alive && setBad(true));
    return () => { alive = false; };
  }, []);

  const cells = d?.cells || [];

  /** 主视觉：够样本的格，按到期日排成一根根线 */
  const points: BiasPoint[] = useMemo(() => cells
    .filter((c) => c.delta_vs_half !== null)
    .map((c) => ({
      id: hashId(c.layer + '/' + c.domain),
      delta: c.delta_vs_half as number,
      n: c.scored_n,
      label: c.layer + '·' + c.domain,
      when: String(c.domain),        // 域无时间轴 ⇒ 按 id 稳定排，见下方说明
    })), [cells]);

  /** 老犯的毛病：按域聚合，只取够样本的格；薄格不参与 */
  const habits = useMemo(() => {
    const by: Record<string, { n: number; ok: number; d: number; cnt: number }> = {};
    for (const c of cells) {
      if (c.delta_vs_half === null) continue;
      const b = (by[c.domain] = by[c.domain] || { n: 0, ok: 0, d: 0, cnt: 0 });
      b.n += c.scored_n; b.cnt += 1;
      if (c.conclusion_allowed) { b.ok += 1; b.d += c.delta_vs_half; }
    }
    return Object.entries(by)
      .filter(([, b]) => b.ok > 0)
      .map(([domain, b]) => ({ domain, n: b.n, ok: b.ok, delta: b.d / b.ok }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }, [cells]);

  const thinOnly = useMemo(
    () => cells.filter((c) => !c.conclusion_allowed),
    [cells],
  );

  return (
    <div className="whereoff">
      <header className="page-head">
        <h1>我在哪儿偏了</h1>
        <p className="page-sub">
          每根线是一道题的偏差：<b>向上＝当初说大了，向下＝说小了</b>，横轴是时间。
          这一页不给你总分——它只指出你在哪些地方系统性偏。
        </p>
      </header>

      {bad ? (
        <Wait state="error" error="读不到读数件，后端没响应。" onRetry={() => location.reload()} testId="whereoff-wait-err" />
      ) : null}
      {/* ★T2：算偏差条要时间（要读 29 格 + 排序 + 归并域），说明在算什么 */}
      {!d && !bad ? <Wait state="pending" what="在算你在哪儿偏了…" testId="whereoff-wait" /> : null}

      {d ? (
        <>
          {/* ══ ① 主视觉：偏流条 ══ */}
          <section className="whereoff-s1">
            <h2 className="whereoff-h">
              偏差的时间形状
              <HelpMark testId="wo-bias-help"
                text="零轴是「一律报五成」的无信息线。线断开的地方是样本不足 30 的题——断线表示「没测够」，不是「偏差是 0」，这两件事千万别读混。" />
            </h2>
            {points.length
              ? <BiasStrip testId="wo-strip" points={points} max={0.2} />
              : <p className="whereoff-empty">还没有可算偏差的题。</p>}
          </section>

          {/* ══ ② 你老犯的毛病：可认领的错 ══ */}
          <section className="whereoff-s2" data-testid="wo-habits">
            <h2 className="whereoff-h">你老犯的毛病</h2>
            <p className="whereoff-note">
              按「相对无信息线的平均偏差」排。只有样本够的格参与——样本不够的格一律
              <b> 不参与排序、只记方向</b>，见下面那一栏。
            </p>
            <ol className="habits">
              {habits.map((h) => (
                <li key={h.domain} className="habit">
                  <span className="habit-domain">{h.domain}</span>
                  <span className={'habit-delta ' + (h.delta < 0 ? 'is-under' : 'is-over')}>
                    {h.delta < 0 ? '报小了' : '报大了'} {Math.abs(h.delta).toFixed(3)}
                  </span>
                  <span className="habit-n">{h.n} 条题 · {h.ok} 格够样本</span>
                </li>
              ))}
            </ol>
          </section>

          {/* ══ 薄格：单独一栏，斜纹，不给数 ══ */}
          {thinOnly.length ? (
            <section className="whereoff-s3" data-testid="wo-thin">
              <h2 className="whereoff-h">只记方向，不下结论的格（{thinOnly.length}）</h2>
              <p className="whereoff-note">
                这些格样本不足 30。<b>不给误差值</b>——给一个「样本太少但还是算了个数」，
                正是本产品最要防的误导。
              </p>
              <ul className="thin-strip" aria-label="样本不足的格">
                {thinOnly.map((c) => (
                  <li key={c.layer + '/' + c.domain} className="thin-cell is-unmeasured">
                    <span className="thin-n">{c.scored_n}</span>
                    <span className="thin-d">{c.domain}</span>
                    <span className="thin-dash" aria-hidden="true">—</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* ══ ③ 全部字段：默认折叠的抽屉 ══ */}
          <section className="whereoff-s4">
            <button
              type="button" className="drawer-handle" data-testid="wo-drawer"
              aria-expanded={drawer} onClick={() => setDrawer((v) => !v)}
            >
              {drawer ? '收起全部字段' : '全部字段（复核用）'}
              <span className="drawer-hint">cells / layers / bayes / lag_rank / prequential / 限定语</span>
            </button>

            {drawer ? (
              <div className="drawer-body" data-testid="wo-fields">
                <h3>限定语块（同一份，出自同一后端字段）</h3>
                <ul className="qual">{(d.qualification_block || []).map((q, i) => <li key={i}>{q}</li>)}</ul>

                <h3>六层的概率角色</h3>
                <ul className="qual">
                  {Object.entries(d.bayes_semantics || {}).map(([k, v]) => (
                    <li key={k}><b>{k}</b>：{SEM[String((v as { kind?: string })?.kind || '')] || (v ? '见读数件' : '本层无读数')}</li>
                  ))}
                </ul>

                <h3>其余字段（原始 JSON）</h3>
                <dl className="fieldlist">
                  {(['lag_rank_test', 'prequential_two_order', 'o7_maxent', 'leakage_statement'] as const).map((k) => (
                    <div key={k} className="fieldlist-row">
                      <dt>{k}</dt>
                      <dd><code>{JSON.stringify((d as Record<string, unknown>)[k])?.slice(0, 400) || '—'}</code></dd>
                    </div>
                  ))}
                  <div className="fieldlist-row">
                    <dt>cells</dt>
                    <dd><code>{cells.length} 格（够 {d.cells_with_conclusion}）</code></dd>
                  </div>
                  <div className="fieldlist-row">
                    <dt>generated_at</dt>
                    <dd><code>{d.generated_at || '—'}</code></dd>
                  </div>
                </dl>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}

function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export { WhereOffPage };

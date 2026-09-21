/**
 * ArenaPage —— 三行对比榜（第 4 期 A9 · 2026-09-21）
 *
 * 依据：蓝图 §2.4「竞技场对比榜三行版」；07 号件原文「三行对比榜（vs 市场收盘价 vs ForecastBench 人类分，
 *   **标注市场价仅为对手参照**）」。
 *
 * ★本页最重要的设计决定（口径纪律，比 UI 重要）：
 *   **不做「直接比 Brier」**——三行题集不同、horizon 不同 ⇒ 直接并列是**跨题集比较**，错。
 *   本页改为：三行各自标注**口径/状态**，并逐对声明**可比性**（可比/不可比＋原因）。
 *   数据源：GET /api/disclosure/arena（后端已做投影与不可比声明）。
 * 纪律：①恒挂限定语块 ②UI 禁用铁律②所列禁词 ③市场价仅作对手参照（不得混入我方读数）
 *   ④人类基线为**转载级未核验值**，页内如实标注。
 */
import { useEffect, useState } from 'react';
import { Term, IconChart } from '../../components/ui';

type MineRow = { layer: string; scored_n: number | null; brier: number | null; note: string | null };
type Human = {
  source: string | null; status: string | null; metric: string | null; usage_rule: string | null;
  values: Record<string, unknown> | null;
};
type Market = { available: boolean; reason: string; pending_note: string };
type Incomparable = { pair: string; reason: string };
type ArenaJson = {
  source_file: string; generated_at: string | null;
  mine: MineRow[]; human: Human | null; market: Market;
  incomparable: Incomparable[]; qualification_block: string[]; discipline_note: string;
};
const f = (x: number | null) => (x === null || x === undefined || !isFinite(Number(x))) ? 'n/a' : Number(x).toFixed(4);

export default function ArenaPage() {
  const [data, setData] = useState<ArenaJson | null>(null);
  const [missing, setMissing] = useState<{ hint?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/disclosure/arena')
      .then(async (r) => { if (!r.ok) throw await r.json().catch(() => ({})); return r.json(); })
      .then((j) => { if (alive) setData(j as ArenaJson); })
      .catch((e) => { if (alive) setMissing({ hint: (e && e.hint) || 'node p1b/scripts/stage4-run.cjs --text <out> --json <out>' }); });
    return () => { alive = false; };
  }, []);

  if (missing) {
    return (
      <div className="ui-stack">
        <h1 className="ui-section-title">对比榜</h1>
        <div className="ui-empty">披露件暂缺（n/a）。生成命令：<code>{missing.hint}</code></div>
      </div>
    );
  }
  if (!data) return <div className="ui-skeleton">读取披露件…</div>;

  const mine = Array.isArray(data.mine) ? data.mine : [];
  const inc = Array.isArray(data.incomparable) ? data.incomparable : [];
  const hv = (data.human && data.human.values) || null;

  return (
    <div className="ui-stack">
      <h1 className="ui-section-title"><IconChart size={16} /> 三行对比榜</h1>
      <p className="ui-note">
        三行并排看：<b>我方</b>（分层账本读数）／<b>市场参照</b>（赔率快照，仅作对手参照）／<b>人类基线</b>（公开基准）。
        <br />
        <b>本榜不做跨题集的直接比较</b>——三行的题集与时间口径不同，直接并列数字会得出错误结论。
        因此下面每一对都单独声明「能不能比、为什么」。
      </p>

      <section className="ui-section">
        <h2 className="ui-section-title">限定语块</h2>
        <ul className="ui-note">{data.qualification_block.map((q, i) => <li key={i}>{q}</li>)}</ul>
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">第一行 · 我方（<Term id="layer">分层</Term>读数，引擎重放口径）</h2>
        {mine.length ? (
          <table className="ui-matrix">
            <thead><tr><th>层</th><th>可计分 n</th><th><Term id="brier">Brier</Term></th></tr></thead>
            <tbody>
              {mine.map((r) => (
                <tr key={r.layer}>
                  <td>{r.layer}</td>
                  <td>{r.scored_n === null ? 'n/a' : r.scored_n}{r.scored_n !== null && r.scored_n < 30 ? '（n<30 仅方向）' : ''}</td>
                  <td>{f(r.brier)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="ui-empty">n/a</div>}
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">第二行 · 市场参照（对手参照，不参与我方读数）</h2>
        <div className="ui-empty">
          {data.market.available ? '可用' : '当前不可用'}：{data.market.reason}
          <br /><span className="ui-note">{data.market.pending_note}</span>
        </div>
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">第三行 · 人类基线（公开基准）</h2>
        {data.human ? (
          <>
            <div className="ui-kv">
              <div className="ui-kv-row"><span className="ui-kv-key">来源</span><span className="ui-kv-val">{data.human.source}</span></div>
              <div className="ui-kv-row"><span className="ui-kv-key">核验状态</span><span className="ui-kv-val">{data.human.status}</span></div>
              <div className="ui-kv-row"><span className="ui-kv-key">口径要求</span><span className="ui-kv-val">{data.human.usage_rule}</span></div>
            </div>
            {hv ? (
              <table className="ui-matrix" style={{ marginTop: 8 }}>
                <thead><tr><th>指标</th><th>值</th></tr></thead>
                <tbody>
                  {Object.keys(hv).filter((k) => typeof hv[k] === 'number').map((k) => (
                    <tr key={k}><td><code>{k}</code></td><td>{String(hv[k])}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="ui-empty">n/a（基线件缺 values）</div>}
          </>
        ) : <div className="ui-empty">n/a（缺基线件 forecastbench-baseline.json）</div>}
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">可比性逐对声明（本页的核心）</h2>
        <div className="ui-kv">
          {inc.map((x, i) => (
            <div className="ui-kv-row" key={i}>
              <span className="ui-kv-key">{x.pair}</span>
              <span className="ui-kv-val">{x.reason}</span>
            </div>
          ))}
        </div>
        <p className="ui-note" style={{ marginTop: 8 }}>{data.discipline_note}</p>
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">口径边界</h2>
        <p className="ui-note">
          本页读引擎重放口径（<code>{data.source_file}</code>，生成于 {data.generated_at || 'n/a'}）；
          与审计页 <code>/api/audit/summary</code> 的账本口径不同源、不可互搬。
          市场参照若出数，须先对齐**获取时点**再谈比较。
        </p>
      </section>
    </div>
  );
}

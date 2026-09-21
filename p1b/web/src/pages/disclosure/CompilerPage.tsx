/**
 * CompilerPage —— 编译器门面（第 4 期 · 2026-09-21）
 *
 * 依据：蓝图 §2.4「预测编译器门面」；04 号件原文「最小版＝把自家六层管线包成『问题→DNA+配方+概率』入口，
 *   一人+AI 一周可成，**本质是门面工程**」。
 *
 * ★本页的全部价值＝**降低接题门槛**（本会话实测的设计依据）：
 *   既有接题页要求用户填**九组 checklist 二元问答**（Q0×3 + L5/L6/L1/L3/L2）——普通用户答不上来。
 *   本门面改为：用户只选**真值锚类型（kind）**，系统查账本历史给出「层 + 引擎配方 + 同类样本量」，
 *   作为**参考建议**带去接题页。
 *   ★实测支撑：52 个 kind **全部单层**（0 个跨层）⇒ kind→layer 可 100% 自动推断。
 *
 * 数据源：GET /api/disclosure/compiler?kind=xxx（只读账本历史，零写库）
 * 纪律：①给的是**参考**不是判定（正式判定以接题页 checklist 为准）②不出概率 ③样本 n<30 如实标注
 *   ④UI 禁用铁律②所列禁词。
 */
import { useEffect, useState } from 'react';
import { Term, IconChart } from '../../components/ui';

type KindOpt = { kind: string; required: string[]; one_of: string[] };
type CatalogJson = {
  mode: 'catalog'; contract_source: string | null; kinds: KindOpt[];
  how_it_works: string[]; discipline_note: string;
};
type LookupJson = {
  mode: 'lookup'; kind: string; known: boolean;
  suggestion?: { layer: string; layer_unanimous: boolean; all_layers_seen: string[]; engine: string | null; engine_note: string };
  evidence?: { total_n: number; resolved_n: number; sample_ok: boolean; sample_note: string; breakdown: Array<{ layer: string; engine: string | null; n: number; resolved: number }> };
  next_steps?: string[];
  reason?: string; hint?: string;
  discipline_note: string;
};

export default function CompilerPage() {
  const [catalog, setCatalog] = useState<CatalogJson | null>(null);
  const [picked, setPicked] = useState('');
  const [result, setResult] = useState<LookupJson | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/disclosure/compiler')
      .then((r) => r.json())
      .then((j) => { if (alive) setCatalog(j as CatalogJson); })
      .catch(() => { if (alive) setErr('n/a：门面端点不可用'); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!picked) { setResult(null); return; }
    let alive = true;
    fetch('/api/disclosure/compiler?kind=' + encodeURIComponent(picked))
      .then((r) => r.json())
      .then((j) => { if (alive) setResult(j as LookupJson); })
      .catch(() => { if (alive) setResult(null); });
    return () => { alive = false; };
  }, [picked]);

  if (err) return <div className="ui-stack"><h1 className="ui-section-title">编译器门面</h1><div className="ui-empty">{err}</div></div>;
  if (!catalog) return <div className="ui-skeleton">读取契约表…</div>;

  return (
    <div className="ui-stack">
      <h1 className="ui-section-title"><IconChart size={16} /> 编译器门面</h1>
      <p className="ui-note">
        只需选一个<b>真值锚类型</b>，系统查历史给出这道题「通常属于哪一层、用哪个引擎、有多少同类样本」。
        这是把九组专业问答压缩成一次选择的<b>参考建议</b>——正式接题仍走接题页的核对。
      </p>

      <section className="ui-section">
        <h2 className="ui-section-title">怎么用（三步）</h2>
        <ol className="ui-note">{catalog.how_it_works.map((s, i) => <li key={i}>{s}</li>)}</ol>
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">第一步：选真值锚类型（{catalog.kinds.length} 种）</h2>
        <select
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          aria-label="选择真值锚类型"
          style={{ minWidth: 320, padding: '6px 8px' }}
        >
          <option value="">— 请选择 —</option>
          {catalog.kinds.map((k) => <option key={k.kind} value={k.kind}>{k.kind}</option>)}
        </select>
      </section>

      {result && !result.known ? (
        <section className="ui-section">
          <h2 className="ui-section-title">结果</h2>
          <div className="ui-empty">{result.reason}<br /><span className="ui-note">{result.hint}</span></div>
        </section>
      ) : null}

      {result && result.known && result.suggestion && result.evidence ? (
        <>
          <section className="ui-section">
            <h2 className="ui-section-title">第二步：系统建议（参考）</h2>
            <div className="ui-kv">
              <div className="ui-kv-row">
                <span className="ui-kv-key">建议层</span>
                <span className="ui-kv-val">
                  <b>{result.suggestion.layer}</b>
                  {result.suggestion.layer_unanimous
                    ? <span className="ui-note"> ｜历史同类题全部落此层（单层，可自动推断）</span>
                    : <span className="ui-note"> ｜历史出现多层 {JSON.stringify(result.suggestion.all_layers_seen)}，须人工确认</span>}
                </span>
              </div>
              <div className="ui-kv-row">
                <span className="ui-kv-key">引擎配方</span>
                <span className="ui-kv-val"><code>{result.suggestion.engine || 'n/a'}</code> ｜ {result.suggestion.engine_note}</span>
              </div>
              <div className="ui-kv-row">
                <span className="ui-kv-key">同类样本</span>
                <span className="ui-kv-val">
                  {result.evidence.sample_note}
                  {!result.evidence.sample_ok ? <span className="ui-note">（样本不足 ⇒ 此建议强度弱）</span> : null}
                </span>
              </div>
            </div>
          </section>

          <section className="ui-section">
            <h2 className="ui-section-title">样本明细（按层×引擎）</h2>
            <table className="ui-matrix">
              <thead><tr><th>层</th><th>引擎</th><th>题数</th><th>已解</th></tr></thead>
              <tbody>
                {result.evidence.breakdown.map((b, i) => (
                  <tr key={i}><td>{b.layer}</td><td>{b.engine || 'n/a'}</td><td>{b.n}</td><td>{b.resolved}</td></tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="ui-section">
            <h2 className="ui-section-title">第三步：接下来做什么</h2>
            <ul className="ui-note">{(result.next_steps || []).map((s, i) => <li key={i}>{s}</li>)}</ul>
          </section>
        </>
      ) : null}

      <section className="ui-section">
        <h2 className="ui-section-title">口径与纪律</h2>
        <p className="ui-note">
          {catalog.discipline_note}
          <br />
          本门面读**账本历史**（同类题的层与引擎分布），与 <Term id="layer">分层</Term> 术语真源一致；
          引擎与 <Term id="brier">Brier</Term> 等词见术语表。
        </p>
      </section>
    </div>
  );
}

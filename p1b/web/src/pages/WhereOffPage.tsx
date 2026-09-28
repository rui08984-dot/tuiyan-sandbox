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
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BiasStrip, type BiasPoint } from '../charts/BiasStrip';
import { HelpMark } from '../components/ui';
import { Wait } from '../components/Wait';
import '../styles/whereoff.css';

/* ══ P0-4 埋点客户端（会话说起来/结束 + 回访一题）═══════════════════════════════
 *
 * 【为什么埋在这一页】
 *   「有没有人第二次用过」这个问题此前**结构上没有答案**（没有访客、没有会话）。
 *   本页是外部访客最可能落脚的页子（进来看题、看一道题的一生）⇒ 埋点接在这里。
 *
 * 【三条纪律（改这段前先读）】
 *   ① ★只发**题目的整数 id**，绝不发题面、姓名、邮箱、UA。后端也只收白名单字段，
 *     双端各挡一次——「顺手把题塞进去」在两侧都落不了库。
 *   ② 埋点**失败一律吞掉**。读数页不能因为埋点接口挂了而变错误态。
 *   ③ 判「作者本人」靠本机 localStorage 里那份作者密钥：
 *       localStorage.setItem('p1b_author_key', '<与后端 P1B_AUTHOR_KEY 相同的值>')
 *     粘一次即可，之后本页每次请求都带上。**不粘就当普通访客**（后端未配密钥时
 *     一律判不出作者，属 fail-closed，见 src/db/analyticsStore.js 文件头）。
 */

/** 访客 id 存在本机：让「同一个人」在多次会话间可被认出；库里没有第二份可关联的字段。 */
const VISITOR_KEY = 'p1b_visitor_id';
/** 作者密钥（可选）。没设置就不发这个字段——后端会判成访客。 */
const AUTHOR_KEY = 'p1b_author_key';

function readLocal(k: string): string | undefined {
  try { const v = localStorage.getItem(k); return v ? v : undefined; } catch (e) { return undefined; }
}
function writeLocal(k: string, v: string): void {
  try { localStorage.setItem(k, v); } catch (e) { /* 隐私模式下写不进去：不埋点也不报错 */ }
}
/** 埋点投递：永远 resolve，绝不 reject，绝不影响本页读数。 */
function beacon(path: string, payload: Record<string, unknown>, keepalive = false): Promise<any> {
  try {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive,
    }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  } catch (e) { return Promise.resolve(null); }
}


/* ★T9：单题入口的数据形状（只读端点 /api/disclosure/resolve-queue，T6）。
   auto_revealed 每行都带**真实的题 id** —— 本页要的就是这个。 */
interface QueueRow { id: number; statement?: string; outcome?: string | null; resolved_at?: string | null; layer?: string | null }
interface QueuePayload { auto_revealed?: QueueRow[] }

/* ★P0-5：题的两视图（GET /api/analytics/questions）。
   ★三个数（我的题/语料库/别人的题）**任何视图都照给**——语料库一条没删，
     只是归到另一个视图；不给这个数就等于假装数据没了，那是最容易误导人的一种省略。 */
interface QRow {
  id: number; statement: string; layer: string | null; source_type: string | null;
  matures_at: string | null; resolved_at: string | null; outcome: string | null;
  view_bucket: 'mine' | 'corpus';
}
interface QuestionView {
  view: 'mine' | 'corpus' | 'all';
  rows: QRow[];
  counts: { mine: number; corpus: number; others: number; total: number };
  auto_revealed: { mine: number; corpus: number; others: number; total: number };
  min_n: number;
  discipline?: string[];
}

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
  /* ★T9：进单题的一生（/question/:id）。取「已揭晓的题」——那是本页读者最可能想细看的一批。 */
  const [q, setQ] = useState<QueueRow[]>([]);
  /* ★P0-4：本次页面停留对应的访客/会话（供离站上报与回访事件共用） */
  const session = useRef<{ visitor_id: string; session_id: string } | null>(null);
  /* ★P0-5：题的两视图（我的题 / 语料库）+ 取不到时的诚实状态 */
  const [qview, setQview] = useState<'mine' | 'corpus'>('mine');
  const [qs, setQs] = useState<QuestionView | null>(null);
  const [qErr, setQErr] = useState<'no-visitor' | 'unavailable' | null>(null);

  // ★P0-4：进站报一次「会话说起来」；离站（pagehide + 卸载）报一次「会话结束」，两次都幂等。
  useEffect(() => {
    const author = readLocal(AUTHOR_KEY);
    const prior = readLocal(VISITOR_KEY);
    beacon('/api/analytics/session/start', { visitor_id: prior, author_key: author }).then((j) => {
      if (!j || !j.visitor_id || !j.session_id) return;
      writeLocal(VISITOR_KEY, j.visitor_id);
      session.current = { visitor_id: j.visitor_id, session_id: j.session_id };
    });
    const leave = () => {
      const s = session.current;
      if (!s) return;
      beacon('/api/analytics/session/end',
        { session_id: s.session_id, reason: 'pagehide', author_key: author }, true);
    };
    window.addEventListener('pagehide', leave);
    return () => { window.removeEventListener('pagehide', leave); leave(); };
  }, []);

  /** ★P0-4：点开一道题 = 回访。**只报整数 id**，题面一个字都不发。 */
  const onOpenQuestion = (id: number) => {
    const s = session.current;
    void beacon('/api/analytics/event', {
      event: 'question_revisited',
      visitor_id: s ? s.visitor_id : readLocal(VISITOR_KEY),
      session_id: s ? s.session_id : undefined,
      subject_id: id,
      author_key: readLocal(AUTHOR_KEY),
    });
  };

  useEffect(() => {
    let alive = true;
    fetch('/api/disclosure/calibration')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((j) => alive && setD(j))
      .catch(() => alive && setBad(true));
    return () => { alive = false; };
  }, []);

  // ★独立失败不拖累本页：读不到单题清单只说明这一段没有，不该把整个回声页打成错误态
  useEffect(() => {
    let alive = true;
    fetch('/api/disclosure/resolve-queue')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setQ((j as QueuePayload | null)?.auto_revealed || []))
      .catch(() => alive && setQ([]));
    return () => { alive = false; };
  }, []);

  // ★P0-5：切到哪个视图（默认「我的题」）。
  //   为什么要有这个开关：外部用户第一屏不该是一整片他不认识的机器题
  //   （实测 2026-09-28：账本未揭晓 294 条，全是批量灌进来的）。
  //   但**语料库一条没删**，只是归到另一个视图——所以切得过去，数也照报。
  useEffect(() => {
    let alive = true;
    setQErr(null);
    const vid = session.current ? session.current.visitor_id : readLocal(VISITOR_KEY);
    if (!vid) { setQs(null); setQErr('no-visitor'); return () => { alive = false; }; }
    const url = '/api/analytics/questions?view=' + qview + '&limit=50&visitor_id=' + encodeURIComponent(vid);
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((j) => { if (alive) setQs(j as QuestionView); })
      .catch(() => { if (alive) { setQs(null); setQErr('unavailable'); } });
    return () => { alive = false; };
  }, [qview]);


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

          {/* ══ ④ 进单题的一生（T9 + P0-5 两视图）══
              ★为什么是**另起一段**而不是给上面那些行挂链接：
              偏流条 / 习惯 / 薄格三处的数据全是 **layer×domain 的聚合**
              （实测 calibration-report 的 cells 共 29 行，键只有
              layer/domain/scored_n/mean_p/obs_rate/brier_engine/delta_vs_half…，
              **一个题目 id 都没有**）。给聚合行挂 /question/:id 就必须编一个 id，
              而编出来的 id 点开是**另一道题**——那比不给入口更糟。
              ⇒ 这一段列的是**真的题**：id 直接取自后端（两视图端点
                /api/analytics/questions；取不到时退回 /api/disclosure/resolve-queue
                的 auto_revealed），点哪条就是哪条。

              ★P0-5：默认看**我的题**。语料库（批量灌入的机器题）一条没删，
                只是在另一个视图里——所以段首永远写着「语料库还有 N 条」，
                点一下就切过去。**筛掉了 N 条 ≠ 数据没了 N 条**，这两句必须同时出现。 */}
          <section className="whereoff-s5" data-testid="wo-questions">
            <h2 className="whereoff-h">
              看一道题的一生
              <HelpMark testId="wo-q-help"
                text="上面那些是聚合：一条线是一格（层 × 域），不是一道题。这一段列的是**具体某一道题**——题面、当时押的数、引擎给的数、真值、判词、以及「现在回头看」。" />
            </h2>

            {/* 两视图切换：默认「我的题」。语料库永远显示条数，绝不静默消失。 */}
            <div className="wo-views" role="group" aria-label="题的归属视图">
              <button type="button" data-testid="wo-view-mine"
                className={'wo-view' + (qview === 'mine' ? ' is-on' : '')}
                aria-pressed={qview === 'mine'} onClick={() => setQview('mine')}>
                我的题{qs ? '（' + qs.counts.mine + '）' : ''}
              </button>
              <button type="button" data-testid="wo-view-corpus"
                className={'wo-view' + (qview === 'corpus' ? ' is-on' : '')}
                aria-pressed={qview === 'corpus'} onClick={() => setQview('corpus')}>
                语料库{qs ? '（' + qs.counts.corpus + '）' : ''}
              </button>
            </div>

            {qs ? (
              <p className="whereoff-note" data-testid="wo-view-note">
                {qview === 'mine' ? (
                  <>这是<b>归属你的题</b>。另有 <b className="u-mono">{qs.counts.corpus}</b> 条在语料库里
                    （批量灌入的机器题，<b>一条都没删</b>，只是不在这儿列）——
                    筛掉不等于没有{dataMinNote(qs)}</>
                ) : (
                  <>这是<b>语料库</b>：批量灌入、没有归属记录的题，<b>一条都没删</b>。
                    归属你的 <b className="u-mono">{qs.counts.mine}</b> 条在「我的题」里
                    {qs.counts.others ? <>；另有 <b className="u-mono">{qs.counts.others}</b> 条是别的使用者的（只报数，不给你看）</> : null}。
                    这 {qs.counts.total} 条合计已自动揭晓 <b className="u-mono">{qs.auto_revealed.total}</b> 条——
                    语料库里的题也在自动结算（{qs.auto_revealed.corpus} 条）{dataMinNote(qs)}</>
                )}
              </p>
            ) : null}

            {qs && qs.rows.length ? (
              <ul className="qlist">
                {qs.rows.slice(0, 8).map((row) => (
                  <li key={row.id} className="qlist-row">
                    <Link to={'/question/' + row.id} className="qlist-link"
                      onClick={() => onOpenQuestion(row.id)}>
                      <span className="qlist-txt">{row.statement || '（无题面）'}</span>
                      <span className="qlist-meta">
                        {row.layer ? <span>{row.layer}</span> : null}
                        <span>{row.outcome === 'true' ? '发生了' : row.outcome === 'false' ? '没发生' : '判定不清'}</span>
                        {row.resolved_at ? <span>{row.resolved_at}</span> : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : qs ? (
              <p className="whereoff-empty" data-testid="wo-view-empty">
                {qview === 'mine'
                  ? '还没有归属你的题。记一笔写下的题会自动出现在这里。'
                  : '语料库现在是空的。'}
              </p>
            ) : null}

            {/* ★取不到两视图端点时**不假装**：明确说这是不分归属的账本切片，
                绝不把整片语料库挂在「我的题」标题下——那正是这个改动要消灭的那件事。 */}
            {!qs ? (
              <p className="whereoff-note" data-testid="wo-view-fallback">
                {qErr === 'no-visitor'
                  ? '还没拿到访客标识，这一栏分不出「我的题」和「语料库」。'
                  : '分视图的清单取不到（后端没接上），下面是账本里最近已揭晓的题——'
                    + '它们<b>不分归属</b>，不是「你的题」。'}
              </p>
            ) : null}
            {!qs && q.length ? (
              <ul className="qlist">
                {q.slice(0, 8).map((row) => (
                  <li key={row.id} className="qlist-row">
                    <Link to={'/question/' + row.id} className="qlist-link"
                      onClick={() => onOpenQuestion(row.id)}>
                      <span className="qlist-txt">{row.statement || '（无题面）'}</span>
                      <span className="qlist-meta">
                        {row.layer ? <span>{row.layer}</span> : null}
                        <span>{row.outcome === 'true' ? '发生了' : row.outcome === 'false' ? '没发生' : '判定不清'}</span>
                        {row.resolved_at ? <span>{row.resolved_at}</span> : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

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

      {/* ★2026-09-29：另一条线——不是"我偏在哪儿"，是"这件事会不会发生"。
          入口挂在这里，因为这一页是站里唯一的「看数」入口（八轮把 9 项导航收成 5 项之后）；
          诚实区间自己只占一个详情页位、不进导航（再塞一个「看数」项等于把收过的口重新撑开）。 */}
      <p className="whereoff-alt">
        <Link to="/baseline">诚实区间：某件事会不会发生</Link>
        <span>给区间；要不要一个数由你点（默认只看区间）。</span>
      </p>
    </div>
  );
}

/** n<30 纪律：账本太小的时候，界面只给条数、明确不给比例（后端 shares 也是这么回的）。 */
function dataMinNote(v: QuestionView): string {
  return v.counts.total < v.min_n
    ? `。账本里一共才 ${v.counts.total} 条（不足 ${v.min_n}），所以只记条数、不给任何比例。`
    : '。';
}

function hashId(s: string): number {  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export { WhereOffPage };

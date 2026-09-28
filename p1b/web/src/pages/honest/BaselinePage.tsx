/**
 * BaselinePage —— 诚实区间（2026-09-29 · 「某件事会不会发生」）
 *
 * 【这一页在解决什么】
 * 用户问一句「某件事会不会发生」，系统只有两条路可走：
 *   ① 给一个数 —— 但这个数是谁给的？凭什么？样本多少？
 *   ② 明说给不了 —— 那至少得说清**为什么**给不了，以及**能给的部分**是什么。
 * 过去这两条路都走偏过：要么假装精确（给一个没人有根据的数），
 * 要么什么都不给（连"同类以前发生过几次"这种本来就知道的事也藏起来）。
 *
 * 【★本轮的核心产品决定：要不要一个数，交给用户选】
 * 页面上有**两个出口**，用户自己点，默认「严格」：
 *   · 严格   —— 只显示区间（区间两端 + 它保证盖住什么）；
 *   · 给基率 —— 连点估计一起显示。
 * 为什么不替他决定诚实：一个人要"范围"和一个人要"数"都是正当需求，
 * 系统能做的不是挑一个给，而是**把两样都摆出来、说清各自是什么、让人自己挑**。
 *
 * 【★薄样本的纪律：两个出口都不给数】
 * 样本不足 30 时，端点把 `point_estimate` 置 null（口径见 routes/baseline.js），
 * 于是「严格」和「给基率」**同时**拿不到数——这一条不由用户选，
 * 也不能拿"这是基率不是判断"当理由给出去：那句话是绕过纪律的话术，不是给得出去的理由。
 * （"账本里一道这种题都没有"是**另一件事**，界面上是另一句话，见 STATE_HEAD。）
 *
 * 【零新依赖 · 零造组件】
 * 区间图直接用既有的 `charts/ErrorBar`：`value` 是可空的独立入参，
 * 缺 `value` 时它只画区间不画点（`ErrorBar.tsx:36,68-70` 的 `tv === null` 分支），
 * 也就是本页「严格」出口要的形状——**不新画一根须，也不引图表库**。
 * ⚠ 如实记账：ErrorBar 自己的空态文案是「样本不足」，
 *   在"样本够、只是用户选择不给点"的严格出口下这句与实情不符。
 *   本页的处理是——**图的形状归它，数字与解释归本页**（下方 hb-nums 全部由本页渲染），
 *   并在紧挨着的地方写明"不是取不到，是选择不给"。本轮不改装图组件（见交付说明）。
 *
 * 【禁词】界面与注释全文不出现那两个字（披露纪律，同 QuestionPage）。
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorBar } from '../../charts/ErrorBar';
import { Wait } from '../../components/Wait';
import { KIND_GROUPS, kindLabel } from '../../lib/kindLabel';
import './baseline.css';

/* ══════════ 后端契约（GET /api/baseline/:kind）══════════
   字段按端点实返形状写，不猜；`interval` 为 null 是**常态**（三态里有两态没有区间），
   所以它是可空元组，不是「一定有」。 */
interface Reading {
  ok: boolean;
  kind: string;
  state: 'enough' | 'too_thin' | 'no_rows';
  n: number;
  k: number | null;
  enough: boolean;
  point_estimate: number | null;
  interval: [number, number] | null;
  coverage_guarantee: string | null;
  method: string;
  source: string;
  reason: string;
  engine_note: string;
  counts?: {
    rows_total: number; settled: number;
    excluded_tautology: number; excluded_truth_basis: number; excluded_unsettled: number;
  };
  discipline?: string[];
  generated_at: string;
}

/** 两个出口。默认必须是 'strict'——不许一进来就甩一个数给人。 */
type Exit = 'strict' | 'baserate';

/** 三态横幅。★三句必须各不相同：那边是"有、但太少"，这边是"根本没有这一类"。
 *  用词与后端 reason 里的同一句对齐（「只能记方向」），免得界面与接口各说一套。 */
export const STATE_HEAD: Record<Reading['state'], string> = {
  enough: '给区间。',
  too_thin: '只能记方向。',
  no_rows: '账本里一道这种题都没有。',
};

/** 概率格式化。★取不到就写「取不到」，绝不写 0%：0% 是"测了是 0"，空是"没测"。 */
export const pct = (v: number | null | undefined): string =>
  (v === null || v === undefined) ? '取不到' : (v * 100).toFixed(1) + '%';

/** 区间格式化。同上：没有区间就说取不到，**不许**退化成 0–0% 或 0–100%。 */
export const ivText = (iv: [number, number] | null): string =>
  iv ? (iv[0] * 100).toFixed(1) + '% – ' + (iv[1] * 100).toFixed(1) + '%' : '取不到';

/** 薄样本那句与「一道都没有」那句的分界——点估计取不到时用它说明是哪一种。 */
export const noNumberWhy = (r: Reading): string =>
  r.state === 'no_rows'
    ? '取不到——账本里一道这种题都没有，先出一道这种题才有同类可比。'
    : '取不到——同类不足 30 条，这一类本就不给数（点估计和区间都不给）。';

/** 默认落在第一组第一项：省得给一个可能账本里一道都没有的 kind 当默认。 */
const DEFAULT_KIND = KIND_GROUPS[0].items[0].kind;

export default function BaselinePage() {
  const [kind, setKind] = useState<string>(DEFAULT_KIND);
  const [exit, setExit] = useState<Exit>('strict'); // ★默认严格：不主动甩数
  const [d, setD] = useState<Reading | null>(null);
  const [bad, setBad] = useState<string | null>(null);
  const [run, setRun] = useState(0);

  useEffect(() => {
    let alive = true;
    setD(null); setBad(null);
    fetch('/api/baseline/' + encodeURIComponent(kind))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((j) => alive && setD(j as Reading))
      .catch((e) => alive && setBad(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  }, [kind, run]);

  const iv = d && d.interval ? d.interval : null;
  const hasPoint = !!d && d.point_estimate !== null;
  const label = kindLabel(kind);

  return (
    <div className="hb">
      <Link to="/where-off" className="hb-back">回到「我在哪儿偏了」</Link>

      <header className="page-head">
        <h1>诚实区间</h1>
        <p className="page-sub">
          问一句「这件事会不会发生」，这里要么给你一个<b>保证覆盖的区间</b>，
          要么明说给不了、并且说清是哪种给不了。
          <b>要不要再来一个数，由你选——这一条不替你决定诚实。</b>
        </p>
      </header>

      {/* ── 选哪一类事 ── */}
      <section className="hb-pick">
        <label className="hb-lbl" htmlFor="hb-kind">问哪一类事</label>
        <select
          id="hb-kind" className="hb-sel" value={kind} data-testid="hb-kind"
          onChange={(e) => setKind(e.target.value)}
        >
          {KIND_GROUPS.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.items.map((it) => (
                <option key={it.kind} value={it.kind}>{it.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="hb-src">
          到期时去 <b>{label.source}</b> 查真实答案。
          「同类」指的是<b>真值锚相同</b>的题——不是字面相似，是同一处数据。
        </p>
      </section>

      {/* ── ★两个出口（本页的核心）── */}
      <section className="hb-exit" aria-label="出口">
        <h2 className="hb-exit-h">
          要不要一个数？
          <span>系统不替你选。</span>
        </h2>
        <div className="hb-exit-btns">
          <button
            type="button" data-testid="hb-exit-strict"
            className={'hb-btn' + (exit === 'strict' ? ' is-on' : '')}
            aria-pressed={exit === 'strict'}
            onClick={() => setExit('strict')}
          >
            严格 · 只看区间
          </button>
          <button
            type="button" data-testid="hb-exit-baserate"
            className={'hb-btn' + (exit === 'baserate' ? ' is-on' : '')}
            aria-pressed={exit === 'baserate'}
            onClick={() => setExit('baserate')}
          >
            给基率 · 连那个数一起看
          </button>
        </div>
        <p className="hb-exit-note">
          默认是「严格」。样本不足 30 时<b>两个出口都取不到数</b>——这一条不由你选，
          也不拿「这只是基率、不是判断」当理由给出去：那句话是绕过纪律的话术。
        </p>
      </section>

      <Wait state={bad ? 'error' : d ? 'idle' : 'pending'}
        what="在数同类题里真出现过几次…" testId="hb-wait"
        error={bad ? '读不到这类题的读数（' + bad + '）。' : null}
        onRetry={() => setRun((n) => n + 1)} />

      {d ? (
        <section className="hb-read" data-testid="hb-read">
          {/* 三态横幅：够／薄／一道都没有，各是一句不同的话 */}
          <p className={'hb-state is-' + d.state} data-testid="hb-state">
            <b>{STATE_HEAD[d.state]}</b> {d.reason}
          </p>

          {/* 区间图：严格出口 value={null} ⇒ 只画须、不画点。
              两个出口读的是**同一个** point_estimate 字段，所以 n<30 时它们同时退化成这一支。 */}
          {d.state === 'enough' ? (
            <div className={'hb-chart' + (exit === 'strict' ? ' is-strict' : '')} data-testid="hb-chart">
              {exit === 'strict' || !hasPoint ? (
                <ErrorBar
                  value={null} ciLo={iv ? iv[0] : null} ciHi={iv ? iv[1] : null}
                  lo={0} hi={1} width={280}
                  label={<>同类里真发生过的比例　·　n={d.n}</>}
                  testId="hb-errbar"
                />
              ) : (
                <ErrorBar
                  value={d.point_estimate} ciLo={iv ? iv[0] : null} ciHi={iv ? iv[1] : null}
                  lo={0} hi={1} width={280}
                  label={<>{label.label}　·　历史 {d.n} 条里发生 {d.k === null ? '—' : d.k} 条</>}
                  testId="hb-errbar"
                />
              )}
            </div>
          ) : null}

          {/* ★数字与解释以本页为准（图的形状归 ErrorBar，文案归本页） */}
          <dl className="hb-nums">
            <div className="hb-num">
              <dt>同类已结算</dt>
              <dd>{d.n} 条（其中真发生 {d.k === null ? '—' : d.k} 条）</dd>
            </div>
            <div className="hb-num">
              <dt>区间</dt>
              <dd>{ivText(d.interval)}</dd>
            </div>
            <div className="hb-num">
              <dt>点估计</dt>
              <dd>
                {!hasPoint
                  ? noNumberWhy(d)
                  : (exit === 'strict'
                    ? '按你选的「严格」这一屏不给。样本 n=' + d.n + ' 是够的——不是取不到，是选择不给；想看就切到「给基率」。'
                    : pct(d.point_estimate))}
              </dd>
            </div>
            <div className="hb-num is-wide">
              <dt>这个区间的覆盖保证</dt>
              <dd>
                {d.coverage_guarantee
                  ? d.coverage_guarantee
                  : '没有区间，也就没有覆盖保证可说——这里不给你一句凑数的。'}
              </dd>
            </div>
          </dl>

          {/* ★「给基率」出口的强制标注：同一屏、不可折叠。
              少这一句，那个数会被读成"谁算出来的判断"，而它只是账本里的比例。 */}
          {exit === 'baserate' && hasPoint ? (
            <p className="hb-caveat" data-testid="hb-caveat">
              <b>这个数是历史基率，不是任何人的判断。</b>
              {' '}它是账本里同类已结算 {d.n} 条里真发生 {d.k === null ? '—' : d.k} 条的比例——
              没有人对这一道题表过态，引擎也没有。换个人来问，它不会变；
              你自己押多少，它也不会变。
            </p>
          ) : null}
        </section>
      ) : null}

      {d ? (
        <footer className="hb-foot">
          <p className="hb-foot-h">口径与纪律</p>
          <ul>
            <li>同类＝真值锚（<code>{d.kind}</code>）相同的题；没揭晓的题不进分母。</li>
            {d.counts ? (
              <li data-testid="hb-counts">
                这一类账本上一共 <b>{d.counts.rows_total}</b> 条：
                已结算 <b>{d.counts.settled}</b>、没揭晓 <b>{d.counts.excluded_unsettled}</b>、
                重言题剔出 <b>{d.counts.excluded_tautology}</b>、
                真值口径缺陷剔出 <b>{d.counts.excluded_truth_basis}</b>，
                真正进分母的 <b>{d.n}</b> 条（剔了多少都摆在这里，不静默吞题；
                两个剔除计数各自独立、一行可能同时中两条，所以它们不保证相加等于总数）。
              </li>
            ) : null}
            {(d.discipline || []).map((s, i) => <li key={i}>{s}</li>)}
          </ul>
          <p className="hb-engine">
            引擎原话（照登不加工）：<code>{d.engine_note}</code>
            <span>算于 {d.generated_at}</span>
          </p>
        </footer>
      ) : null}
    </div>
  );
}

export { BaselinePage };

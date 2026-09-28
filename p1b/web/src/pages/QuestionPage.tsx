/** QuestionPage —— 一道题的完整一生（2026-09-28 · T9 · 归档环）
 *
 * 【为什么要有这一页】
 * 别的地方都在看**聚合**（29 个格、六个层、一片偏差条），
 * 聚合回答不了「我这一道题到底怎么回事」。
 * 而一道题的一生是**有先后的**：先押了多少 → 引擎当时给了多少 → 事后真值是什么
 * → 判词留了几条 → 现在回头看是什么情况。
 * 拆成并排的六个盒子，这个先后就没了 ⇒ 竖排时间线，不是卡片网格。
 *
 * 【★本页最要紧的一件事：真值口径】
 * 真库里有 98 行的真值是**事件发生之前**的预报值（结算时间戳早于事件日）。
 * 它们在别处和事后观测长得一模一样。不标出来，读者会把两种东西当同一种——
 * 而这正是本项目最贵的那类错误：一个看起来没问题、其实口径不对的读数。
 * ⇒ excluded 时**全页最重的一块警示**排在最上面，并且**照常展示题面与真值**
 *   （不隐藏：正因为不隐藏，这个标记才必须和内容同屏）。
 *
 * 【诚实纪律，全部来自既有口径，不新造】
 *   ① null 就是「当时没给」，**绝不显示成 0**（0 是"测了是 0"）。
 *   ② 基率 n<30 ⇒ 「只能记方向」，且**不给比较结论**——
 *      拿 12 条样本说"你比引擎乐观"是本产品最要防的误读。
 *   ③ 真值＝判定不清（ambiguous）⇒ **不判分**（判定标准歧义不许硬判）。
 *   ④ 不给总分、不说「你准不准」——裁决留给读者（与「我在哪儿偏了」同纪律）。
 *
 * 【T10 判词离散度：为什么这一节要写这么多字】
 *   「同一道题换个问法、换个温度，答案从 98% 摆到 45%」——这件事**很容易被画成折线**，
 *   而折线会让人读出「信念在随时间更新」。可它根本没有时间轴：
 *   decouple9 批次的 9 路读数 created_at **逐位相同**（一次性批量写入，构造上就没有先后）。
 *   ⇒ 本节只用**点阵**（每条读数一个点，落在 0–100% 轴上），**永远不画折线**；
 *     并且把「这是横截面不是时间序列」「它测重测信度不测准头」两句**常驻在图旁边**，
 *     不折叠、不藏进详情——少这两句就是把采样噪音讲成洞察。
 *
 * 【禁词】界面与注释全文不出现该词；`source_type` 的机器枚举值**不上屏**
 *   （改成「系统自动／手记」两个人话标签，事实不丢，机器枚举仍留在 API 里）。
 *   ★后端 `discipline` 数组**原文照登**（它是口径的单一真源），已核过其中零命中。
 *
 * 【零新依赖】只用 react / react-router-dom 与项目内既有模块；离散度是纯 CSS 点阵，不引图表库。
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Wait } from '../components/Wait';
import { IconAlert, IconArrow, IconClock } from '../components/ui';
import { kindLabel } from '../lib/kindLabel';
import '../styles/question.css';

/* ══════════ 后端契约（GET /api/predictions/:id，T8）══════════
   字段全部按真库实测形状写，不猜。TS 6133 纪律：每个接口字段都要有读取点。 */
interface BaseRate {
  p: number; n: number | null; k: number | null;
  kind: string; via: string; enough: boolean; note: string; raw_note: string | null;
}
interface TruthAnchor { kind?: string; cmp?: string; threshold?: number | string; [k: string]: unknown }
interface Verdict {
  id: number; prompt_variant: string; temperature: number;
  verdict_text: string; implied_prob: number | null; model: string | null;
  run_id: string | null; created_at: string;
}
interface TruthBasis {
  excluded: boolean; hits: string[]; reason: string; rule: string;
  fingerprint_sha256: string; n_excluded_at_freeze: number;
}
interface Payload {
  id: number; game_id: number; day: number | null; source_type: string;
  statement: string; created_at: string;
  assigned_prob: number | null;
  base_rate: BaseRate | null;
  truth_anchor: TruthAnchor | null;
  outcome: 'true' | 'false' | 'ambiguous' | null;
  resolved_at: string | null; resolve_note: string | null; matures_at: string | null;
  verdict_count: number; verdicts: Verdict[];
  truth_basis: TruthBasis;
  layer: string | null; engine: string | null; gate: string | null;
  l0_gate?: { gate?: string; records_valid?: number; review_unlocked?: boolean };
  discipline?: string[];
}

/** 六段顺序是**契约**，不是排版偏好：题面 → 你的数 → 引擎的数 → 真值 → 判分 → 现在的看法。 */
export const STAGES = ['题面', '你的数', '引擎的数', '真值', '判分', '现在的看法'] as const;

/** 三路判词的人话名（照后端 routes/verdicts.js 的 ROUTES 常量，不另编一套）。 */
const VARIANT_LABEL: Record<string, string> = {
  v1_evidence: '证据聚合',
  v2_skeptical: '怀疑派',
  v3_baserate: '基率视角',
};

/** source_type 的机器枚举**不上屏**（见头注禁词条）：只把人话标签给出去，事实不丢。
 *  可测的不变式只有一个：**返回值恒不等于入参**——枚举值一旦被原样回显，禁词就上屏了。
 *  导出供纪律闸直接调用。 */
export function sourceLabel(s: string | null | undefined): string {
  if (s === '验证点') return '系统自动出的题';
  if (s) return '你手记的题';
  return '来源未记录';
}

/* ══════════ 判词离散度契约（GET /api/disclosure/verdict-spread，T10）══════════
   ★端点**不按 id 过滤**：它把整份 40 题的披露件原样返回（实测 33KB），
   前端按 questions[].pid 自己挑本题那一条。挑不到就是挑不到——不拿别的题充数。
   字段按 verdict-spread-20260922.json 实测形状写：
     questions[] = {pid, layer, outcome, row_count, variants, per_variant, spread, mean, sd, p10, p90}
     per_variant.<变体> = {n, values[], mean, sd, min, max}      ★sd 在 n<2 时为 null
   ★row_count 实测分布 {7:1, 8:3, 9:1, 10:35} —— **不是恒等于 9**：
   v1_evidence@T=0.2 那一格多跑了一个 -rep 副本。所以界面上「9 路」是**设计**，
   本题的**实测条数**必须另写一行，两者一起出现才算如实。 */
interface SpreadVariant { n: number; values: number[]; mean: number; sd: number | null; min: number; max: number }
interface SpreadQuestion {
  pid: number; layer?: string; outcome?: string | null;
  row_count: number; variants: number;
  per_variant: Record<string, SpreadVariant>;
  spread: number; mean: number; sd: number | null; p10: number; p90: number;
}
interface SpreadPayload {
  title?: string; generated_at?: string;
  discipline?: string[]; no_time_axis?: boolean;
  summary?: {
    questions?: number; total_rows?: number; complete_9_rows?: number;
    median_spread?: number; max_spread?: number; runs?: string[];
  };
  questions?: SpreadQuestion[];
}

/** 设计路数（3 变体 × 3 温度）。写死是因为它来自后端 ROUTES 常量，与实测条数**分开陈述**。 */
const SPREAD_DESIGN_ROUTES = 9;

/** 摆动幅度的中文说法：0.94 ⇒「94 个百分点」。
 *  ★用「个百分点」不用「%」：0.94 是两个概率之差，不是「94% 的准确率」——
 *  写成 94% 会被读成水平，读成差值才对。 */
export function spreadWords(spread: number | null | undefined): string {
  if (spread === null || spread === undefined) return '—';
  return Math.round(spread * 100) + ' 个百分点';
}

/** 概率格式化。★null ⇒ 「—」，**绝不** 0%：0 是"测了是 0"，空是"没测"。
 *  导出供纪律闸直接调用（NotePage 的 verdictText 同款：纯函数就该能被单测直接打）。 */
export const pct = (p: number | null | undefined): string =>
  p === null || p === undefined ? '—' : (p * 100).toFixed(1) + '%';

/** ★差值句：只说**方向与差多少**，不贴「乐观／保守」这类结论词。
 *  薄样本时必须把「只能记方向」挂在**同一句**里——差值旁边就是最容易被过度解读的地方。
 *  ★两个分支（几乎一样 / 高低）都挂限定语：差 0.00 同样可能是 n=16 的巧合，
 *  漏掉这一支就等于给"最像结论的那种读数"免了标注。 */
export function gapLine(yours: number | null, br: BaseRate | null): string | null {
  if (yours === null || !br) return null;
  const d = yours - br.p;
  const a = Math.abs(d);
  const tail = br.enough ? '' : `（引擎那个数只来自 n=${br.n} 条样本，不足 30 ⇒ 这条差值只能记方向，别当结论）`;
  if (a < 0.01) return `你的数与引擎的数几乎一样（差 0.00）——两边都在说同一件事。${tail}`;
  return `你的数比引擎的数${d > 0 ? '高' : '低'} ${a.toFixed(2)}。${tail}`;
}

/** ★「现在的看法」：**只描述事实，不下裁决**。不给总分、不说准不准。 */
export function nowView(d: Payload): string[] {
  const out: string[] = [];
  const br = d.base_rate;
  const yours = d.assigned_prob;

  if (d.truth_basis.excluded) {
    out.push('这道题不进入任何读数——它的真值口径被排除了。下面只说当时记下了什么，不构成判分。');
  }

  if (d.outcome === null) {
    out.push(d.matures_at
      ? `还没揭晓（到期日 ${d.matures_at}）。真值出来之前，任何"准不准"都只是猜测，本页不给这种话。`
      : '还没揭晓，也没有记到期日。真值出来之前，任何"准不准"都只是猜测，本页不给这种话。');
  } else if (d.outcome === 'ambiguous') {
    out.push('真值是「判定不清」——判定标准本身有歧义，所以这道题不判分。歧义不是你的错，也不是数据的错，是判据没写够。');
  } else {
    out.push(d.outcome === 'true'
      ? '真值是「发生了」。'
      : '真值是「没发生」。');
  }

  const g = gapLine(yours, br);
  if (g) out.push(g);
  else if (yours === null && !br) out.push('这道题既没留下你的数，也没有基率读数——账本上只有题面和真值。');
  else if (yours === null) out.push('当时你没给数（不是给了 0）。基率读数还在下面那一段。');
  else if (!br) out.push('当时你给了数，但这道题没有基率读数 ⇒ 没有可比的对象，也就没有差值。');

  if (d.verdict_count > 0) {
    out.push(`另外留了 ${d.verdict_count} 条判词。判词是当时按三种视角各写一遍的文字，它不是你的判断，也不是真值——别把它当第三个数。`);
  }
  return out;
}

/** 真值节点的状态类：实心＝有值；空心＝当时就是空的。 */
function truthCls(o: Payload['outcome']): string {
  if (o === 'true') return 'q-truth is-true';
  if (o === 'false') return 'q-truth is-false';
  if (o === 'ambiguous') return 'q-truth is-amb';
  return 'q-truth is-open';
}
const TRUTH_WORD: Record<string, string> = { true: '发生了', false: '没发生', ambiguous: '判定不清' };

/** 离散度一节的取数状态。`notin` 与 `missing` 必须分开：
 *  「这件题没被反复问过」和「压根没生成过这个件」是两件事，混成一句就是骗人。 */
type SpreadState =
  | { s: 'idle' }
  | { s: 'loading' }
  | { s: 'missing'; hint?: string }
  | { s: 'notin'; covered: number }
  | { s: 'ok'; q: SpreadQuestion; meta: SpreadPayload };

export default function QuestionPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Payload | null>(null);
  const [bad, setBad] = useState<string | null>(null);
  const [foot, setFoot] = useState(false);
  const [sp, setSp] = useState<SpreadState>({ s: 'idle' });

  useEffect(() => {
    let alive = true;
    setD(null); setBad(null); setSp({ s: 'idle' });
    fetch('/api/predictions/' + encodeURIComponent(String(id || '')))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((j) => alive && setD(j as Payload))
      .catch((e) => alive && setBad(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  }, [id]);

  /* 离散度：★只在「本题有判词」时才去拉那份 33KB 的件——
     没有判词就不可能被反复问过，离散度读数在构造上不可能存在。
     早拉只会让每道题都白下载一次全量件。 */
  useEffect(() => {
    if (!d || d.verdict_count === 0) return;
    let alive = true;
    setSp({ s: 'loading' });
    fetch('/api/disclosure/verdict-spread')
      .then((r) => r.json().then((j: unknown) => ({ ok: r.ok, j: j as SpreadPayload & { hint?: string; error?: string } })))
      .then(({ ok, j }) => {
        if (!alive) return;
        if (!ok) { setSp({ s: 'missing', hint: j.hint }); return; }
        const qs = Array.isArray(j.questions) ? j.questions : [];
        const hit = qs.find((q) => q.pid === Number(id));
        setSp(hit ? { s: 'ok', q: hit, meta: j } : { s: 'notin', covered: qs.length });
      })
      .catch(() => alive && setSp({ s: 'missing' }));
    return () => { alive = false; };
  }, [d, id]);

  return (
    <div className="qpage">
      <Link to="/where-off" className="q-back">
        <IconArrow size={13} />
        回到「我在哪儿偏了」
      </Link>

      <header className="page-head">
        <h1>一道题的完整一生</h1>
      </header>
      <p className="page-sub">
        从写下题面到今天回头看，六步按发生的先后排下来。哪一步当时就是空的，那一步就空着——
        <b> 空着是事实，补一个数上去才是编的。</b>
      </p>

      <Wait state={bad ? 'error' : d ? 'idle' : 'pending'}
        what="在读这道题的一生…" error={bad ? '读不到这道题（' + bad + '）。' : null}
        onRetry={() => location.reload()} testId="q-wait" />

      {d ? (
        <>
          {/* ★真值口径警示：全页最重的一块，且排在最上面。 */}
          {d.truth_basis.excluded ? (
            <div className="q-flag" role="alert" data-testid="q-flag">
              <p className="q-flag-t">
                <IconAlert size={15} />
                本题真值口径被排除统计
              </p>
              <p>{d.truth_basis.reason}</p>
              {d.truth_basis.hits.length ? (
                <ul>{d.truth_basis.hits.map((h, i) => <li key={i}>{h}</li>)}</ul>
              ) : null}
              <p className="q-num-note">
                判定口径：<code>{d.truth_basis.rule}</code>
                　排除集指纹 <code>{d.truth_basis.fingerprint_sha256.slice(0, 16)}…</code>
                （冻结时共 {d.truth_basis.n_excluded_at_freeze} 行）。
              </p>
            </div>
          ) : null}

          <ol className="qline" data-testid="q-line">
            {/* ① 题面 */}
            <li className="qline-node is-set" data-testid="q-st-0">
              <h2 className="qline-h">{STAGES[0]}<span className="qline-when">{d.created_at || '—'}</span></h2>
              <div className="qline-b">
                <p className="q-statement">{d.statement}</p>
                <p className="q-meta">
                  <span className="q-tag">{sourceLabel(d.source_type)}</span>
                  {d.layer ? <span className="q-tag">第 <b>{d.layer}</b> 层</span> : null}
                  {d.truth_anchor && d.truth_anchor.kind
                    ? <span className="q-tag">真值锚 <b>{kindLabel(String(d.truth_anchor.kind)).label}</b></span>
                    : <span className="q-tag">没记真值锚</span>}
                  {d.engine ? <span className="q-tag">引擎 <b>{d.engine}</b></span> : null}
                </p>
              </div>
            </li>

            {/* ② 你的数 */}
            <li className={'qline-node ' + (d.assigned_prob === null ? 'is-blank' : 'is-set')} data-testid="q-st-1">
              <h2 className="qline-h">{STAGES[1]}</h2>
              <div className="qline-b">
                {/* ★null 走独立分支：显示「—」并说明"当时没给"，绝不用 0 顶替 */}
                {d.assigned_prob === null ? (
                  <>
                    <p className="q-num is-none">当时没给数</p>
                    <p className="q-num-note">这不是 0。账本上这一格是空的，空就是空。</p>
                  </>
                ) : (
                  <p className="q-num">{pct(d.assigned_prob)}</p>
                )}
              </div>
            </li>

            {/* ③ 引擎的数 */}
            <li className={'qline-node ' + (!d.base_rate ? 'is-blank' : d.base_rate.enough ? 'is-set' : 'is-flagged')} data-testid="q-st-2">
              <h2 className="qline-h">{STAGES[2]}</h2>
              <div className="qline-b">
                {!d.base_rate ? (
                  <>
                    <p className="q-num is-none">这道题没有基率读数</p>
                    <p className="q-num-note">不是 0%，是<b>没算</b>——没有可比的对象，下面也给不出差值。</p>
                  </>
                ) : (
                  <>
                    {/* ★薄样本降对比但**不隐藏**（隐藏＝让人以为没算过，标红＝被人当基线） */}
                    <p className={'q-num' + (d.base_rate.enough ? '' : ' is-thin')}>{pct(d.base_rate.p)}</p>
                    <p className={'q-num-note' + (d.base_rate.enough ? '' : ' is-warn')}>{d.base_rate.note}</p>
                    <p className="q-num-note">
                      口径：{d.base_rate.kind === 'certified' ? '认证值／组合数理论值' : '历史频率'}
                      　·　读法：{d.base_rate.via === 'structured' ? '结构化字段' : '从注记文本解析'}
                      　·　命中 {d.base_rate.k === null ? '—' : d.base_rate.k}／{d.base_rate.n === null ? '样本量未记录' : d.base_rate.n}
                    </p>
                    {d.base_rate.raw_note ? <code className="q-raw">{d.base_rate.raw_note}</code> : null}
                  </>
                )}
              </div>
            </li>

            {/* ④ 真值 */}
            <li className={'qline-node ' + (d.outcome ? (d.truth_basis.excluded ? 'is-flagged' : 'is-set') : 'is-blank')} data-testid="q-st-3">
              <h2 className="qline-h">{STAGES[3]}
                {d.resolved_at ? <span className="qline-when">{d.resolved_at}</span> : null}
              </h2>
              <div className="qline-b">
                <p className={truthCls(d.outcome)} data-testid="q-truth">
                  {d.outcome ? TRUTH_WORD[d.outcome] : '还没揭晓'}
                  {d.truth_basis.excluded ? <span className="q-tag">口径被排除，不计入读数</span> : null}
                </p>
                {d.resolve_note ? <p className="q-num-note">结算注记：{d.resolve_note}</p> : null}
                {d.matures_at ? <p className="q-num-note">到期日 {d.matures_at}</p> : null}
              </div>
            </li>

            {/* ⑤ 判分 */}
            <li className={'qline-node ' + (d.verdict_count ? 'is-set' : 'is-blank')} data-testid="q-st-4">
              <h2 className="qline-h">{STAGES[4]}
                <span className="qline-when">{d.verdict_count} 条</span>
              </h2>
              <div className="qline-b">
                {d.verdict_count === 0 ? (
                  <p className="q-num is-none">没留判词</p>
                ) : (
                  <>
                    {/* ★判词全文收进 details：**一条不删**（删了就等于少算了证据），
                        但默认不展开——实测单题最多 70 条（多批重跑并存），
                        375 屏上默认摊开 70 段长文会把上面五段全顶没。 */}
                    <details className="q-fold" data-testid="q-verdict-fold">
                      <summary className="q-fold-h">
                        展开 {d.verdict_count} 条判词全文
                        <span>默认收起，只留这一行的条数</span>
                      </summary>
                      <ul className="q-verdicts">
                        {d.verdicts.map((v) => (
                          <li key={v.id} className="q-verdict">
                            <p className="q-verdict-h">
                              <span>{VARIANT_LABEL[v.prompt_variant] || v.prompt_variant}</span>
                              <span className="q-verdict-t">T={v.temperature}</span>
                              {/* ★implied_prob 是路由层按末行 P=0.xx 机械抽的，不是模型自由给的数 */}
                              <span className="q-verdict-p">{pct(v.implied_prob)}</span>
                              {v.model ? <span className="q-verdict-t">{v.model}</span> : null}
                            </p>
                            <p className="q-verdict-text">{v.verdict_text}</p>
                          </li>
                        ))}
                      </ul>
                    </details>
                    <p className="q-num-note">
                      那些数是路由层按判词末行 <code>P=0.xx</code> 机械抽出来的，抽不到就留空——不是模型自己给的。
                    </p>

                    {/* ══ T10：判词离散度 ══
                        放在「判分」这一节点**内部**而不是另起第七段：它读的就是这批判词，
                        拆成独立一段会把「判词」和「判词的抖动」看成两件事。 */}
                    <section className="qsp" data-testid="q-spread" aria-labelledby="qsp-h">
                      <h3 className="qsp-h" id="qsp-h">
                        判词离散度：换个问法、换个温度，答案摆到哪儿
                        <IconClock size={13} />
                      </h3>

                      {/* ★★★ 口径两句话：**常驻、不折叠、不藏**。
                          少了它们，下面那张点阵图会被读成「信念在随时间变化」——
                          而这批读数 created_at 逐位相同，构造上就没有时间轴。 */}
                      <div className="qsp-rule" data-testid="q-spread-rule">
                        <p><b>这是单时刻横截面（3 变体 × 3 温度 = 9 路），不是时间序列。</b>
                          所以下面<b>不画折线</b>——横截面连成线就是凭空造出一条时间轴出来。</p>
                        <p>它测的是<b>重测信度</b>（同一句题面反复问，答案有多一致），
                          <b>不是判断的准头</b>。准头要等到期后拿真值比，那在上面的「真值」那一段。</p>
                      </div>

                      {sp.s === 'loading' ? (
                        <Wait state="pending" what="在读这批判词的摆动幅度…" testId="qsp-wait" />
                      ) : null}

                      {sp.s === 'missing' ? (
                        <p className="qsp-none" data-testid="q-spread-missing">
                          读不到离散度披露件（缺件或后端没响应）。
                          {sp.hint ? <> 生成命令：<code>{sp.hint}</code></> : null}
                        </p>
                      ) : null}

                      {sp.s === 'notin' ? (
                        <p className="qsp-none" data-testid="q-spread-notin">
                          这道题<b>没有</b>被反复问过——披露件里覆盖的是 {sp.covered} 道题，本题不在其中。
                          没有重复读数就没有离散度可言，这里<b>不拿别的题的数字来顶</b>。
                        </p>
                      ) : null}

                      {sp.s === 'ok' ? (() => {
                        const q = sp.q;
                        const vs = Object.entries(q.per_variant);
                        /* ★设计 9 路 vs 实测条数：必须**分开说**。
                           实测 row_count 分布 {7:1, 8:3, 9:1, 10:35}——写死「9 路」会撒谎。 */
                        const extra = q.row_count - SPREAD_DESIGN_ROUTES;
                        return (
                          <>
                            <p className="qsp-head">
                              <span className="qsp-num">{spreadWords(q.spread)}</span>
                              <span className="qsp-head-d">
                                本题 {q.row_count} 条读数里，最高 {pct(q.p90)} 附近、最低 {pct(q.p10)} 附近
                                {extra !== 0
                                  ? '（设计是 ' + SPREAD_DESIGN_ROUTES + ' 路；这题多出 '
                                    + (extra > 0 ? extra : -extra) + ' 条是同一配置的重跑副本）'
                                  : '（正好是设计的 ' + SPREAD_DESIGN_ROUTES + ' 路）'}
                              </span>
                            </p>

                            {/* 点阵：每条读数一个点，落在同一条 0–100% 轴上。
                                ★绝不用 <svg> 折线——见上面口径块的理由。 */}
                            <ul className="qsp-rows">
                              {vs.map(([k, v]) => (
                                <li key={k} className="qsp-row" data-testid="q-spread-row">
                                  <span className="qsp-rn">{VARIANT_LABEL[k] || k}</span>
                                  <span className="qsp-axis" aria-hidden="true">
                                    {v.values.map((val, i) => (
                                      <span key={i} className="qsp-dot"
                                        style={{ left: (val * 100).toFixed(2) + '%' }} />
                                    ))}
                                  </span>
                                  <span className="qsp-rd">
                                    {/* ★用「·」分隔而不是全角空格：全角空格在 10.5px 等宽字体里
                                        几乎看不见，读数会挤成「均 1.8%摆动 1 个百分点」这种连读。 */}
                                    <span>{v.n} 条</span>
                                    <span>{pct(v.min)}–{pct(v.max)}</span>
                                    <span>均 {pct(v.mean)}</span>
                                    {/* ★sd 在 n<2 时后端给 null ⇒ 显式「—」，不补 0 */}
                                    <span>摆动 {v.n < 2 ? '—' : spreadWords(v.max - v.min)}</span>
                                    {v.sd === null || v.sd === undefined
                                      ? <span>离散度 —（不足 2 条，算不出）</span> : null}
                                  </span>
                                </li>
                              ))}
                            </ul>
                            <p className="qsp-scale" aria-hidden="true">
                              <span>0%</span><span>50%</span><span>100%</span>
                            </p>

                            {/* 后端 discipline 原文照登：口径的单一真源，前端不另编一套。 */}
                            {sp.meta.discipline && sp.meta.discipline.length ? (
                              <ul className="qsp-disc" data-testid="q-spread-discipline">
                                {sp.meta.discipline.map((s, i) => <li key={i}>{s}</li>)}
                              </ul>
                            ) : null}
                            <p className="qsp-src">
                              口径来自 <code>GET /api/disclosure/verdict-spread</code>
                              {sp.meta.generated_at ? <>（算于 {sp.meta.generated_at}）</> : null}
                              {sp.meta.summary && sp.meta.summary.questions
                                ? <>；同批共 {sp.meta.summary.questions} 题、{sp.meta.summary.total_rows} 条读数，
                                  全批摆动中位 {spreadWords(sp.meta.summary.median_spread)}、最大 {spreadWords(sp.meta.summary.max_spread)}</>
                                : null}
                            </p>
                          </>
                        );
                      })() : null}
                    </section>
                  </>
                )}
              </div>
            </li>

            {/* ⑥ 现在的看法 */}
            <li className="qline-node is-set" data-testid="q-st-5">
              <h2 className="qline-h">{STAGES[5]}</h2>
              <div className="qline-b">
                <div className="q-now" data-testid="q-now">
                  {nowView(d).map((s, i) => <p key={i}>{s}</p>)}
                </div>
                <ul className="q-now-list">
                  <li>本页不给总分，也不说"你准不准"——单题上的任何裁决都是噪音。</li>
                  <li>要看你系统性偏在哪儿，去 <Link to="/where-off">「我在哪儿偏了」</Link>；那里按格聚合，且样本不够的格不参与排序。</li>
                </ul>
              </div>
            </li>
          </ol>

          {/* 页脚：口径与纪律（复核用，默认折叠） */}
          <div className="q-foot">
            <button
              type="button" className="q-foot-handle" data-testid="q-foot"
              aria-expanded={foot} onClick={() => setFoot((v) => !v)}
            >
              {foot ? '收起口径与纪律' : '口径与纪律（复核用）'}
              <span>本页只读 · 门禁状态 · 后端给的纪律条目</span>
            </button>
            {foot ? (
              <div className="q-foot-body" data-testid="q-foot-body">
                <p>本端点只读：一次写入都不做，账本不会被这页改。</p>
                {d.l0_gate && d.l0_gate.gate ? <p>门禁：{d.l0_gate.gate}</p> : null}
                {d.l0_gate ? (
                  <p>
                    有效记录 <code>{d.l0_gate.records_valid ?? '—'}</code> 条
                    　·　评审解锁 <code>{String(d.l0_gate.review_unlocked)}</code>
                  </p>
                ) : null}
                <ul>{(d.discipline || []).map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

export { QuestionPage };

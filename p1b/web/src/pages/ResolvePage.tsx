/**
 * ResolvePage —— 待落定（2026-09-28 · T7：**推翻 2026-08-27 八轮第五改版**）
 *
 * 【为什么推翻上一轮】
 *   旧版把「到期未解」的题列成一队、每条挂三个键，要用户**全部手填**（实测一页 60 条）。
 *   但守护进程早就在自动结算——实测一轮：到期 21 条 ⇒ 自动结 2、待揭晓 12、取数失败 7。
 *   ⇒ 旧版把机器已经做完的事又摊回给人做，是**倒退设计**：它让"账本在自动跑"
 *     这件事在界面上完全看不见，于是使用者以为自己还是这条流水线的主要劳动力。
 *
 * 【本版按「能不能自动揭晓」分三类】
 *   数据源：GET /api/disclosure/resolve-queue（**只读**，不改账本任何一列）。
 *   分类真源：后端 `p1b/src/evidence/revealClass.js`——依据是 **kind 的固有取数能力**
 *   （不是运行时日志：那没落库）。端点已按此分流，前端不再自己判一次。
 *
 *     ① 已自动揭晓 —— 折叠成一行，只给结果与这条的失分。**不追问**：它已经答完了。
 *     ② 待你确认   —— 机器拿不到但人能答。每条写清**为什么没落定**，三个键常驻。
 *     ③ 永远结不了 —— 说清为什么（接口封禁 / 真值窗口已滑出）。
 *                     **绝不给能点但没反应的假按钮**。
 *
 * 【为什么第 ③ 类一个按钮都不给】
 *   点了没反应比不给按钮更糟：使用者会以为是 bug，还会以为账本坏了。
 *   真相（这类题取不到真值）本身就是该知道的信息。宁可少一个出口，
 *   也不给一个假的出口——**③ 那一块里一个可点的东西都没有**。
 *   （2026-09-29 更正：这一段原文写的是「页面里因此只有一处静态标记，没有任何 <button>」。
 *     接入归属三桶后页面上多了三个切换键，那句话已经不成立——留着它就是让注释
 *     替代码说假话，本仓的注释是纪律不是装饰。③ 不给假按钮这条本身没变。）
 *
 * 【2026-09-29 补：题归谁 —— 归属三桶（与上面三类正交）】
 *   病象（实测当日真实库）：这一页打开看到的 33 条**全是没主的机器题**，
 *   每条挂着「真发生 / 没发生 / 判定不清」三个写键。
 *   更根子上的一条：端点也**不知道题归谁**（到期未解的查询里没有归属表）——
 *   于是「这道题是谁的、谁有权答它」这件事在界面上从没被问过。
 *   归属不是显示偏好，它决定**谁有权动这一行**。归属桶一旦有人用起来，
 *   不区分就会把别人的题面连同写键端到访客面前。
 *   ⇒ 接 GET /api/disclosure/resolve-queue 的归属三桶（逐行 view_bucket + open_buckets）：
 *     · 默认看「我的题」；语料库（无归属记录的批量灌入题）**一条没删**，只是归在另一个视图；
 *     · 「别人的题」**只报数、不列行、不给键**；
 *     · 三桶互斥且完备：mine + corpus + others ≡ open_total（端点构造保证，页面照报）。
 *   ★两组三分法**正交**，别混：ok/human/stuck 说的是「能不能自动揭晓」，
 *     mine/corpus/others 说的是「这道题归谁」。一道「待你确认」既可能是我的，也可能是语料库的。
 *
 * 【从旧版接过来的三条铁律，一并保留】
 *   ① 落定＝不可变：已落定 409 拒绝，页面把这条铁律显式讲出来，不静默失败也不给假选项；
 *   ② ambiguous 强制附注：歧义不许硬判（它会进负结果账本——判据不清本身就是一条负结果）；
 *   ③ 不做"先答哪一条"的排序或推荐：推荐是观点，观点会替还没测够的东西说成能读了。
 *
 * 【口径纪律：① 的任何合计都只是"最近 40 条"的切片】
 *   端点只回**最近 40 条**已揭晓记录（实测当日账本已落定 1700 条），
 *   所以页面上出现的每个合计都必须带上 n 与"这是切片"。
 *   账本全体的读数在观测台，这里不冒充它。
 *   薄样本同理：可计分的行数不足 30 时，合计只作参考，不作结论。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, resolvePrediction } from '../api';
import { Wait } from '../components/Wait';
import { kindLabel, hasBareKindLabel } from '../lib/kindLabel';
import { ensureVisitorId } from '../lib/visitor';
import '../styles/resolve.css';

type Verdict = 'true' | 'false' | 'ambiguous';

/** 题的归属桶：我的题 / 语料库（无归属记录）/ 别人的题（只报数、不列行、不给键） */
type OwnerBucket = 'mine' | 'corpus' | 'others';

/** 桶名（界面上照说；「别人的题」这一桶不列行，只报数） */
const BUCKET_NAME: Record<OwnerBucket, string> = { mine: '我的题', corpus: '语料库', others: '别人的题' };

/** 三桶计数：互斥且完备，mine + corpus + others ≡ total（端点构造保证，不是两句承诺） */
interface BucketCounts { mine: number; corpus: number; others: number; total: number }

/** 已自动揭晓的一行（端点 auto_revealed 的投影） */
interface AutoRow {
  id: number;
  statement: string;
  assigned_prob: number | null;
  outcome: string | null;
  resolved_at: string | null;
  layer: string | null;
  kind: string | null;
}

/** 到期未解的一行（端点 ok / need_human / stuck 三桶的公共投影） */
interface OpenRow {
  id: number;
  statement: string;
  assigned_prob: number | null;
  layer: string | null;
  kind: string | null;
  matures_at: string | null;
  cls: string;
  /** 人话理由：这题为什么没能自动落定（或为什么永远落不了） */
  why: string;
  /** 真值锚未在分流表里登记（端点保守归入"待你确认"） */
  unregistered: boolean;
  /** 这道题归谁。与上面的 cls **正交**：能不能自动揭晓是另一件事。 */
  view_bucket: OwnerBucket;
}

interface QueueJson {
  mode: string;
  today: string;
  counts: {
    auto_revealed: number;
    need_human: number;
    stuck: number;
    /** 机器能自动查真值、但此刻还没落定的条数（端点给数也给行） */
    ok?: number;
    /** need_human 的子桶，不是第四类（端点给了数，页面不另算一遍） */
    unregistered: number;
    /** ok + need_human + stuck ≡ 本值（端端注释：前端可自校验）—— 声明它才用得上那句话 */
    open_total: number;
  };
  auto_revealed: AutoRow[];
  ok: OpenRow[];
  need_human: OpenRow[];
  stuck: OpenRow[];
  /** 到期未解这一集合按归属的三桶：mine + corpus + others ≡ counts.open_total */
  open_buckets: BucketCounts;
  /** 账本**全体**已揭晓的归属拆解（不是上面那 40 条切片）——它是账本的性质 */
  auto_by_bucket: BucketCounts;
  /** known=false ⇒ 这枚标识服务端不认：此时「我的题」是 0，但**不是**「你没有题」 */
  viewer: { visitor_id: string | null; known: boolean };
  /** n<30 纪律的分母线（分母不足就只记条数、不给任何比例） */
  min_n: number;
  discipline?: string[];
}

interface Toast { id: number; tone: 'ok' | 'warn' | 'err'; text: string; }

/** outcome → 0/1；判定存疑（ambiguous）不参与判分，如实返回 null */
function truthOf(outcome: string | null | undefined): 1 | 0 | null {
  if (outcome === 'true') return 1;
  if (outcome === 'false') return 0;
  return null;
}

/** 单条失分 =(你说的数 − 实际)²；没给数或判定存疑 ⇒ null（不拿 0 充数） */
function lossOf(row: AutoRow): number | null {
  const y = truthOf(row.outcome);
  if (y === null || typeof row.assigned_prob !== 'number' || !Number.isFinite(row.assigned_prob)) return null;
  const d = row.assigned_prob - y;
  return d * d;
}

/** 结果的人话说法（判分是「这条的账」，不是给结论下判决） */
function outcomeText(outcome: string | null | undefined): string {
  if (outcome === 'true') return '真发生了';
  if (outcome === 'false') return '没发生';
  if (outcome === 'ambiguous') return '记为判定存疑';
  return '结果未回填';
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/**
 * 落定回声：把一道已落定的题，从「到期未解」的**三个数组与两组三桶计数里一致地**摘掉。
 *
 * ★为什么不能只摘 need_human 那一行（2026-09-29 修）：
 *   接了归属三桶之后，同一道题在界面上有**两个**下标 —— 它属 ok/human/stuck 哪一类，
 *   又属 mine/corpus/others 哪一桶。只改前一个，切到别的桶时这一行还赖在列表里，
 *   而它其实已经落定、已经是 revealed 了。计数与明细必须一起动，否则界面会数错。
 *   三个数组都过一遍（而不是只改它原本所在的那个）是为了对"回声已落地之后又连点一次"也成立。
 */
function dropResolved(d: QueueJson, row: OpenRow): QueueJson {
  const has = (a: OpenRow[] | undefined) => (a || []).some((x) => x.id === row.id);
  const wasOk = has(d.ok);
  const wasHuman = has(d.need_human);
  const wasStuck = has(d.stuck);
  if (!wasOk && !wasHuman && !wasStuck) return d;

  const counts = { ...d.counts, open_total: Math.max(0, d.counts.open_total - 1) };
  if (wasOk) counts.ok = Math.max(0, (counts.ok || 0) - 1);
  if (wasHuman) {
    counts.need_human = Math.max(0, counts.need_human - 1);
    const hit = (d.need_human || []).find((x) => x.id === row.id);
    if (hit && hit.unregistered) counts.unregistered = Math.max(0, counts.unregistered - 1);
  }
  if (wasStuck) counts.stuck = Math.max(0, counts.stuck - 1);

  const open_buckets = { ...(d.open_buckets || { mine: 0, corpus: 0, others: 0, total: 0 }) };
  if (open_buckets[row.view_bucket] > 0) open_buckets[row.view_bucket] -= 1;
  open_buckets.total = Math.max(0, open_buckets.total - 1);

  return {
    ...d,
    counts,
    open_buckets,
    ok: (d.ok || []).filter((x) => x.id !== row.id),
    need_human: (d.need_human || []).filter((x) => x.id !== row.id),
    stuck: (d.stuck || []).filter((x) => x.id !== row.id),
  };
}

/**
 * 三桶恒等式的**人话版**（接在切换键下面那句话后面）。
 * 恒等式本身由端点构造保证（见 ownershipStore.bucketize），这里只负责如实报出来；
 * n<30 纪律：两个分母（待办集合、已揭晓账本）任一不足 min_n，就只记条数、不给任何比例。
 */
function bucketTail(open: BucketCounts | null, auto: BucketCounts | null, minN: number): string {
  const thin = (n: number) => (n < minN ? '（分母不足 ' + minN + '，只记条数、不给任何比例）' : '');
  const parts: string[] = [];
  if (auto) {
    parts.push('账本里已揭晓的 ' + auto.total + ' 条按归属拆开：我的 ' + auto.mine
      + ' 条、语料库 ' + auto.corpus + ' 条、别人的 ' + auto.others + ' 条（三者之和 = '
      + (auto.mine + auto.corpus + auto.others) + '）' + thin(auto.total));
  }
  if (open) {
    parts.push('这一个待办集合共 ' + open.total + ' 条，三桶之和 = '
      + (open.mine + open.corpus + open.others) + thin(open.total));
  }
  return parts.length ? parts.join('。') + '。' : '';
}

export default function ResolvePage() {
  const [data, setData] = useState<QueueJson | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [noteFor, setNoteFor] = useState<OpenRow | null>(null);
  const [note, setNote] = useState('');
  /* ★归属三桶：当前看的是哪一桶。默认「我的题」——
     外部用户第一屏不该是一整片他不认识的机器题（WhereOffPage 已同款，见那里的注释）。 */
  const [bucket, setBucket] = useState<OwnerBucket>('mine');
  /** 本机的访客标识（问「这道题归谁」的唯一凭据）；null = 还没拿到或换不到 */
  const [vid, setVid] = useState<string | null>(null);
  /** 标识**问过了**没有。取数要等它落定——首访时它本来就还没到。 */
  const [vidReady, setVidReady] = useState(false);

  // ★发号与取数**串成一条链**，不靠「两个 effect 都在 mount 跑、碰巧谁先谁后」：
  //   新浏览器首访本机没有标识，必须先向服务端换一枚；换回来之前读题只会读到一个
  //   「没有访客」的假答案。await 之后取数才开始，于是首访不会卡死在空态上
  //   （WhereOffPage:189-200 踩的就是这个形状，那边靠用户切一下视图才恢复）。
  useEffect(() => {
    let alive = true;
    void ensureVisitorId().then((v) => {
      if (!alive) return;
      setVid(v);
      setVidReady(true);
    });
    return () => { alive = false; };
  }, []);

  const say = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => t.concat([{ id, tone, text }]));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  /**
   * @param visitorId 本机标识；null = 没拿到（端点按 fail-closed 处理：没有一行会算成「你的」）
   * @param silent    落定之后的静默重取：不进 loading、不动 err、不清 data。
   *   ——刚落定的回声不能被一次失败的网络抖动擦掉，把整页打成错误态。
   */
  const load = useCallback(async (visitorId: string | null, silent = false) => {
    if (!silent) {
      setLoading(true);
      setErr(null);
    }
    let res: Response;
    try {
      const qs = visitorId ? '?visitor_id=' + encodeURIComponent(visitorId) : '';
      res = await fetch('/api/disclosure/resolve-queue' + qs);
    } catch {
      // 网络层不可达：说清是"连不上后端"，不是"这页坏了"
      if (silent) return;
      setErr('无法连接后端服务（/api）。请确认后端已启动（默认 127.0.0.1:8787）后重试。');
      setData(null);
      setLoading(false);
      return;
    }
    if (!res.ok) {
      if (silent) return;
      let msg = 'HTTP ' + res.status;
      try {
        const j = await res.json();
        if (j && typeof j.error === 'string') msg = j.error;
      } catch { /* 非 JSON 错误体，保留 HTTP 状态文案 */ }
      setErr('取不到揭晓队列：' + msg);
      setData(null);
      setLoading(false);
      return;
    }
    try {
      setData((await res.json()) as QueueJson);
    } catch (e) {
      if (silent) return;
      setErr('揭晓队列读不出来：' + (e instanceof Error ? e.message : String(e)));
      setData(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { if (vidReady) void load(vid); }, [vidReady, vid, load]);

  const doResolve = useCallback(async (row: OpenRow, v: Verdict, n?: string) => {
    setBusy(row.id);
    try {
      await resolvePrediction(row.id, v, n);
      // ★回声：答完即从"待办"里消失。落定后这道题不再属于任何「到期未解」的桶，
      //   所以三个数组与两组三桶计数要**一致地**摘掉它 —— 只摘 need_human 那一行的话，
      //   切到别的桶时它还赖在列表里，而它其实已经是 revealed 了。
      //   偏差线不在本页长——它在观测台的标本带上，本页只负责"回答"，不负责"展示回答的结果"。
      setData((d) => (d ? dropResolved(d, row) : d));
      say('ok', '已落定：' + clip(row.statement, 40) + (v === 'ambiguous' ? '（记为判定存疑）' : ''));
      // 静默重取：把 ① 那段与「已揭晓的归属拆解」一起对齐到刚落定之后的样子。
      //   放在回声之后 ⇒ 用户先看到自己那行消失，不必等这一跳。
      void load(vid, true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // ★2026-08-28 T1（M7）：原 409 提示是**死胡同**——它让用户去开一条
        //   不存在的修正记录路径（实测后端 grep amend 零命中，无任何修正接口）。
        //   教用户走一条不存在的路，比不说更糟。改为如实说明：不可改是不可变的
        //   前提（这正是账本可信的原因），且目前无修正入口（真做须另立项）。
        say('warn', '这条已落定过了 —— 账本不可改，这正是它可信的原因。目前没有修正入口（需另立项）。');
        void load(vid);
      } else {
        say('err', '落定失败：' + (e instanceof Error ? e.message : String(e)));
      }
    } finally {
      setBusy(null);
      setNoteFor(null);
      setNote('');
    }
  }, [load, say, vid]);

  // ── ① 的切片合计：只对"有给数且结果二值"的行算数，其余如实排除 ──
  const auto = useMemo(() => (data?.auto_revealed || []), [data]);
  const autoStats = useMemo(() => {
    const losses = auto.map(lossOf).filter((x): x is number => x !== null);
    const scored = auto.filter((r) => lossOf(r) !== null);
    const hits = scored.filter((r) => truthOf(r.outcome) === 1).length;
    return {
      listed: auto.length,
      scored: scored.length,
      hits,
      mean: losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : null,
      thin: losses.length < 30,
    };
  }, [auto]);

  /* ── 归属三桶：把三个数组按当前这一桶筛一遍。
   *   逐行的 view_bucket 由端点标好（与"能不能自动揭晓"正交），页面不自己猜归属。
   *   「别人的题」这一桶**不列行**：归属决定谁有权动这一行，
   *   把别人的题连同三个写键端过来，等于替他作主。 ── */
  const openBuckets = data?.open_buckets || null;
  const inView = <T extends { view_bucket: OwnerBucket }>(a: T[] | undefined) =>
    (a || []).filter((r) => r.view_bucket === bucket);
  const human = inView(data?.need_human);
  const stuck = inView(data?.stuck);
  const pendingAuto = inView(data?.ok).length;

  /** 分得开「我的题」吗？标识没换到、或服务端不认这枚，都算分不开——
   *  这两种情况下「我的题」显示 0，但那个 0 的意思是"不知道"，不是"没有"。 */
  const split = Boolean(vid) && data?.viewer?.known !== false;
  const knownLabel = (b: OwnerBucket) => (openBuckets ? openBuckets[b] : '—');

  return (
    <div className="resolve">
      <header className="page-head resolve-head">
        <h1>待落定</h1>
        <p className="page-sub">
          到期的题里<b>大部分不用你回答</b>——机器自己查得到真值，已经自动记上了。
          真正要你动手的只有第二类；剩下两类分别是「机器已经答完」和「谁也答不了」。
        </p>
      </header>

      {/* ══ 归属三桶：这道题归谁、谁有权答它 ══
          ★为什么放在「一屏数完」**上面**：下面那三个数是**这一桶**的数（②③ 随桶变），
            切换键若在它们下面，读者会先看见"33 条待确认"再看见"你的 0 条"，两个数打架。
          ★三桶的数**永远挂在键上**（切过去之前就看得见），语料库/别人的题不会因为
            当前不在这一桶就消失——「筛掉」和「没有」是两句不同的话，界面不许只说前一句。 */}
      {!loading && !err && data ? (
        <section className="resolve-buckets" data-testid="resolve-buckets">
          <div className="resolve-views" role="group" aria-label="题的归属">
            <button type="button" data-testid="resolve-view-mine"
              className={'resolve-view' + (bucket === 'mine' ? ' is-on' : '')}
              aria-pressed={bucket === 'mine'} onClick={() => setBucket('mine')}>
              我的题<span className="u-mono">（{knownLabel('mine')}）</span>
            </button>
            <button type="button" data-testid="resolve-view-corpus"
              className={'resolve-view' + (bucket === 'corpus' ? ' is-on' : '')}
              aria-pressed={bucket === 'corpus'} onClick={() => setBucket('corpus')}>
              语料库<span className="u-mono">（{knownLabel('corpus')}）</span>
            </button>
            <button type="button" data-testid="resolve-view-others"
              className={'resolve-view' + (bucket === 'others' ? ' is-on' : '')}
              aria-pressed={bucket === 'others'} onClick={() => setBucket('others')}>
              别人的题<span className="u-mono">（{knownLabel('others')}）</span>
            </button>
          </div>

          <p className="resolve-bucket-note" data-testid="resolve-bucket-note">
            {!split ? (
              <>
                <b>这一栏分不出「我的题」</b>：还没拿到能对上号的访客标识，所以「我的题」现在显示
                <b className="u-mono"> 0 </b>——那个 0 的意思是<b>「不知道你是谁」，不是「你没有题」</b>。
                语料库里还有 <b className="u-mono">{knownLabel('corpus')}</b> 条（无归属记录，一条都没删）。
              </>
            ) : bucket === 'mine' ? (
              <>
                这是<b>归属你的题</b>。语料库里另有 <b className="u-mono">{knownLabel('corpus')}</b> 条
                （批量灌入、没有归属记录的机器题，<b>一条都没删</b>，只是不在这儿列）——
                点上面「语料库」就切过去。
              </>
            ) : bucket === 'corpus' ? (
              <>
                这是<b>语料库</b>：批量灌入、没有归属记录的题，<b>一条都没删</b>。
                归属你的 <b className="u-mono">{knownLabel('mine')}</b> 条在「我的题」里。
                这里没写归属记录，所以这些题<b>谁都可以答</b>——它们不属于任何人。
              </>
            ) : (
              <>
                <b className="u-mono">{knownLabel('others')}</b> 条是<b>别的使用者的题</b>：
                这一栏<b>只报数</b>——不列行、不给键。归属决定谁有权动这一行；
                把别人的题连同写键端过来，等于替他作主。
              </>
            )}
            {' '}{bucketTail(openBuckets, data.auto_by_bucket || null, data.min_n)}
          </p>

          {/* 恒等式自校验：mine + corpus + others 必须 ≡ open_total。对不上就**说出来**，
              不悄悄改数——三桶的价值全在「和恒等于总数」这一句上，它破了必须被看见。 */}
          {openBuckets && openBuckets.mine + openBuckets.corpus + openBuckets.others !== openBuckets.total ? (
            <p className="resolve-bucket-warn" role="alert" data-testid="resolve-bucket-warn">
              ⚠ 三桶合计 {openBuckets.mine + openBuckets.corpus + openBuckets.others} 与端点给的
              {' '}{openBuckets.total} 对不上——这是端点的问题。先按它给的数看，别拿这三个数做算术。
            </p>
          ) : null}
        </section>
      ) : null}

      {/* ── 一屏数完：三类各多少条（每类一种颜色，下面三块同色系）
           ① 是账本最近结算的 40 条（**不分归属**，理由见那一段的说明）；
           ②③ 是**当前这一桶**的数。 ── */}
      <div className="resolve-counts" role="status">
        <div className="resolve-count is-auto">
          <b className="u-mono">{loading ? '—' : autoStats.listed}</b>
          <span>① 已自动揭晓（最近这些 · 不分归属）</span>
        </div>
        <div className="resolve-count is-human">
          <b className="u-mono">{loading ? '—' : human.length}</b>
          <span>② 待你确认 —— 只有这类是活</span>
        </div>
        <div className="resolve-count is-stuck">
          <b className="u-mono">{loading ? '—' : stuck.length}</b>
          <span>③ 永远结不了</span>
        </div>
      </div>

      {/* 端点给了数也给行、但这一桶里不该由人动手的那一类：说清它是什么 */}
      {!loading && pendingAuto > 0 ? (
        <p className="resolve-okline">
          这一桶里另有 <b className="u-mono">{pendingAuto}</b> 条到期未结的题，机器能自己查到真值（不是你的活）。
          它们此刻还没落定——揭晓通道跑过才会自动记上，所以这里既不列出来，也不给你键。
        </p>
      ) : null}

      {/* 拉取也要说明在等什么：「在读账本」是四页统一口径，勿改成笼统的"加载中" */}
      {loading ? <Wait state="pending" what="在读账本，分出哪几条该你答…" testId="resolve-wait" /> : null}
      {!loading && err ? (
        <Wait state="error" error={err} onRetry={() => { void load(vid); }} testId="resolve-wait" />
      ) : null}

      {/* ══ ① 已自动揭晓：折叠成一行。不追问——它已经答完了 ══ */}
      {!loading && !err && auto.length ? (
        <details className="resolve-block is-auto" data-testid="resolve-auto">
          <summary className="resolve-block-head">
            <span className="resolve-idx" aria-hidden="true">①</span>
            <span className="resolve-block-title">已自动揭晓</span>
            <span className="resolve-block-sub">
              最近 {autoStats.listed} 条
              {autoStats.scored > 0 ? (
                <> · 说中 {autoStats.hits} 条
                  {autoStats.mean !== null ? <> · 平均失分 {autoStats.mean.toFixed(3)}</> : null}
                </>
              ) : null}
              {' '}（n={autoStats.scored}
              {autoStats.thin ? '，不足 30，只作参考' : ''}；这是最近这些的切片，不是账本全体读数）
            </span>
            <span className="resolve-caret" aria-hidden="true">
              <span className="when-closed">展开</span>
              <span className="when-open">收起</span>
            </span>
          </summary>

          <p className="resolve-legend">
            失分＝(你当时给的数 − 实际)²，0 是满分、越大越偏；这是<b>单条的账</b>，不是结论。
            标黄的那几行失分超过 0.25——那是「永远答 50%」这条无用基线的分。
            没有给数、或结果不是「是／否」的题不进这个合计（如实排除，不拿 0 充数）。
            <br />
            <b>这一段不分归属</b>：它是账本最近结算的 40 条，谁的都可能在里面。
            上面那个归属切换只管下面两类（还没落定的待办）——结果不是谁的活。
          </p>

          <ul className="resolve-auto-list">
            {auto.map((r) => {
              const loss = lossOf(r);
              return (
                <li key={r.id} className="resolve-auto-row">
                  <span className="resolve-auto-date u-mono">{r.resolved_at ? r.resolved_at.slice(0, 10) : '—'}</span>
                  <span className="resolve-auto-stmt" title={r.statement}>{clip(r.statement, 64)}</span>
                  <span className="resolve-auto-verdict">
                    {typeof r.assigned_prob === 'number'
                      ? <>你给 {Math.round(r.assigned_prob * 100)}% → </>
                      : null}
                    {outcomeText(r.outcome)}
                  </span>
                  <span className={'resolve-auto-score u-mono' + (loss !== null && loss > 0.25 ? ' is-off' : '')}>
                    {loss === null ? '不计分' : '失分 ' + loss.toFixed(3)}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}

      {/* ══ ② 待你确认：唯一亮起来的一块。每条都写清"为什么没落定" ══ */}
      {!loading && !err && bucket !== 'others' ? (
        <section className="resolve-block is-human" data-testid="resolve-human">
          <div className="resolve-block-head is-static">
            <span className="resolve-idx" aria-hidden="true">②</span>
            <span className="resolve-block-title">待你确认</span>
            <span className="resolve-block-sub">
              机器拿不到真值，人能答。{BUCKET_NAME[bucket]}里
              {human.length ? human.length + ' 条' : '一条也没有'}
            </span>
          </div>

          {human.length === 0 ? (
            <p className="resolve-clear-sub" data-testid="resolve-human-empty">
              {bucket === 'mine' ? (
                <>
                  <b>没有归属你的、等你回答的题。</b>
                  {knownLabel('corpus') !== '—' && Number(knownLabel('corpus')) > 0 ? (
                    <>
                      语料库里还有 <b className="u-mono">{knownLabel('corpus')}</b> 条到期未结的
                      （一条都没删，只是没写归属记录）——点上面「语料库」就能看到那些。
                    </>
                  ) : (
                    <>语料库里也没有到期未结的题。</>
                  )}
                </>
              ) : (
                <>语料库里没有等你回答的题（无归属记录的题要么已经自动揭晓，要么属于第三类）。</>
              )}
            </p>
          ) : (
            <ul className="resolve-list">
              {human.map((r) => {
                const over = r.matures_at ? r.matures_at.slice(0, 10) < today() : false;
                const kl = r.kind ? kindLabel(r.kind) : null;
                // kind 存在但还没有中文名的（kindLabel 会回退成「原标识（未译）」）：
                // 这时**不编一句"去哪里查"**——查不到就是查不到，如实只印原标识 + 未译标记。
                const known = r.kind ? !hasBareKindLabel(r.kind) : false;
                return (
                  <li key={r.id} className={'resolve-item' + (over ? ' is-overdue' : '')}>
                    <div className="resolve-item-main">
                      <div className="resolve-item-stmt">{r.statement}</div>
                      {/* ★验收：每条都必须有"为什么"。没有原因的追问就是逼人猜。 */}
                      <p className="resolve-why">
                        <span className="resolve-why-tag">为什么没落定</span>
                        {r.why}
                        {kl && known ? <span className="resolve-why-src">（真值要看{kl.source}）</span> : null}
                      </p>
                      <div className="resolve-item-meta">
                        <span className="resolve-tag">{r.layer || '未分层'}</span>
                        {kl ? <span className="resolve-tag">{known ? kl.label : r.kind + '（未译）'}</span> : null}
                        {r.unregistered ? <span className="resolve-tag is-warn">真值锚未登记</span> : null}
                        <span className={'resolve-due' + (over ? ' is-overdue' : '')}>
                          {over ? '已过期 ' : '到期 '}
                          {r.matures_at ? r.matures_at.slice(0, 10) : '未定'}
                        </span>
                        {typeof r.assigned_prob === 'number' ? (
                          <span className="resolve-due">你给 {Math.round(r.assigned_prob * 100)}%</span>
                        ) : (
                          <span className="resolve-due">当时没给数</span>
                        )}
                      </div>
                    </div>
                    <div className="resolve-actions">
                      <button
                        type="button" className="btn btn-yes" disabled={busy === r.id}
                        onClick={() => void doResolve(r, 'true')}
                      >真发生了</button>
                      <button
                        type="button" className="btn btn-no" disabled={busy === r.id}
                        onClick={() => void doResolve(r, 'false')}
                      >没发生</button>
                      <button
                        type="button" className="btn btn-amb" disabled={busy === r.id}
                        onClick={() => { setNoteFor(r); setNote(''); }}
                      >判定不清</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {/* ══ ③ 永远结不了：说清原因，一个可点的东西都不给 ══ */}
      {!loading && !err && stuck.length ? (
        <section className="resolve-block is-stuck" data-testid="resolve-stuck">
          <div className="resolve-block-head is-static">
            <span className="resolve-idx" aria-hidden="true">③</span>
            <span className="resolve-block-title">永远结不了</span>
            <span className="resolve-block-sub">
              {BUCKET_NAME[bucket]}里 {stuck.length} 条 · 取数通道永久不可用或真值窗口已过
            </span>
          </div>

          <p className="resolve-nobtn-note">
            这里<b>没有键</b>：这类题拿不到真值，按下去也不会有反应——
            给一个点不动的按钮比不给更糟，它会让人以为是页面坏了。
          </p>

          <ul className="resolve-stuck-list">
            {stuck.map((r) => {
              const kl = r.kind ? kindLabel(r.kind) : null;
              const known = r.kind ? !hasBareKindLabel(r.kind) : false;
              return (
                <li key={r.id} className="resolve-stuck-item">
                  <span className="resolve-stuck-stmt" title={r.statement}>{r.statement}</span>
                  <span className="resolve-stuck-why">
                    <span className="resolve-stuck-mark" aria-hidden="true">×</span>
                    {r.why}
                    {kl && known ? <>（{kl.source}）</> : null}
                  </span>
                  <span className="resolve-stuck-date u-mono">
                    到期 {r.matures_at ? r.matures_at.slice(0, 10) : '未定'}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* ── 判定不清强制附注：歧义是判定标准的问题，不许硬判 ── */}
      {noteFor ? (
        <div className="modal-backdrop" onClick={() => setNoteFor(null)}>
          <div
            className="modal"
            role="dialog" aria-modal="true" aria-label="判定存疑需说明"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="modal-title">这条判定不清</h2>
            <p className="modal-sub">
              说明卡在哪：答案有两种合理读法，还是判据本身没定死？
              <b>写下原因，它会进负结果账本</b>——判据不清本身就是一条负结果。
            </p>
            <textarea
              className="modal-text" value={note} rows={4} autoFocus
              placeholder="例：阈值说的是'收盘价'，但当天停牌，无收盘价可查"
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setNoteFor(null)}>算了</button>
              <button
                type="button" className="btn btn-primary" disabled={!note.trim()}
                onClick={() => void doResolve(noteFor, 'ambiguous', note.trim())}
              >记为判定存疑</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── 回声：落定结果的即时反馈 ── */}
      <div className="resolve-toasts" role="log" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={'resolve-toast is-' + t.tone}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}

function today(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 10);
}

export { ResolvePage };

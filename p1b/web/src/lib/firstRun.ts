/**
 * firstRun —— 首访一分钟的**全部判定**（SPEC-first-run-ux）
 *
 * 【为什么整块抽成纯函数 .ts】
 *   本项目禁新依赖 ⇒ 没有 jsdom / Testing Library，组件级渲染测不了（NotePage 头注
 *   lib/noteProb 那段已把这条纪律写死）。而本模块最该被单测的恰好是判定与文案：
 *   「0 题时这一屏该说什么」「n=1 时回声里不许出现倾向性结论」。
 *   ⇒ 判定进纯函数（可被 node --test 直接 import 执行），.tsx 只负责画。
 *
 * 【★核心原则：引导「只指路，不判断」】
 *   HomePage.tsx:67-73 写死了「欠账是事实，推荐是观点」。**那句话对「推荐」成立，
 *   对「指路」不成立**——原作者把两件事混成了一件。于是本文件的分界是：
 *     · 可以说：这一页怎么用（题面写在哪、答案去哪查、点哪个键）
 *     · 不能说：你擅长什么／你应该先看哪一页／这类题历史频率多少
 *   拼写上把这条做成可机检：GUIDE_STEPS 全表过一遍 FORBID_WORDS 必须零命中
 *   （firstRun.test.mjs ①）。这样「以后有人加一句推荐」是红的，不是评审时才发现的。
 *
 * 【n<30 纪律（项目门槛）】
 *   分母不足时**只记条数、不给任何比例**：MIN_TRUST_N=30 与后端
 *   ownershipStore.MIN_N / disclosure 的 min_n 同口径。陌生人到 n=30 要几个月，
 *   所以**首次回声必须自己说明「1 道题什么都不说明」**——否则这是个会骗人的产品。
 *
 * 【归属三桶的来源】
 *   counts 直接读 GET /api/analytics/questions 的 viewSummary（端点构造保证
 *   mine+corpus+others ≡ total），本文件**不另数一遍**。三桶互斥完备，
 *   「别人的题」只报数、不列行（服务端已整行脱敏，见 src/routes/disclosure.js）。
 */

/* ══════════════ ① 引导：4 步，只指路 ══════════════ */

export interface GuideStep {
  /** 第几步（1 起）；4 步对应入口页那三张动作卡 ＋ 概览本身 */
  n: number;
  /** 这一步在哪一页（引导只是把那三张卡逐个点亮，不新增导航结构） */
  path: string;
  title: string;
  /** 「这一页怎么用」。★不许出现任何倾向、任何推荐、任何读数。 */
  how: string;
}

export const GUIDE_STEPS: GuideStep[] = [
  {
    n: 1, path: '/', title: '概览',
    how: '这一页报的是账本里到期还没落定的题数，以及那些数分别是谁的。它只报事实，不替你挑题。',
  },
  {
    n: 2, path: '/note', title: '记一笔',
    how: '① 上面写你要问什么 ② 中间选答案去哪里查 ③ 下面填你有多确信 ④ 点「记下」。',
  },
  {
    n: 3, path: '/resolve', title: '待落定',
    how: '到期的题在这里回答「真发生了／没发生／判定不清」。答了才算落定——只看不动手，账本里什么都没变。',
  },
  {
    n: 4, path: '/where-off', title: '我在哪儿偏了',
    how: '一道题一根线：向上＝当初说大了，向下＝说小了。样本不足 30 的格只记方向，不下结论。',
  },
];

/** `×` 关掉即永不再出现的本机标记（与 lib/visitor 的存储纪律同款：写不进去就当没关） */
export const GUIDE_OFF_KEY = 'p1b_firstrun_guide_off';

function readOff(k: string): string | undefined {
  try { const v = localStorage.getItem(k); return v ? v : undefined; } catch (e) { return undefined; }
}

/** 引导已被永久关掉？（关掉的语义是"本机从此不再出现"） */
export function readGuideOff(): boolean {
  return readOff(GUIDE_OFF_KEY) === '1';
}

/** 关掉引导。★写不进去（隐私模式）不抛错——关不掉只是继续显示，不是故障。 */
export function writeGuideOff(): void {
  try { localStorage.setItem(GUIDE_OFF_KEY, '1'); } catch (e) { /* 取不到就取不到 */ }
}

/** 当前路由对应第几步；不在四步之内（比如 /live、/question/:id、空路径）⇒ null（不高亮，也不编一步） */
export function guideStepFor(pathname: string): GuideStep | null {
  const p = String(pathname || '').replace(/[?#].*$/, '');
  for (const s of GUIDE_STEPS) if (p === s.path) return s;
  return null;
}

/** 步进一格并回绕（`→` / `←` 键用；回绕让四步成一个环，不会在末尾卡住） */
export function stepShift(i: number, by: number, len = GUIDE_STEPS.length): number {
  const n = len > 0 ? len : 1;
  return ((i + by) % n + n) % n;
}

/* ══════════════ ② 归属常驻条：说清账本里的数据是谁的 ══════════════ */

export const MIN_TRUST_N = 30;
/** 首次回声的「再来比」门槛：连 5 道都不到时根本无从比起（文案见 discipline） */
export const FIRST_COMPARE_N = 5;

export interface OwnCounts { mine: number; corpus: number; others: number; total: number }

/** n<30 时的限定语；够门槛就返回空串（不是"通过"，只是这一句不必说） */
export function thinTail(n: number, minN = MIN_TRUST_N): string {
  return n < minN
    ? '一共才 ' + n + ' 条（不足 ' + minN + '），所以只记条数、不给任何比例。'
    : '';
}

/**
 * 归属条正文。★只说「这些是谁的」，不说「你应该关心哪些」——
 * 后者是观点，而观点会替还没测够的东西说成能读了。
 */
export function ownershipLine(c: OwnCounts, minN = MIN_TRUST_N): string {
  return '账本里一共 ' + c.total + ' 道题：你的 ' + c.mine + ' 条、语料库 ' + c.corpus
    + ' 条（批量灌入、没有归属记录，一条都没删）、别的使用者的 ' + c.others
    + ' 条（只报数，不列行）。' + thinTail(c.total, minN);
}

/* ══════════════ ③ 首页个人态：陌生人看到的是他自己的数 ══════════════ */

export type PersonalState =
  | { kind: 'loading' }                                    // 还在问「你是谁 / 你有没有题」
  | { kind: 'unknown' }                                    // 分不开归属：不是「你没有题」
  | { kind: 'empty' }                                      // 你的题：0 条
  | { kind: 'personal'; mine: number; resolved: number | null };

/**
 * 判定个人态。★三态必须分得开（与 WhereOffPage / ResolvePage 的 fail-closed 同一纪律）：
 *   分不开归属时那个 0 的意思是「不知道你是谁」，**不是**「你没有题」。
 * @param status 取数状态（页面自己知道：还没问 / 问回来了 / 问失败）
 */
export function personalState(
  status: 'loading' | 'ready' | 'failed',
  vid: string | null,
  counts: OwnCounts | null,
  resolved: number | null,
): PersonalState {
  if (status !== 'ready') return { kind: 'loading' };
  if (!vid || !counts) return { kind: 'unknown' };
  if (counts.mine <= 0) return { kind: 'empty' };
  return { kind: 'personal', mine: counts.mine, resolved: resolved };
}

/** 空态下这一屏的开场句。★里面不许出现账本的任何数字——
 *  陌生人第一屏的主角是「你还没有题」，不是「账本里有 294 条」（那些不是他的）。 */
export const EMPTY_LEAD =
  '账本里那些题没有一条是你记的——它们是别人或机器灌进去的。写下一道你自己的，它就会出现在你的位置上。';

/** 个人态的一句话。空态逐字对上 spec 的「你还没有记过任何一道题」。 */
export function homeHeadline(s: PersonalState): string {
  if (s.kind === 'loading') return '';
  if (s.kind === 'unknown') return '还没认出你是谁——这一屏分不出「你的题」和账本里别人的题。';
  if (s.kind === 'empty') return '你还没有记过任何一道题。';
  return '你名下有 ' + s.mine + ' 道题'
    + (s.resolved === null ? '' : '，其中 ' + s.resolved + ' 道已落定') + '。';
}

/** 首页那两个**账本主角大数**（欠账数 / 够样本的格数）在个人态下该不该露头。
 *
 * ★为什么空态要压下去：那是**语料库**的数，一个字都不属于他。
 *   首页大字给一个陌生人的不是他的数 ⇒ 正是本模块要消灭的那件事。
 *   数据一条没少：条数由**归属常驻条**常驻报出（那是"这些是谁的"那一行的本职），
 *   逐行清单在「我在哪儿偏了」的语料库视图里（一条没删）。
 *
 * ★为什么 loading 仍然露头：那一刻我们**还不知道**他有没有题（账本那两个数此时也是
 *   '—' 占位）。先压后放会让整页在取数回来时**重排一次**（CLS），
 *   而"他有没有题"落定的那一刻，块消失才是那一处该发生的消失。 */
export function showLedgerHero(s: PersonalState): boolean {
  return s.kind !== 'empty';
}

/* ══════════════ ④ 三个回声（现在一个都没有）══════════════ */

/** R1 · 记下第一道题（NotePage 回执）。
 *  @param n 你名下现在的题数；**取不到就返回 null**——数不出来时不许说「第 1 道」。 */
export function firstNoteEcho(n: number | null, maturesAt: string | null): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1) return null;
  const d = maturesAt ? String(maturesAt).slice(0, 10) : null;
  return '这是你的第 ' + n + ' 道题。'
    + (d ? d + ' 回来回答一次，它才算落定。' : '到期后回来回答一次，它才算落定。');
}

/** R2 · 第一次落定（ResolvePage 回声）。
 *  失分 =(你说的数 − 实际)²，0 是满分；「永远答 50%」这条无用基线是 0.25。 */
export function settleEcho(o: { ordinal: number | null; prob: number | null; truth: 1 | 0 }): { text: string; loss: number | null } {
  const has = typeof o.prob === 'number' && Number.isFinite(o.prob);
  const loss = has ? Math.pow((o.prob as number) - o.truth, 2) : null;
  const 第几 = (typeof o.ordinal === 'number' && o.ordinal >= 1)
    ? '这是你的第 ' + o.ordinal + ' 道落定的题 —— '
    : '这是你落定的一道题 —— ';
  const 分 = loss === null
    ? '这道题当时没给数，不计失分。'
    : '失分 ' + loss.toFixed(3) + '（永远答 50% 是 0.25）。';
  return { text: '已落定。' + 第几 + 分 + '去「我在哪儿偏了」看它。', loss };
}

export interface DevRow {
  id: number;
  assigned_prob: number | null;
  outcome: string | null;
  resolved_at?: string | null;
}
export interface DevEcho { id: number; n: number; delta: number; p: number; text: string }

/** outcome → 0/1；判定存疑（ambiguous）不参与判分，如实返回 null（不拿 0 充数） */
function truthOf(outcome: string | null | undefined): 1 | 0 | null {
  if (outcome === 'true') return 1;
  if (outcome === 'false') return 0;
  return null;
}

/**
 * 纪律句：n 太小的时候不许给出任何倾向性结论。
 * ★这一句**始终**在（n≥门槛也有一句，只是换了内容）——
 *   陌生人到 n=30 要几个月，首次回声若不说明这一点，就是在骗人。
 */
export function discipline(n: number, minN = MIN_TRUST_N): string {
  if (n < FIRST_COMPARE_N) return n + ' 道题不构成结论——记满 ' + FIRST_COMPARE_N + ' 道再来比。';
  if (n < minN) return n + ' 道题仍然不构成结论——本项目的门槛是 ' + minN + ' 道，这里只记条数、不给比例。';
  return n + ' 道过了 ' + minN + ' 道这条线，但偏差按领域分格读，不按人读。';
}

/**
 * R3 · 第一次有自己的偏差（WhereOffPage 顶部）。
 *
 * ★只报**这一道题**的事实（你给多少、实际多少、差多少），不给关于「你这个人」的结论。
 * @param rows 「我的题」视图里的行（上限 50，按 id 倒序 ⇒ 最近落定的那道必在其中）
 * @param resolvedTotal 账本全体口径下「我名下已落定」的条数（端点 auto_revealed.mine）
 */
export function deviationEcho(
  rows: DevRow[],
  opt: { minN?: number; resolvedTotal?: number } = {},
): DevEcho | null {
  const minN = opt.minN === undefined ? MIN_TRUST_N : opt.minN;
  const scored = (rows || []).filter((r) => truthOf(r.outcome) !== null
    && typeof r.assigned_prob === 'number' && Number.isFinite(r.assigned_prob));
  if (!scored.length) return null;
  // 最近落定的那一道：resolved_at 缺失的排后，同日按 id 大者（后写的）算新
  const pick = scored.slice().sort((a, b) => {
    const t = String(b.resolved_at || '').localeCompare(String(a.resolved_at || ''));
    return t !== 0 ? t : b.id - a.id;
  })[0];
  const y = truthOf(pick.outcome) as 1 | 0;
  const p = pick.assigned_prob as number;
  const delta = p - y;
  const dir = delta > 0.005 ? '说大了' : delta < -0.005 ? '说小了' : '说得很准';
  const n = (typeof opt.resolvedTotal === 'number' && opt.resolvedTotal >= scored.length)
    ? opt.resolvedTotal : scored.length;
  const 它 = n === 1 ? '它' : '最近落定的那一道';
  return {
    id: pick.id, n, delta, p,
    text: '你有 ' + n + ' 道已落定的题。' + 它 + dir + ' ' + Math.abs(delta).toFixed(2)
      + '（你给 ' + Math.round(p * 100) + '%，实际 ' + Math.round(y * 100) + '%）。'
      + discipline(n, minN),
  };
}

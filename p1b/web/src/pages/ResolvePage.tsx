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
 *   也不给一个假的出口——页面里因此只有一处静态标记，没有任何 <button>。
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
import '../styles/resolve.css';

type Verdict = 'true' | 'false' | 'ambiguous';

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

/** 到期未解的一行（端点 need_human / stuck 的投影） */
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
}

interface QueueJson {
  mode: string;
  today: string;
  counts: {
    auto_revealed: number;
    need_human: number;
    stuck: number;
    /** 机器能自动查真值、但此刻还没落定的条数（端点给数不给行） */
    ok?: number;
  };
  auto_revealed: AutoRow[];
  need_human: OpenRow[];
  stuck: OpenRow[];
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

export default function ResolvePage() {
  const [data, setData] = useState<QueueJson | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [noteFor, setNoteFor] = useState<OpenRow | null>(null);
  const [note, setNote] = useState('');

  const say = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => t.concat([{ id, tone, text }]));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    let res: Response;
    try {
      res = await fetch('/api/disclosure/resolve-queue');
    } catch {
      // 网络层不可达：说清是"连不上后端"，不是"这页坏了"
      setErr('无法连接后端服务（/api）。请确认后端已启动（默认 127.0.0.1:8787）后重试。');
      setData(null);
      setLoading(false);
      return;
    }
    if (!res.ok) {
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
      setErr('揭晓队列读不出来：' + (e instanceof Error ? e.message : String(e)));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const doResolve = useCallback(async (row: OpenRow, v: Verdict, n?: string) => {
    setBusy(row.id);
    try {
      await resolvePrediction(row.id, v, n);
      // ★回声：答完即从"待你确认"里消失。偏差线不在本页长——它在观测台的标本带上，
      //   本页只负责"回答"，不负责"展示回答的结果"。这是刻意的分工。
      setData((d) => (d
        ? {
            ...d,
            need_human: d.need_human.filter((x) => x.id !== row.id),
            counts: { ...d.counts, need_human: Math.max(0, d.counts.need_human - 1) },
          }
        : d));
      say('ok', '已落定：' + clip(row.statement, 40) + (v === 'ambiguous' ? '（记为判定存疑）' : ''));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // ★2026-08-28 T1（M7）：原 409 提示是**死胡同**——它让用户去开一条
        //   不存在的修正记录路径（实测后端 grep amend 零命中，无任何修正接口）。
        //   教用户走一条不存在的路，比不说更糟。改为如实说明：不可改是不可变的
        //   前提（这正是账本可信的原因），且目前无修正入口（真做须另立项）。
        say('warn', '这条已落定过了 —— 账本不可改，这正是它可信的原因。目前没有修正入口（需另立项）。');
        void load();
      } else {
        say('err', '落定失败：' + (e instanceof Error ? e.message : String(e)));
      }
    } finally {
      setBusy(null);
      setNoteFor(null);
      setNote('');
    }
  }, [load, say]);

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

  const human = data?.need_human || [];
  const stuck = data?.stuck || [];
  const pendingAuto = data?.counts.ok || 0;

  return (
    <div className="resolve">
      <header className="page-head resolve-head">
        <h1>待落定</h1>
        <p className="page-sub">
          到期的题里<b>大部分不用你回答</b>——机器自己查得到真值，已经自动记上了。
          真正要你动手的只有第二类；剩下两类分别是「机器已经答完」和「谁也答不了」。
        </p>
      </header>

      {/* ── 一屏数完：三类各多少条（每类一种颜色，下面三块同色系） ── */}
      <div className="resolve-counts" role="status">
        <div className="resolve-count is-auto">
          <b className="u-mono">{loading ? '—' : autoStats.listed}</b>
          <span>① 已自动揭晓（最近这些）</span>
        </div>
        <div className="resolve-count is-human">
          <b className="u-mono">{loading ? '—' : (data?.counts.need_human ?? 0)}</b>
          <span>② 待你确认 —— 只有这类是活</span>
        </div>
        <div className="resolve-count is-stuck">
          <b className="u-mono">{loading ? '—' : (data?.counts.stuck ?? 0)}</b>
          <span>③ 永远结不了</span>
        </div>
      </div>

      {/* 端点给了数没给行的那一类：如实说清它是什么，以及为什么它不在这三块里 */}
      {!loading && pendingAuto > 0 ? (
        <p className="resolve-okline">
          另有 <b className="u-mono">{pendingAuto}</b> 条到期未结的题，机器能自己查到真值（不是你的活）。
          它们此刻还没落定——揭晓通道跑过才会自动记上，所以这里既不列出来，也不给你键。
        </p>
      ) : null}

      {/* 拉取也要说明在等什么：「在读账本」是四页统一口径，勿改成笼统的"加载中" */}
      {loading ? <Wait state="pending" what="在读账本，分出哪几条该你答…" testId="resolve-wait" /> : null}
      {!loading && err ? (
        <Wait state="error" error={err} onRetry={() => { void load(); }} testId="resolve-wait" />
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
      {!loading && !err ? (
        <section className="resolve-block is-human" data-testid="resolve-human">
          <div className="resolve-block-head is-static">
            <span className="resolve-idx" aria-hidden="true">②</span>
            <span className="resolve-block-title">待你确认</span>
            <span className="resolve-block-sub">
              机器拿不到真值，人能答。{human.length ? human.length + ' 条' : '没有欠账'}
            </span>
          </div>

          {human.length === 0 ? (
            <p className="resolve-clear-sub">
              没有等你回答的题。到期的题要么已经自动揭晓，要么属于第三类。
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
              {stuck.length} 条 · 取数通道永久不可用或真值窗口已过
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

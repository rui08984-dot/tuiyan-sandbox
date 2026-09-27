/** ResolvePage —— 待落定（2026-08-27 八轮第五改 · **本产品题线上的第二个动作**）
 *
 * 【它替代了什么】
 *   旧 `/calendar`（待验证日历）是一张只读柱状图：它只讲"哪天有多少条到期"，
 *   读完了**账本里一个字节都没变**。单用户产品里，不能改变任何东西的页面不是产品，
 *   是 README —— 这正是「像个后端维护的东西」的来源。
 *   后端 `GET /api/predictions/unresolved` 与 `POST /api/predictions/:id/resolve`
 *   早就有（带 409 不可变守卫、ambiguous 强制附注），前端一次没调过。
 *   本页把它们接上 ⇒ 这张页面第一次**能改变账本**。
 *
 * 【形态为什么是「清单」而不是「图」】
 *   用户早上要做的不是"看分布"，是**回答 0~3 个问题**。
 *   柱状图答不了"哪 3 条永远结不掉"，清单能——每条右侧直接挂"为什么还没落定"，
 *   底下挂两个键。所以：一条一行，一行一句话。
 *
 * 【三条纪律】
 *   ① 落定＝**不可变**：已落定的 409 拒绝，前端把这条铁律显式呈现为"此条已落定"，
 *      而不是静默失败或给个"改一下"的假选项。
 *   ② ambiguous **强制附注**：不许硬判。歧义是判定标准的问题，不是人的问题。
 *   ③ **弃权是一条正当出路**：答不出就弃权，不许猜。弃权会进负结果账本
 *      （那才是"负结果"该有的来源——不是别人的实验失败，是自己的问法失败）。
 *
 * 【不做的事】
 *   · 不给"建议先落哪一条"——方向兵的判断：推荐是观点，观点会替还没测够的东西说成能读了。
 *   · 不把 n<30 的格算作"可以判读"：本页只回答"到没到该落定的时候"。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, listUnresolved, resolvePrediction, type UnresolvedRow } from '../api';
import '../styles/resolve.css';

type Verdict = 'true' | 'false' | 'ambiguous';

interface Toast { id: number; tone: 'ok' | 'warn' | 'err'; text: string; }

export default function ResolvePage() {
  const [rows, setRows] = useState<UnresolvedRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [noteFor, setNoteFor] = useState<UnresolvedRow | null>(null);
  const [note, setNote] = useState('');

  const say = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => t.concat([{ id, tone, text }]));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listUnresolved({ limit: 60 });
      setRows(r.items || []);
    } catch (e) {
      say('err', '取不到待落定清单：' + (e instanceof Error ? e.message : String(e)));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [say]);

  useEffect(() => { void load(); }, [load]);

  const doResolve = useCallback(async (row: UnresolvedRow, v: Verdict, n?: string) => {
    setBusy(row.id);
    try {
      await resolvePrediction(row.id, v, n);
      // ★回声：落定即从队列消失。偏差线不在本页长——它在观测台的标本带上，
      //   本页只负责"回答"，不负责"展示回答的结果"。这是刻意的分工。
      setRows((rs) => (rs || []).filter((x) => x.id !== row.id));
      say('ok', '已落定：' + row.statement.slice(0, 40) + (v === 'ambiguous' ? '（记为判定存疑）' : ''));
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

  const counts = useMemo(() => {
    const rs = rows || [];
    return {
      total: rs.length,
      overdue: rs.filter((r) => r.matures_at && r.matures_at.slice(0, 10) < today()).length,
      today: rs.filter((r) => r.matures_at && r.matures_at.slice(0, 10) === today()).length,
    };
  }, [rows]);

  return (
    <div className="resolve">
      <header className="page-head resolve-head">
        <h1>待落定</h1>
        <p className="page-sub">
          到期的题在这里回答。<b>回答了才算数</b>——只看不动手的题，账本里什么都没变。
        </p>
      </header>

      {/* ── 一屏数完的三个数：还剩几条、其中几条已过期、今天该答几条 ── */}
      <div className="resolve-counts" role="status">
        <div className="resolve-count">
          <b className="u-mono">{loading ? '—' : counts.total}</b>
          <span>还剩几条没落定</span>
        </div>
        <div className="resolve-count is-overdue">
          <b className="u-mono">{loading ? '—' : counts.overdue}</b>
          <span>已经过期（越早答越准）</span>
        </div>
        <div className="resolve-count">
          <b className="u-mono">{loading ? '—' : counts.today}</b>
          <span>今天该答</span>
        </div>
      </div>

      {loading ? <p className="resolve-empty">在读账本…</p> : null}

      {!loading && (rows || []).length === 0 ? (
        <div className="resolve-clear">
          <p className="resolve-clear-big">今天没有欠账。</p>
          <p className="resolve-clear-sub">
            所有到期的题都已回答。<a href="#/intake">去记一笔新的</a>，
            或<a href="#/overview">看看自己在哪儿偏了</a>。
          </p>
        </div>
      ) : null}

      {/* ── 清单：一条一行，一行一句话 ── */}
      {!loading && (rows || []).length > 0 ? (
        <ul className="resolve-list" data-testid="resolve-list">
          {(rows || []).map((r) => {
            const over = r.matures_at && r.matures_at.slice(0, 10) < today();
            return (
              <li key={r.id} className={'resolve-item' + (over ? ' is-overdue' : '')}>
                <div className="resolve-item-main">
                  <div className="resolve-item-stmt">{r.statement}</div>
                  <div className="resolve-item-meta">
                    <span className="resolve-tag">{r.layer || '未分层'}</span>
                    <span className={'resolve-due' + (over ? ' is-overdue' : '')}>
                      {over ? '已过期 ' : '到期 '}
                      {r.matures_at ? r.matures_at.slice(0, 10) : '未定'}
                    </span>
                    {r.game_id != null ? <span className="resolve-tag">局 {r.game_id}</span> : null}
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
      ) : null}

      {/* ── ambiguous 强制附注：歧义是判定标准的问题，不许硬判 ── */}
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

      {/* ── 回声：落定结果的即时反馈（3 秒读完）── */}
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

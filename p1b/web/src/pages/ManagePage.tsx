/** ManagePage —— 管理区（B6）：历史局完整列表 + 开新局引导 + 局详情（座位/导出/天数/BOTC）。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../api';
import type { Game } from '../types';
import { SCRIPT_LABEL } from '../botc/roles';
import '../styles/p1b4.css';
import GameDetail from './manage/GameDetail';
import NewGameWizard from '../components/NewGameWizard';

const TYPE_LABEL: Record<Game['type'], string> = { werewolf: '狼人杀', botc: '血染钟楼', script: '剧本' };
const LS_SELECTED = 'p1b.games.selectedId';
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export default function ManagePage() {
  const navigate = useNavigate();
  const [games, setGames] = useState<Game[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef(0);
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const v = Number(localStorage.getItem(LS_SELECTED));
    return Number.isInteger(v) && v > 0 ? v : null;
  });
  const [wizardOpen, setWizardOpen] = useState(false);

  const flashToast = useCallback((t: string) => {
    setToast(t);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast((cur) => (cur === t ? null : cur)), 3200);
  }, []);

  const loadGames = useCallback(async () => {
    setLoadErr(null);
    try { setGames((await api.listGames()).games); } catch (e) { setLoadErr(errMsg(e)); }
  }, []);
  useEffect(() => { void loadGames(); }, [loadGames]);

  useEffect(() => {
    if (selectedId != null) localStorage.setItem(LS_SELECTED, String(selectedId));
  }, [selectedId]);

  async function handleCreated(game: Game) {
    setWizardOpen(false);
    await loadGames();
    setSelectedId(game.id);
    navigate('/'); // 引导完成 → 直接进入现场
    flashToast('✓ 局 #' + game.id + '「' + game.name + '」已创建，' + game.player_count + ' 席就位');
  }

  return (
    <section className="page">
      <header className="page-head">
        <span className="page-icon" aria-hidden>🗂️</span>
        <h1>对局管理</h1>
        <button type="button" className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setWizardOpen(true)}>
          ＋ 开新局
        </button>
      </header>
      <p className="page-sub">历史局完整列表（进行中 = 有事件）；点局卡片进详情：座位名单 / 导出 JSON / 天数推进 / BOTC 声称。</p>

      {toast && <div className="toast" role="status">{toast}</div>}
      {loadErr && (
        <div className="banner banner-error" role="alert">
          <p>{loadErr}</p>
          <button type="button" className="btn" onClick={() => void loadGames()}>重试</button>
        </div>
      )}
      {games && games.length === 0 && (
        <div className="callout"><p className="callout-title">还没有对局</p><p>点右上「＋ 开新局」三步引导：局名/类型/人数 → 席位名单 → 直达现场。</p></div>
      )}

      <ul className="game-list">
        {(games ?? []).map((g) => {
          const started = (g.event_count ?? 0) > 0;
          return (
            <li key={g.id} className={'game-item' + (g.id === selectedId ? ' is-selected' : '')}>
              <button type="button" className="game-item-main" onClick={() => setSelectedId(g.id)} aria-pressed={g.id === selectedId}>
                <span className="game-item-name" style={{ display: 'block' }}>{g.name}</span>
                <span className="game-badges">
                  {started
                    ? <span className="badge badge-accent">进行中 · 第{g.current_day ?? 0}天</span>
                    : <span className="badge badge-warn">未开局</span>}
                </span>
                <span className="game-item-meta" style={{ display: 'block' }}>
                  #{g.id} · {TYPE_LABEL[g.type]}{g.type === 'botc' && g.script ? '·' + SCRIPT_LABEL[g.script] : ''} · {g.player_count}人 · {g.event_count ?? 0} 事件
                </span>
              </button>
              <button type="button" className="btn" onClick={() => setSelectedId(g.id)}>详情</button>
            </li>
          );
        })}
      </ul>

      {selectedId != null && (
        <GameDetail gameId={selectedId} flashToast={flashToast} onGoLive={() => navigate('/')} />
      )}

      {wizardOpen && <NewGameWizard onClose={() => setWizardOpen(false)} onCreated={handleCreated} />}
    </section>
  );
}

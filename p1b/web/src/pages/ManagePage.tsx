/** ManagePage —— 管理区（B6）：历史局完整列表 + 开新局引导 + 局详情（座位/导出/天数/BOTC）。
 *
 * ── 2026-09-22 六轮重做 ──
 * 用户反馈「对局页排版不够规整、不够功能化」。
 * 实测根因：90 局平铺成一个无分组的长列表（页面高 3352px），
 *   进行中与未开局混在一起，且没有查找手段——找一局要滚很久。
 * 改法：
 *   ① 接入页面骨架（铭牌标题 + 左侧分类器），与其余数据页统一
 *   ② 侧栏分状态（进行中 / 未开局）与类型，带计数
 *   ③ 列表按状态**分区**（进行中在上：那是要继续用的；未开局在下）
 *   ④ 未开局默认只展开前 12 条（它们多为批量导入的历史，不必全铺）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../api';
import type { Game } from '../types';
import { SCRIPT_LABEL } from '../botc/roles';
import '../styles/p1b4.css';
import '../styles/shell.css';
import GameDetail from './manage/GameDetail';
import NewGameWizard from '../components/NewGameWizard';
import { useGameTypes } from '../lib/useGameTypes';
import { IconFolder, HelpMark } from '../components/ui';
import { PagePlate } from '../components/PagePlate';
import { PageSidebar } from '../components/PageSidebar';

const LS_SELECTED = 'p1b.games.selectedId';
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export default function ManagePage() {
  const navigate = useNavigate();
  const { label: typeLabel } = useGameTypes(); // 类型名后端驱动（失败回落内置三型）
  const [games, setGames] = useState<Game[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef(0);
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const v = Number(localStorage.getItem(LS_SELECTED));
    return Number.isInteger(v) && v > 0 ? v : null;
  });
  const [wizardOpen, setWizardOpen] = useState(false);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const [selSeq, setSelSeq] = useState(0);
  /* 侧栏筛选（六轮） */
  const [statusPick, setStatusPick] = useState<string[]>([]);
  const [typePick, setTypePick] = useState<string[]>([]);
  const [showAllIdle, setShowAllIdle] = useState(false);

  /** 点选局（G1 反馈#2 修复）：详情块渲染在长列表底部，此前点击零滚动=「点了没反应」；
   * 现选择后把详情滚入视口（首挂仅 LS 恢复选中时不滚，保留列表视图）。 */
  function pick(id: number) {
    setSelectedId(id);
    setSelSeq((n) => n + 1);
  }
  useEffect(() => {
    if (selSeq === 0) return;
    detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selSeq]);

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
    flashToast('局 #' + game.id + '「' + game.name + '」已创建，' + game.player_count + ' 席就位');
  }

  const all = games ?? [];
  /* 分组与筛选（六轮）：进行中＝有事件（要继续用），未开局＝空局 */
  const running = useMemo(() => all.filter((g) => (g.event_count ?? 0) > 0), [all]);
  const idle = useMemo(() => all.filter((g) => (g.event_count ?? 0) === 0), [all]);

  /* 玩法归类（六轮）：实测 48 个类型里有 43 个是 corpus:xxx 各占一局的语料导入局。
   * 按原值平铺会把侧栏变成机器清单（50 个选项），使用者反而找不到东西。
   * 归并成三个**有意义的类**——分类的依据是「这局是拿来做什么的」，不是类型字符串。 */
  const typeClass = (t: string): string => {
    if (t.indexOf('corpus:') === 0) return 'corpus';
    if (t.indexOf('werewolf') === 0) return 'werewolf';
    if (t === 'botc') return 'botc';
    return 'other';
  };
  const CLASS_LABEL: Record<string, string> = {
    werewolf: '狼人杀',
    botc: '血染钟楼',
    corpus: '语料导入',
    other: '其他',
  };
  const classIds = useMemo(
    () => Array.from(new Set(all.map((g) => typeClass(g.type))))
      .sort((a, b) => all.filter((g) => typeClass(g.type) === b).length - all.filter((g) => typeClass(g.type) === a).length),
    [all],
  );

  const filtered = useMemo(() => {
    let gs = all;
    if (statusPick.length) {
      gs = gs.filter((g) => {
        const st = (g.event_count ?? 0) > 0 ? 'running' : 'idle';
        return statusPick.indexOf(st) >= 0;
      });
    }
    if (typePick.length) gs = gs.filter((g) => typePick.indexOf(typeClass(g.type)) >= 0);
    return gs;
  }, [all, statusPick, typePick]);

  /* 分区渲染：进行中在前（那是要继续用的）；未开局默认只展 12 条 */
  const IDLE_PREVIEW = 12;
  const showRunning = filtered.filter((g) => (g.event_count ?? 0) > 0);
  const showIdleAll = filtered.filter((g) => (g.event_count ?? 0) === 0);
  const showIdle = showAllIdle ? showIdleAll : showIdleAll.slice(0, IDLE_PREVIEW);

  function renderItem(g: Game) {
    const started = (g.event_count ?? 0) > 0;
    return (
      <li key={g.id} className={'game-item' + (g.id === selectedId ? ' is-selected' : '')}>
        <button type="button" className="game-item-main" onClick={() => pick(g.id)} aria-pressed={g.id === selectedId}>
          <span className="game-item-name" title={g.name}>{g.name}</span>
          <span className="game-badges">
            {started
              ? <span className="badge badge-accent">进行中 · 第{g.current_day ?? 0}天</span>
              : <span className="badge badge-warn">未开局</span>}
          </span>
          <span className="game-item-meta">
            #{g.id} · {typeLabel(g.type)}{g.type === 'botc' && g.script ? ' · ' + SCRIPT_LABEL[g.script] : ''} · {g.player_count} 人 · {g.event_count ?? 0} 事件
          </span>
        </button>
        <button type="button" className="btn" onClick={() => pick(g.id)}>详情</button>
      </li>
    );
  }

  return (
    <section className="page">
      <PagePlate
        testId="manage-plate"
        icon={<IconFolder size={20} />}
        title="对局管理"
        tail="Games"
        subtitle={
          <>
            共 {all.length} 局。进行中＝有记录的局，可以继续录入；未开局＝已建好但还没开始。
            点任意一局查看席位名单、导出记录或推进天数。
          </>
        }
      />

      {toast && <div className="toast" role="status">{toast}</div>}
      {loadErr && (
        <div className="banner banner-error" role="alert">
          <p>{loadErr}</p>
          <button type="button" className="btn" onClick={() => void loadGames()}>重试</button>
        </div>
      )}
      {games && games.length === 0 && (
        <div className="callout" data-testid="manage-empty">
          <p className="callout-title">还没有对局</p>
          <p>开一局后就能在这里回看：席位名单、事件流、导出记录。</p>
          <button type="button" className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => setWizardOpen(true)}>
            ＋ 现在开一局
          </button>
        </div>
      )}

      {games && games.length > 0 ? (
        <div className="page-shell">
          <PageSidebar
            testId="manage-sidebar"
            title="筛选"
            onClear={() => { setStatusPick([]); setTypePick([]); }}
            groups={[
              {
                label: '状态',
                hint: '多选',
                options: [
                  { id: 'running', label: '进行中', count: running.length },
                  { id: 'idle', label: '未开局', count: idle.length },
                ],
                value: statusPick,
                onChange: setStatusPick,
              },
              {
                label: '玩法',
                hint: `${classIds.length} 类`,
                options: classIds.map((c) => ({
                  id: c,
                  label: CLASS_LABEL[c] ?? c,
                  count: all.filter((g) => typeClass(g.type) === c).length,
                })),
                value: typePick,
                onChange: setTypePick,
              },
            ]}
          />

          <div className="page-shell-main">
            {/* 进行中区：单独成块并置顶（它是要继续操作的） */}
            {showRunning.length > 0 ? (
              <section className="ui-section" data-testid="manage-running">
                <h2 className="ui-section-title">
                  进行中
                  <span className="mg-count">{showRunning.length} 局</span>
                  <HelpMark
                    testId="manage-running-help"
                    text="这些局已经有记录。点进详情可以继续录入、看席位名单，或推进到下一日。"
                  />
                </h2>
                <ul className="game-list">{showRunning.map(renderItem)}</ul>
              </section>
            ) : null}

            {/* 未开局区：数量多时默认收窄，避免把页面撑成一面墙 */}
            {showIdle.length > 0 ? (
              <section className="ui-section" data-testid="manage-idle">
                <h2 className="ui-section-title">
                  未开局
                  <span className="mg-count">{showIdleAll.length} 局</span>
                  <HelpMark
                    testId="manage-idle-help"
                    text="这些局已经建好但还没有记录。点进详情可以补座位名单，或直接去现场开始录入。"
                  />
                </h2>
                <ul className="game-list">{showIdle.map(renderItem)}</ul>
                {!showAllIdle && showIdleAll.length > IDLE_PREVIEW ? (
                  <button type="button" className="btn mg-more" onClick={() => setShowAllIdle(true)}>
                    展开其余 {showIdleAll.length - IDLE_PREVIEW} 局
                  </button>
                ) : null}
                {showAllIdle && showIdleAll.length > IDLE_PREVIEW ? (
                  <button type="button" className="btn mg-more" onClick={() => setShowAllIdle(false)}>
                    收起
                  </button>
                ) : null}
              </section>
            ) : null}

            {filtered.length === 0 ? (
              <div className="ui-empty">当前筛选下没有对局</div>
            ) : null}

            {selectedId != null && (
              <div ref={detailRef}>
                <GameDetail gameId={selectedId} flashToast={flashToast} onGoLive={() => navigate('/')} />
              </div>
            )}
          </div>
        </div>
      ) : null}

      {wizardOpen && <NewGameWizard onClose={() => setWizardOpen(false)} onCreated={handleCreated} />}
    </section>
  );
}

/** LivePage —— 现场主屏（B6 一页现场流）：选局条+参谋卡区+当日时间线+常驻输入条+确认卡模态。 */
import { useEffect, useState } from 'react';
import type { Game } from '../types';
import '../styles/input.css';
import '../styles/p1b4.css';
import TopBar from '../components/input/TopBar';
import InputBar from '../components/input/InputBar';
import MacroSheet from '../components/input/MacroSheet';
import ConfirmCard from '../components/input/ConfirmCard';
import Timeline from '../components/input/Timeline';
import EditSheet from '../components/input/EditSheet';
import NewGameWizard from '../components/NewGameWizard';
import AdvisorZone from './live/AdvisorZone';
import OracleZone from './live/OracleZone';
import LiveEmpty from './live/LiveEmpty';
import { useLiveGame } from './live/useLiveGame';
import { useConfirmFlow } from './live/useConfirmFlow';
import { useAdvise } from './live/useAdvise';

export default function LivePage() {
  const g = useLiveGame();
  const cf = useConfirmFlow({
    gameId: g.gameId, day: g.day, phase: g.phase,
    setBusy: g.setBusy, setPageErr: g.setPageErr,
    reloadAll: g.reloadAll, flashToast: g.flashToast,
  });
  const advise = useAdvise({
    onDone: (d) => g.flashToast('第 ' + d + ' 天参谋卡就绪，已存档'),
    onFailed: (m) => g.setPageErr(m),
  });
  const [wizardOpen, setWizardOpen] = useState(false);
  const gid = g.gameId;

  // 切局/进页：在跑任务按局认领 + 服务端参谋卡存档加载
  useEffect(() => {
    if (gid != null) void advise.adoptGame(gid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gid]);

  async function handleCreated(game: Game) {
    setWizardOpen(false);
    await g.loadGames();
    g.switchGame(game.id);
    g.flashToast('局 #' + game.id + '「' + game.name + '」已创建，' + game.player_count + ' 席就位');
  }

  function doSettle() {
    if (gid == null) return;
    g.setPageErr(null);
    advise.startAdvise(gid, g.day).catch((e) => g.setPageErr(e instanceof Error ? e.message : String(e)));
  }

  /* ══ 空态判定（2026-09-22 五轮修正）══
   * 原实现：`empty = games.length === 0`。
   * 缺陷：当库里有局、但 localStorage 里存的 gameId 已失效（或从未选过局）时，
   *   empty=false 而 gid=null ⇒ 页面只剩一条 TopBar，下方整片空白。
   *   实测截图确认了这个状态（有局可切却什么都不显示）。
   * 修正：把「没有任何可选局」与「有局但还没选」都视为需要引导的状态，
   *   后者给的是「选一局」而不是「开新局」——文案与动作都要对症。 */
  const noGames = g.games.length === 0;
  const noSelection = !noGames && gid === null;
  const showGuide = noGames || noSelection;

  return (
    <div className="input-page">
      <TopBar games={g.games} game={g.game} day={g.day} maxDay={g.game?.current_day ?? 1} roster={g.roster}
        busy={g.busy} onDay={g.setDay} onSwitch={g.switchGame}
        onSettle={gid != null ? doSettle : undefined} settling={advise.task != null}
        onWizard={() => setWizardOpen(true)} />
      {g.pageErr && <div className="banner banner-error"><p>{g.pageErr}</p></div>}
      {g.toast && <div className="toast">{g.toast}</div>}

      {/* 空态：没有任何对局时，或库里有局但尚未选中时 —— 都该给明确下一步，
       * 而不是留一片空白（那些控件在无局状态下没有作用对象）。 */}
      {showGuide && (
        <LiveEmpty
          onCreate={() => setWizardOpen(true)}
          existingGames={g.games}
          onPick={(id) => g.switchGame(id)}
          busy={g.busy}
        />
      )}

      {/* ══ 主体：两栏工作台（2026-09-22 六轮重做）══
       * 用户反馈首页「排版稀烂、不够功能化、像是在为狼人杀做的」。
       * 根因（实测）：所有区块宽度都锁在 828px，在 1440 屏上浪费近一半横向空间，
       *   而时间线却高 1538px —— 是「窄栏垂直堆叠」，不是工作台布局。
       * 改法：按**职责**分两栏（宽屏），窄屏保持单栏顺序流：
       *   左栏＝记录流（时间线，主内容，占 1.6 份宽）
       *   右栏＝工具区（参谋卡 / 判词 / 录入，占 1 份宽，sticky 跟随）
       * 这样「看记录」与「用工具」各占其位，不必来回滚动。 */}
      {!showGuide && gid != null ? (
        <div className="live-shell">
          <div className="live-main">
            <div className="section-title">第 {g.day} 天事件流（最新在上）</div>
            <Timeline events={g.events.filter((e) => e.day === g.day)} claims={g.claims.filter((c) => c.day === g.day)}
              actions={g.actions.filter((a) => a.day === g.day)}
              botcClaims={g.botcClaims.filter((c) => c.day === g.day)} botcScript={g.script}
              seatName={g.seatName} busy={g.busy}
              onEditClaim={(c) => { g.setEditErr(null); g.setEditTarget({ kind: 'claim', row: c }); }}
              onRetractClaim={(c) => void g.doRetract('claim', c)}
              onEditAction={(a) => { g.setEditErr(null); g.setEditTarget({ kind: 'action', row: a }); }}
              onRetractAction={(a) => void g.doRetract('action', a)}
              onRetractBotcClaim={(c) => void g.doRetractBotc(c)} />
          </div>

          <aside className="live-side">
            <AdvisorZone gameId={gid} gameName={g.game?.name ?? '#' + gid} advise={advise} />
            <OracleZone gameId={gid} advise={advise} />
            {/* 录入区在右栏：与记录流同屏，边看边记不必滚动 */}
            <InputBar text={cf.text} phase={g.phase} busy={g.busy} hasGame={gid != null}
              onText={cf.setText} onPhase={g.setPhase} onSend={() => void cf.sendText()}
              onMacro={(k) => { cf.setMacroErr(null); cf.setMacroKind(k); }} />
          </aside>
        </div>
      ) : null}

      {cf.macroKind != null && (
        <MacroSheet key={cf.macroKind} kind={cf.macroKind} day={g.day} phase={g.phase} players={g.players} botcScript={g.script} busy={g.busy}
          error={cf.macroErr} onSubmit={cf.macroSubmit} onClose={() => cf.setMacroKind(null)} />
      )}
      {cf.card != null && (
        <ConfirmCard card={cf.card} round={cf.round} reshown={cf.reshown} busy={g.busy} error={cf.cardErr} ctx={g.seatCtx}
          botcScript={g.script} seatName={g.seatName}
          onApply={cf.applyCard} onConfirm={() => void cf.confirmCard()} onCancel={cf.cancelCard} />
      )}
      {g.editTarget != null && (
        <EditSheet key={g.editTarget.kind + g.editTarget.row.id} target={g.editTarget} seats={g.seats} botcScript={g.script} busy={g.busy} error={g.editErr}
          onSubmit={(patch) => void g.submitEdit(patch)} onClose={() => g.setEditTarget(null)} />
      )}
      {wizardOpen && <NewGameWizard onClose={() => setWizardOpen(false)} onCreated={handleCreated} />}
    </div>
  );
}
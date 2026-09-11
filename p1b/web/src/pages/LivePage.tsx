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
    onDone: (d) => g.flashToast('✓ 第 ' + d + ' 天参谋卡就绪，已存档'),
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
    g.flashToast('✓ 局 #' + game.id + '「' + game.name + '」已创建，' + game.player_count + ' 席就位');
  }

  function doSettle() {
    if (gid == null) return;
    g.setPageErr(null);
    advise.startAdvise(gid, g.day).catch((e) => g.setPageErr(e instanceof Error ? e.message : String(e)));
  }

  const empty = g.games.length === 0;

  return (
    <div className="input-page">
      <TopBar games={g.games} game={g.game} day={g.day} maxDay={g.game?.current_day ?? 1} roster={g.roster}
        busy={g.busy} onDay={g.setDay} onSwitch={g.switchGame}
        onSettle={gid != null ? doSettle : undefined} settling={advise.task != null}
        onWizard={() => setWizardOpen(true)} />
      {g.pageErr && <div className="banner banner-error"><p>{g.pageErr}</p></div>}
      {g.toast && <div className="toast">{g.toast}</div>}

      {empty && <LiveEmpty onCreate={() => setWizardOpen(true)} />}

      {gid != null && <AdvisorZone gameId={gid} gameName={g.game?.name ?? '#' + gid} advise={advise} />}
      {gid != null && <OracleZone gameId={gid} advise={advise} />}

      {!empty && gid != null && (
        <>
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
        </>
      )}

      <InputBar text={cf.text} phase={g.phase} busy={g.busy} hasGame={gid != null}
        onText={cf.setText} onPhase={g.setPhase} onSend={() => void cf.sendText()}
        onMacro={(k) => { cf.setMacroErr(null); cf.setMacroKind(k); }} />

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
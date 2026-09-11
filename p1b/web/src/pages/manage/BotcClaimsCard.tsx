/** BotcClaimsCard —— BOTC 局阵营/状态声称 + 剧本角色参考面板（B6 自 GamesPage 详情搬出）。 */
import { useEffect, useState } from 'react';
import * as api from '../../api';
import type { BotcClaim, BotcScript, Game } from '../../types';
import { SCRIPT_LABEL, rolesByScript, teamLabel } from '../../botc/roles';
import { BOTC_PRED_LABEL } from '../../components/input/confirm-flow';

const PHASE_CN: Record<string, string> = { night: '夜', day: '昼', dusk: '黄昏' };

export default function BotcClaimsCard(props: { game: Game; script: BotcScript | null; viewDay: number }) {
  const [claims, setClaims] = useState<BotcClaim[]>([]);
  const [refOpen, setRefOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.getBotcClaims(props.game.id)
      .then((r) => { if (!cancelled) setClaims(r.claims); })
      .catch(() => { if (!cancelled) setClaims([]); });
    return () => { cancelled = true; };
  }, [props.game.id]);

  return (
    <div className="detail-card">
      <div className="detail-head">
        <span className="detail-title">血染钟楼 · 阵营/状态声称</span>
        <span className="detail-meta">{props.script ? SCRIPT_LABEL[props.script] : '未挂剧本（角色/阵营声称不可录）'}</span>
      </div>
      {claims.length === 0 && (
        <p className="muted" style={{ margin: '8px 0 0' }}>
          暂无阵营/状态声称（现场确认卡把谓词切换为 是恶魔/是爪牙/自称醉酒/自称中毒 即落 botc_claims）
        </p>
      )}
      {claims.length > 0 && (
        <>
          <p className="state-sum">共 {claims.length} 条 · 截至第 {props.viewDay} 天可见 {claims.filter((c) => c.day <= props.viewDay).length} 条</p>
          <ul className="botc-claim-list">
            {claims.filter((c) => c.day <= props.viewDay).map((c) => (
              <li key={c.id}>
                <span className="badge badge-warn">{BOTC_PRED_LABEL[c.predicate] ?? c.predicate}</span>
                <span>第{c.day}天·{PHASE_CN[c.phase] ?? c.phase} · {c.seat}号 → {c.subject_seat}号{c.object ? '（' + c.object + '）' : ''}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {props.script && (
        <div className="role-ref">
          <button type="button" className="btn" style={{ marginTop: 10 }} onClick={() => setRefOpen((o) => !o)}>
            {refOpen ? '▲ 收起角色参考' : '📖 展开本剧本角色参考（' + rolesByScript(props.script).length + ' 角色）'}
          </button>
          {refOpen && (
            <div className="role-ref-grid">
              {rolesByScript(props.script).map((r) => (
                <div className="role-card" key={r.id}>
                  <div className="role-card-head">
                    <span className="role-card-name">{r.name_zh || r.name_en}</span>
                    <span className="role-card-en">{r.name_en}</span>
                    <span className={'team-badge team-' + r.team}>{teamLabel(r.team)}</span>
                    {!/^唯一/.test(r.unique_note) && <span className="badge badge-warn">可重复</span>}
                  </div>
                  <p className="role-card-ability">{r.ability_zh || '（无中文能力摘要）'}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

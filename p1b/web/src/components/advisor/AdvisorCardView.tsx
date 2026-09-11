/** AdvisorCardView —— 参谋卡渲染（B6 自 AdvisorPage 原样搬出）：矛盾色标/假设双栏/验证点。 */
import { useState } from 'react';
import type { Hypothesis } from '../../types';
import { fmtEvs, fmtRes, fmtTime, loadChecks, saveChecks, type ArchiveEntry } from '../../lib/adviseArchive';

const UNDER_LABEL = { high: '高欠定度', mid: '中欠定度', low: '低欠定度' } as const;
const TEND_LABEL: Record<string, string> = { strong: '倾向:强', mid: '倾向:中', weak: '倾向:弱' };

export default function AdvisorCardView(props: {
  gameId: number;
  entry: ArchiveEntry;
  gameName: string;
  source: 'task' | 'server' | 'local';
}) {
  const card = props.entry.card;
  const checkKey = props.gameId + ':' + card.day;
  const [checked, setChecked] = useState<Set<number>>(() => new Set(loadChecks(checkKey)));

  function toggle(i: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      saveChecks(checkKey, [...next].sort((a, b) => a - b));
      return next;
    });
  }

  const hyps: Hypothesis[] = Array.isArray(card.hypotheses) ? card.hypotheses : [];
  const contrs = Array.isArray(card.contradictions) ? card.contradictions : [];
  const cps = Array.isArray(card.checkpoints) ? card.checkpoints : [];
  const underOf = (u: string): 'high' | 'mid' | 'low' => (u === 'high' || u === 'mid' ? u : 'low');

  return (
    <article className="adv-card" data-testid="advisor-card">
      <div className="adv-card-banner">═══ 参谋卡 · 思路非答案 ═══</div>
      <p className="adv-card-sub">
        {props.gameName} · 第 {card.day} 天结算
        {props.source === 'server' ? ' · 服务端存档（截至该天）' : props.entry.finished_at ? ' · ' + fmtTime(props.entry.finished_at) : ''}
        {card.saved ? ' · 已回存服务端' : ''}
      </p>
      {(card.warnings ?? []).map((w, i) => <p key={i} className="adv-warn">⚠ {w}</p>)}

      <h3 className="adv-sec-title">矛盾点 {contrs.length} 条（欠定度色标：高=红 中=黄 低=灰）</h3>
      {contrs.length === 0 && <p className="muted" style={{ margin: '0 4px' }}>未发现矛盾</p>}
      {contrs.map((c, i) => {
        const u = underOf(String(c.underdetermination ?? 'low'));
        const refs = [c.claim_a, c.claim_b].filter((v) => v != null).map((v) => 'c' + v)
          .concat([c.action_a, c.action_b].filter((v) => v != null).map((v) => 'a' + v));
        const exps = Array.isArray(c.innocent_explanations) ? c.innocent_explanations : [];
        return (
          <div key={i} className={'contr-card under-' + u}>
            <div className="contr-head">
              <span className={'under-badge ' + u}>{UNDER_LABEL[u]}</span>
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                {c.conflict_desc && !String(c.conflict_desc).startsWith('[LLM]') ? c.conflict_desc : '矛盾 #' + (i + 1)}
              </span>
              {c.evidence_day != null && <span className="ref-chip">证据天 d{c.evidence_day}</span>}
              {refs.map((r, j) => <span key={j} className="ref-chip">{r}</span>)}
            </div>
            <ul className="contr-exp">
              {exps.length > 0
                ? exps.map((x, j) => <li key={j}>无害解释: {x}</li>)
                : <li>无害解释: （空——RD1 非空校验不应出现）</li>}
            </ul>
          </div>
        );
      })}

      <h3 className="adv-sec-title">竞争假设 {hyps.length} 套（互相竞争，不追求唯一真相）</h3>
      {hyps.length === 0 && <p className="muted" style={{ margin: '0 4px' }}>（无假设——契约要求 ≥2 套竞争假设）</p>}
      <div className="hyp-grid">
        {hyps.map((h, i) => (
          <div key={i} className="hyp-card">
            <div className="hyp-head">
              <span className="hyp-id">H{i + 1}</span>
              <span className={'tend-badge tend-' + (h.tendency ?? 'weak')}>
                {TEND_LABEL[h.tendency] ?? String(h.tendency ?? '-')}
              </span>
            </div>
            <p className="hyp-content">{h.content}</p>
            <p className="hyp-evs">支持: {fmtEvs(h.support_events)} / 反对: {fmtEvs(h.oppose_events)}</p>
            <span className="hyp-foot">思路，非定论</span>
          </div>
        ))}
      </div>

      <h3 className="adv-sec-title">验证点 {cps.length} 条（勾选已验证项，本机保存）</h3>
      {cps.length === 0 && <p className="muted" style={{ margin: '0 4px' }}>（无验证点）</p>}
      <ul className="cp-list">
        {cps.map((cp, i) => (
          <li key={i}>
            <label className={'cp-item' + (checked.has(i) ? ' done' : '')}>
              <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} />
              <span className="cp-text">
                {i + 1}. {cp.text} <span className="cp-res">（分辨 {fmtRes(cp.resolves, hyps.length)}）</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </article>
  );
}
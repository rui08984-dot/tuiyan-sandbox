/**
 * NegativeResultsPage —— 负结果账本对外页（第 4 期 I2 · 2026-09-21）
 *
 * 依据：15 号件 §I2「负结果账本对外披露：把命题 A、0/52、KK516 边界、E1/E2 铁证做成公开『死亡假设页』——
 *   每个死假设挂 PREREG sha 与弃权条款原文。项目独有资产：Metaculus/ForecastBench/市场全都不披露负结果」。
 * 数据源：GET /api/disclosure/negative-results（只读落盘件 negative-results-ledger-<date>.json；
 *   缺件时后端 404 带生成命令 —— 本页如实显示 n/a，绝不编数）。
 * 纪律：①**四要素**（假设/判据路径+sha16/结局/复算入口）逐条显示，缺一即撤
 *   ②恒挂限定语块（照 A6 三条）③UI 禁用铁律②禁词的同义说法（用「推演/校准/分层账本」） ④页面零新读数（只呈现既有件）。
 */
import { useEffect, useState } from 'react';
import { Term, IconChart } from '../../components/ui';
import { PagePlate } from '../../components/PagePlate';

type Entry = {
  id: string; name: string;
  // 实证类字段（跑过、有读数）——四要素：假设／判据／结局／复算入口
  hypothesis?: string; criterion?: string; evidence?: string; outcome?: string; rerun?: string;
  criterion_sha16?: string; evidence_sha16?: string;
  // 设计类字段（评审否决、未跑）——两要素：拒绝理由／出处
  reason?: string; source?: string; source_sha16?: string;
};
type LedgerJson = {
  title: string; discipline: string; note: string; generated_at: string;
  empirical: Entry[]; design_rejected: Entry[];
};
const QUALIFICATION_BLOCK = [
  '本页数字来自引擎重放与既有实验记录，账本状态下「只记录、不计分」。',
  '质量门不含质量读数（门定性恒挂限定语）；对外表述一律挂限定语。',
  '样本少于 30 的格只记方向、不出结论；格间禁池化。',
];

/** 实证类卡：四要素（假设／判据／结局／复算入口）
 * ★ 2026-09-22 二轮：复算命令与校验码收进默认收起的「技术明细」——
 *   四要素一条不少（审计追溯完整），但使用者第一眼看到的是结论而非命令行。 */
function EmpiricalCard({ e }: { e: Entry }) {
  return (
    <article className="ui-section nr-card">
      <h3 className="ui-section-title">{e.id} · {e.name}</h3>
      <div className="ui-kv">
        <div className="ui-kv-row">
          <span className="ui-kv-key">当时的假设</span>
          <span className="ui-kv-val">{e.hypothesis}</span>
        </div>
        <div className="ui-kv-row">
          <span className="ui-kv-key">怎么判定</span>
          <span className="ui-kv-val">{e.criterion}</span>
        </div>
        <div className="ui-kv-row">
          <span className="ui-kv-key">结果</span>
          <span className="ui-kv-val nr-outcome">{e.outcome}</span>
        </div>
      </div>
      <details className="nr-tech">
        <summary>技术明细（复算入口与校验码）</summary>
        <div className="ui-kv">
          <div className="ui-kv-row">
            <span className="ui-kv-key">复算命令</span>
            <span className="ui-kv-val u-mono">{e.rerun}</span>
          </div>
          <div className="ui-kv-row">
            <span className="ui-kv-key">判据校验码</span>
            <span className="ui-kv-val u-mono">{e.criterion_sha16 ?? '—'}</span>
          </div>
          <div className="ui-kv-row">
            <span className="ui-kv-key">证据件</span>
            <span className="ui-kv-val u-mono">{e.evidence}{e.evidence_sha16 ? ' ｜ ' + e.evidence_sha16 : ''}</span>
          </div>
        </div>
      </details>
    </article>
  );
}

/** 设计类卡：拒绝理由／出处（此类未跑 ⇒ 无「结局/复算入口」，非缺失） */
function DesignCard({ e }: { e: Entry }) {
  return (
    <article className="ui-section nr-card is-design">
      <h3 className="ui-section-title">{e.id} · {e.name}</h3>
      <div className="ui-kv">
        <div className="ui-kv-row">
          <span className="ui-kv-key">为什么不采用</span>
          <span className="ui-kv-val">{e.reason}</span>
        </div>
      </div>
      <details className="nr-tech">
        <summary>技术明细（出处与校验码）</summary>
        <div className="ui-kv">
          <div className="ui-kv-row">
            <span className="ui-kv-key">出处</span>
            <span className="ui-kv-val u-mono">{e.source}{e.source_sha16 ? ' ｜ ' + e.source_sha16 : ''}</span>
          </div>
        </div>
      </details>
    </article>
  );
}

export default function NegativeResultsPage() {
  const [data, setData] = useState<LedgerJson | null>(null);
  const [missing, setMissing] = useState<{ hint?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/disclosure/negative-results')
      .then(async (r) => { if (!r.ok) throw await r.json().catch(() => ({})); return r.json(); })
      .then((j) => { if (alive) setData(j as LedgerJson); })
      .catch((e) => { if (alive) setMissing({ hint: (e && e.hint) || 'node p1b/scripts/negative-results.cjs' }); });
    return () => { alive = false; };
  }, []);

  if (missing) {
    return (
      <div className="ui-stack">
        <h1 className="ui-section-title">负结果账本</h1>
        <div className="ui-empty" title={missing.hint ? '维护者：' + missing.hint : undefined}>
          这项数据还没准备好，重新生成后即可显示
        </div>
      </div>
    );
  }
  if (!data) return <div className="ui-skeleton">读取披露件…</div>;

  const emp = Array.isArray(data.empirical) ? data.empirical : [];
  const des = Array.isArray(data.design_rejected) ? data.design_rejected : [];

  return (
    <div className="ui-stack">
      <PagePlate
        testId="nr-plate"
        icon={<IconChart size={20} />}
        title="负结果账本"
        tail="Negative Results"
        subtitle={
          <>
            输得起才配赢：每个死掉的假设都挂出处——判据件、冻结指纹与复算命令一并公开。
            这是本项目独有的一份资产：同类平台通常只披露胜出者。
          </>
        }
      />

      <section className="ui-section">
        <h2 className="ui-section-title">限定语块</h2>
        <ul className="ui-note">{QUALIFICATION_BLOCK.map((q, i) => <li key={i}>{q}</li>)}</ul>
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">实证类（跑过、有读数、结论＝停）｜{emp.length} 条</h2>
        {emp.length ? emp.map((e) => <EmpiricalCard key={e.id} e={e} />) : <div className="ui-empty">n/a</div>}
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">设计类（评审否决、未跑）｜{des.length} 条</h2>
        {des.length ? des.map((e) => <DesignCard key={e.id} e={e} />) : <div className="ui-empty">n/a</div>}
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">口径与出处</h2>
        <p className="ui-note">
          数据源：<code>negative-results-ledger-*.json</code>（生成于 {data.generated_at || 'n/a'}）。
          纪律：{data.discipline || 'n/a'}。每条的四要素（假设／判据／结局／复算入口）缺一即撤。
          贝叶斯语义见 <Term id="bayesPrior">先验</Term> ／ <Term id="posteriorAgg">后验聚合</Term> 术语说明。
        </p>
      </section>
    </div>
  );
}

/**
 * CalendarPage —— 待验证队列日历（P0-U7 页面化 · 2026-09-16）
 *
 * 数据源：GET /api/disclosure/calendar（只读披露件 `p1b/sim/out/forecast-calendar-<date>.json`；
 *   缺件时后端 404 带生成命令 —— 本页如实显示 n/a，绝不编数）。
 * 口径：只披露不裁决 —— 账本到期日与证据侧到期日不一致的清单**不判谁对**；
 *   本页不构成任何能力宣称（铁律②：正文与标题不用禁用字样）。
 */
import { useEffect, useState } from 'react';
import { IconClock } from '../../components/ui';

type CalJson = {
  title: string; today: string; rows: number;
  basis: string;
  buckets: { day_window: Record<string, number>; week_window: Record<string, number>; gt30: number; undatable_ledger: number };
  conservation: { sum: number; rows: number };
  dual_source_row: { agree: number; mismatch_n: number; ledger_only_n: number; evidence_only_n: number; both_none: number; rule: string };
  dual_source_bucket: { diff_days: number };
  evidence_src_counts: Record<string, number>;
};

export default function CalendarPage() {
  const [data, setData] = useState<CalJson | null>(null);
  const [missing, setMissing] = useState<{ hint?: string } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/disclosure/calendar')
      .then(async (r) => { if (!r.ok) throw await r.json().catch(() => ({})); return r.json(); })
      .then((j) => { if (alive) setData(j as CalJson); })
      .catch((e) => { if (alive) setMissing({ hint: (e && e.hint) || 'node p1b/scripts/forecast-calendar.cjs' }); });
    return () => { alive = false; };
  }, []);

  if (missing) {
    return (
      <div className="ui-stack">
        <h1 className="ui-section-title">待验证队列</h1>
        <div className="ui-empty">
          披露件暂缺（n/a）。生成命令：<code>{missing.hint}</code>
        </div>
      </div>
    );
  }
  if (!data) return <div className="ui-skeleton">读取披露件…</div>;

  const dayRows = Object.keys(data.buckets.day_window).sort();
  const weekRows = Object.keys(data.buckets.week_window).sort();
  const srcs = Object.keys(data.evidence_src_counts).sort();
  const d = data.dual_source_row;

  return (
    <div className="ui-stack">
      <h1 className="ui-section-title"><IconClock size={16} /> 待验证队列（{data.today}）</h1>
      <p className="ui-note">口径：{data.basis}。只披露不裁决；本页不构成任何能力宣称。</p>

      <section className="ui-section">
        <h2 className="ui-section-title">① 未来 7 天（逐日）</h2>
        {dayRows.length ? (
          <table className="ui-matrix">
            <thead><tr><th>日期</th><th>条数</th></tr></thead>
            <tbody>{dayRows.map((k) => <tr key={k}><td>{k}</td><td>{data.buckets.day_window[k]}</td></tr>)}</tbody>
          </table>
        ) : <div className="ui-empty">窗口内无到期</div>}
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">② 8–30 天</h2>
        {weekRows.length ? (
          <table className="ui-matrix">
            <thead><tr><th>到期日</th><th>条数</th></tr></thead>
            <tbody>{weekRows.map((k) => <tr key={k}><td>{k}</td><td>{data.buckets.week_window[k]}</td></tr>)}</tbody>
          </table>
        ) : <div className="ui-empty">窗口内无到期</div>}
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">③ 30 天以上与不可定到期</h2>
        <div className="ui-kv">
          <div className="ui-kv-row"><span className="ui-kv-key">30 天以上</span><span className="ui-kv-val">{data.buckets.gt30}</span></div>
          <div className="ui-kv-row"><span className="ui-kv-key">无到期日（不可定）</span><span className="ui-kv-val">{data.buckets.undatable_ledger}</span></div>
          <div className="ui-kv-row"><span className="ui-kv-key">守恒自检</span><span className="ui-kv-val">{data.conservation.sum} / {data.conservation.rows}</span></div>
        </div>
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">④ 双源比对（只披露不裁决）</h2>
        <div className="ui-kv">
          <div className="ui-kv-row"><span className="ui-kv-key">一致</span><span className="ui-kv-val">{d.agree}</span></div>
          <div className="ui-kv-row"><span className="ui-kv-key">不一致</span><span className="ui-kv-val">{d.mismatch_n}</span></div>
          <div className="ui-kv-row"><span className="ui-kv-key">仅账本侧</span><span className="ui-kv-val">{d.ledger_only_n}</span></div>
          <div className="ui-kv-row"><span className="ui-kv-key">仅证据侧</span><span className="ui-kv-val">{d.evidence_only_n}</span></div>
          <div className="ui-kv-row"><span className="ui-kv-key">两源皆无</span><span className="ui-kv-val">{d.both_none}</span></div>
          <div className="ui-kv-row"><span className="ui-kv-key">日桶差异</span><span className="ui-kv-val">{data.dual_source_bucket.diff_days}</span></div>
        </div>
        <p className="ui-note">{d.rule}</p>
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">⑤ 到期来源分布</h2>
        <table className="ui-matrix">
          <thead><tr><th>来源</th><th>条数</th></tr></thead>
          <tbody>{srcs.map((k) => <tr key={k}><td>{k}</td><td>{data.evidence_src_counts[k]}</td></tr>)}</tbody>
        </table>
      </section>
    </div>
  );
}

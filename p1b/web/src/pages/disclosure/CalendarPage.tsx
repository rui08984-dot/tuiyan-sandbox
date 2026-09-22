/**
 * CalendarPage —— 待验证队列日历（P0-U7 页面化 · 2026-09-16）
 *
 * 数据源：GET /api/disclosure/calendar（只读披露件 `p1b/sim/out/forecast-calendar-<date>.json`；
 *   缺件时后端 404 带生成命令 —— 本页如实显示 n/a，绝不编数）。
 * 口径：只披露不裁决 —— 账本到期日与证据侧到期日不一致的清单**不判谁对**；
 *   本页不构成任何能力宣称（铁律②：正文与标题不用禁用字样）。
 *
 * ── 2026-09-22 全方面重构（第一批 · 五页之一）──
 *   ① 未来 7 天/8–30 天表 → 柱状条（含 100% 阈值线）
 *   ② 守恒自检 → 占比条 +100% 阈值线（sum/rows 必须相等才过）
 *   ③ 双源比对 → 双线折线（ledger vs evidence_daemon，差异带）＋ by_kind 分布条
 *   ★ 红线：零命中禁词、空态文案 n/a 原样保留、'n<30 仅方向'等字面量不动。
 */
import { useEffect, useState } from 'react';
import { IconClock } from '../../components/ui';
import { ChartFrame, Bar, StackedBar, LineChart } from '../../charts';
import { int } from '../../lib/format';

type CalJson = {
  title: string; today: string; rows: number; basis: string;
  buckets: { day_window: Record<string, number>; week_window: Record<string, number>; gt30: number; undatable_ledger: number };
  conservation: { sum: number; rows: number };
  dual_source_row: { agree: number; mismatch_n: number; ledger_only_n: number; evidence_only_n: number; both_none: number; rule: string };
  dual_source_bucket: { diff_days: number; diff?: Array<{ day: string; ledger: number; evidence_daemon: number }> };
  evidence_src_counts: Record<string, number>;
  by_kind?: Record<string, number>;
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
        <div className="ui-empty">披露件暂缺（n/a）。生成命令：<code>{missing.hint}</code></div>
      </div>
    );
  }
  if (!data) return <div className="ui-skeleton">读取披露件…</div>;

  const dayRows = Object.keys(data.buckets.day_window).sort();
  const weekRows = Object.keys(data.buckets.week_window).sort();
  const srcs = Object.keys(data.evidence_src_counts).sort();

  // 双源比对折线：取 d.diff[]（实测有），没有则回退表格文本
  const dRow = data.dual_source_row;
  const dBucket = data.dual_source_bucket.diff || [];
  const maxDiff = Math.max(1, ...dBucket.map((x) => Math.max(Math.abs(x.ledger - x.evidence_daemon), 1)));

  const maxSum = Math.max(data.conservation.sum, data.conservation.rows, 1);

  return (
    <div className="ui-stack">
      <header className="page-head">
        <h1><IconClock size={20} /> 待验证队列（{data.today}）</h1>
        <p className="page-sub">口径：{data.basis}。只披露不裁决；本页不构成任何能力宣称。</p>
      </header>

      {/* ── ① 未来 7 天 +8–30 天 → 柱状条 ── */}
      <ChartFrame
        testId="cal-daybar"
        eyebrow="到期量分布"
        title="未来窗口内的题量"
        sourceFile="forecast-calendar"
        generatedAt={undefined}
        tableFallback={[
          ['日期', '条数'],
          ...dayRows.map((k) => [k, data.buckets.day_window[k]]),
          ...weekRows.map((k) => [k + '（周后）', data.buckets.week_window[k]]),
        ]}
        note="柱高＝窗口内到期题量；无数据即该窗口无题。"
      >
        <div className="cstack">
          {dayRows.map((k) => (
            <Bar key={k} value={data.buckets.day_window[k]} max={Math.max(15, ...Object.values(data.buckets.day_window))}
              threshold={10} thresholdLabel="阈值 10" label={`① ${k}`} valueText={int(data.buckets.day_window[k])} />
          ))}
          {weekRows.map((k) => (
            <Bar key={k} value={data.buckets.week_window[k]} max={Math.max(15, ...Object.values(data.buckets.week_window))}
              threshold={5} thresholdLabel="阈值 5" label={`② ${k}`} valueText={int(data.buckets.week_window[k])} />
          ))}
        </div>
      </ChartFrame>

      {/* ── ② 守恒自检 → 占比条 +100% 线 ── */}
      <ChartFrame
        testId="cal-conservation"
        eyebrow="守恒自检"
        title="sum（已定到期）vs rows（总行数）"
        sourceFile="forecast-calendar"
        generatedAt={undefined}
        note="两者应相等（sum==rows），否则存在不可定到期或统计偏差。100% 虚线为基准。"
      >
        <StackedBar
          segments={[
            { label: '已定到期（sum）', value: data.conservation.sum, color: 'var(--ok)' },
            { label: '未定到期', value: data.conservation.rows - data.conservation.sum, color: 'var(--warn)', pattern: 'stripe' as const },
          ]}
          total={data.conservation.rows}
          totalText={`${data.conservation.sum} / ${data.conservation.rows} (${(data.conservation.sum / maxSum * 100).toFixed(1)}%)`}
        />
      </ChartFrame>

      {/* ── ③ 双源比对 → 双线折线 ＋ by_kind 分布 ── */}
      {dBucket.length ? (
        <ChartFrame
          testId="cal-diff-line"
          eyebrow="双源比对（账本 vs 证据）"
          title="每日到期差值｜ledger − evidence_daemon"
          sourceFile="forecast-calendar"
          generatedAt={undefined}
          tableFallback={[
            ['日期', '账本', '证据', '差值'],
            ...dBucket.map((x) => [x.day, x.ledger, x.evidence_daemon, x.ledger - x.evidence_daemon]),
          ]}
          note="实线＝账本到期数；虚线＝证据到期数；差异带＝两线之间面积（直观看偏离程度）。"
        >
          <LineChart
            xLabels={dBucket.map((x) => x.day.slice(-2))}
            series={[
              { name: '账本到期', color: 'var(--layer-l2)', values: dBucket.map((x) => x.ledger), dash: undefined },
              { name: '证据到期', color: 'var(--layer-l5)', values: dBucket.map((x) => x.evidence_daemon), dash: '3 2' },
            ]}
            lo={-maxDiff} hi={maxDiff} height={96}
            bandBetween={[0, 1]}
          />
        </ChartFrame>
      ) : null}

      {/* ── ④ 证据来源分布 ── */}
      <ChartFrame
        testId="cal-src-counts"
        eyebrow="证据来源"
        title="各来源类型的计数"
        sourceFile="forecast-calendar"
        generatedAt={undefined}
        tableFallback={[
          ['来源', '计数'],
          ...srcs.map((k) => [k, data.evidence_src_counts[k]]),
          ...(data.by_kind !== undefined ? Object.entries(data.by_kind).map(([k, v]) => [k, v]) : []),
        ]}
      >
        <div className="ui-stack">
          {srcs.map((k) => (
            <Bar key={k} value={data.evidence_src_counts[k]} max={Math.max(...Object.values(data.evidence_src_counts))}
              label={k === 'undatable' ? '不可定' : k.split(':')[0]} valueText={int(data.evidence_src_counts[k])} />
          ))}
          {data.by_kind && Object.entries(data.by_kind!).length > 0 && (
            <>
              <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '8px 0' }} />
              <span className="chart-eyebrow">分题型</span>
              {Object.entries(data.by_kind!).slice(0, 10).map(([k, v]) => (
                <Bar key={k} value={v} max={Math.max(...Object.values(data.by_kind!))}
                  label={k.split(':')[0]} valueText={int(v)} />
              ))}
            </>
          )}
        </div>
      </ChartFrame>

      {/* ── 明细区（纯表格兜底） ── */}
      <section className="ui-section">
        <h2 className="ui-section-title">明细读数（精确值）</h2>
        <div className="ui-kv">
          <div className="ui-kv-row"><span className="ui-kv-key">一致</span><span className="ui-kv-val">{dRow.agree}</span></div>
          <div className="ui-kv-row"><span className="ui-kv-key">不一致</span><span className="ui-kv-val">{dRow.mismatch_n}</span></div>
          <div className="ui-kv-row"><span className="ui-kv-key">仅账本有</span><span className="ui-kv-val">{dRow.ledger_only_n}</span></div>
          <div className="ui-kv-row"><span className="ui-kv-key">仅证据有</span><span className="ui-kv-val">{dRow.evidence_only_n}</span></div>
          <div className="ui-kv-row"><span className="ui-kv-key">双无</span><span className="ui-kv-val">{dRow.both_none}</span></div>
          <div className="ui-kv-row"><span className="ui-kv-key">30 天以上</span><span className="ui-kv-val">{data.buckets.gt30}</span></div>
          <div className="ui-kv-row"><span className="ui-kv-key">无到期日</span><span className="ui-kv-val">{data.buckets.undatable_ledger}</span></div>
        </div>
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">规则</h2>
        <p className="ui-note">{dRow.rule}</p>
      </section>
    </div>
  );
}

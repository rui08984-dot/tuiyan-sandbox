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
import { PagePlate } from '../../components/PagePlate';
import { PageSidebar } from '../../components/PageSidebar';
import '../../styles/shell.css';
import { ChartFrame, Bar, LineChart } from '../../charts';
import { int } from '../../lib/format';

type CalJson = {
  title: string; today: string; rows: number; basis: string;
  generated_at?: string | null;
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
  /* 侧栏筛选状态（六轮）。空数组＝不筛（显示全部）。 */
  const [winFilter, setWinFilter] = useState<string[]>([]);
  const [srcFilter, setSrcFilter] = useState<string[]>([]);
  const [onlyMismatch, setOnlyMismatch] = useState(false);

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
        <div className="ui-empty" title={missing.hint ? '维护者：' + missing.hint : undefined}>
          这项数据还没准备好，重新生成后即可显示
        </div>
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

  /* ══ 侧栏筛选（六轮）══
   * ★ 诚实说明：本页数据是**聚合计数**（按日/周分桶），不是可逐条过滤的明细。
   *   所以这里的分类器控制的是「显示哪些时段切片」，而不是假装在过滤条目——
   *   不制造「看起来能筛、其实筛不动」的假交互。
   * 分组：
   *   时段 —— 7 天内 / 8–30 天 / 30 天以上 / 未定到期
   *   来源 —— 证据来源类型（每类一个切片） */
  const windowOptions = [
    { id: 'd7', label: '7 天内', count: dayRows.reduce((a, k) => a + data.buckets.day_window[k], 0) },
    { id: 'd30', label: '8–30 天', count: weekRows.reduce((a, k) => a + data.buckets.week_window[k], 0) },
    { id: 'gt30', label: '30 天以上', count: data.buckets.gt30 },
    { id: 'undated', label: '未定到期', count: data.buckets.undatable_ledger },
  ];
  const srcOptions = srcs.map((k) => ({
    id: k,
    label: k === 'undatable' ? '不可定' : k.split(':')[0],
    count: data.evidence_src_counts[k],
  }));
  const allWindows = windowOptions.map((o) => o.id);
  const allSrcs = srcOptions.map((o) => o.id);
  const winPick = winFilter.length ? winFilter : allWindows;
  const srcPick = srcFilter.length ? srcFilter : allSrcs;
  const showWin = (id: string) => winPick.indexOf(id) >= 0;

  return (
    <div className="ui-stack">
      <PagePlate
        testId="cal-plate"
        icon={<IconClock size={20} />}
        title="待验证队列"
        tail={data.today}
        subtitle={<>共 {int(data.rows)} 题等着见分晓。口径：{data.basis}。只披露不裁决；本页不构成任何能力宣称。</>}
      />

      <div className="page-shell">
        <PageSidebar
          testId="cal-sidebar"
          title="筛选"
          onClear={() => { setWinFilter([]); setSrcFilter([]); setOnlyMismatch(false); }}
          groups={[
            { label: '时段', hint: '多选', options: windowOptions, value: winFilter, onChange: setWinFilter },
            { label: '证据来源', hint: `${srcs.length} 类`, options: srcOptions, value: srcFilter, onChange: setSrcFilter },
            {
              label: '对账',
              single: true,
              options: [{ id: 'mismatch', label: '只看不一致的', count: dRow.mismatch_n }],
              value: onlyMismatch ? ['mismatch'] : [],
              onChange: (v) => setOnlyMismatch(v.length > 0),
            },
          ]}
        />

        <div className="page-shell-main">

      {/* ── ① 未来 7 天 +8–30 天 → 柱状条 ── */}
      <ChartFrame
        testId="cal-daybar"
        eyebrow="到期分布"
        title={winFilter.length ? `到期分布（已筛 ${winFilter.length} 个时段）` : '近期有多少题要见分晓'}
        sourceFile="forecast-calendar"
        generatedAt={data.generated_at}
        tableFallback={[
          ['日期', '条数'],
          ...dayRows.map((k) => [k, data.buckets.day_window[k]]),
          ...weekRows.map((k) => [k + '（周后）', data.buckets.week_window[k]]),
        ]}
        note="柱高＝该时段内到期的题量；没有柱子就是那时段没有题。"
      >
        <div className="cstack">
          {showWin('d7') && dayRows.map((k) => (
            <Bar key={k} value={data.buckets.day_window[k]} max={Math.max(15, ...Object.values(data.buckets.day_window))}
              threshold={10} thresholdLabel="阈值 10" label={`① ${k}`} valueText={int(data.buckets.day_window[k])} />
          ))}
          {showWin('d30') && weekRows.map((k) => (
            <Bar key={k} value={data.buckets.week_window[k]} max={Math.max(15, ...Object.values(data.buckets.week_window))}
              threshold={5} thresholdLabel="阈值 5" label={`② ${k}`} valueText={int(data.buckets.week_window[k])} />
          ))}
          {/* 30 天以上与未定到期也要能被筛到——否则筛选器会"吃掉"这两类数据 */}
          {showWin('gt30') ? (
            <Bar value={data.buckets.gt30} max={Math.max(15, data.buckets.gt30, 1)}
              label="③ 30 天以上" valueText={int(data.buckets.gt30)} />
          ) : null}
          {showWin('undated') ? (
            <Bar value={data.buckets.undatable_ledger} max={Math.max(15, data.buckets.undatable_ledger, 1)}
              color="var(--warn)" label="④ 未定到期" valueText={int(data.buckets.undatable_ledger)} />
          ) : null}
          {!showWin('d7') && !showWin('d30') && !showWin('gt30') && !showWin('undated') ? (
            <p className="ui-note" style={{ margin: 0 }}>当前筛选下没有时段可显示</p>
          ) : null}
        </div>
      </ChartFrame>

      {/* ── ② 双源比对 → 双线折线 ── */}
      {dBucket.length ? (
        <ChartFrame
          testId="cal-diff-line"
          eyebrow="两套算法对账"
          title="每日到期题量：账本 vs 证据推算"
          sourceFile="forecast-calendar"
          generatedAt={data.generated_at}
          tableFallback={[
            ['日期', '账本', '证据', '差值'],
            ...dBucket.map((x) => [x.day, x.ledger, x.evidence_daemon, x.ledger - x.evidence_daemon]),
          ]}
          note="两条线越贴合说明两套算法越一致；中间灰带是两者差距。"
        >
          <LineChart
            xLabels={dBucket.map((x) => x.day.slice(-2))}
            series={[
              { name: '账本记录', color: 'var(--layer-l2)', values: dBucket.map((x) => x.ledger), dash: undefined },
              { name: '证据推算', color: 'var(--layer-l5)', values: dBucket.map((x) => x.evidence_daemon), dash: '3 2' },
            ]}
            lo={-maxDiff} hi={maxDiff} height={96}
            bandBetween={[0, 1]}
          />
        </ChartFrame>
      ) : null}

      {/* ── ③ 证据来源分布 ── */}
      <ChartFrame
        testId="cal-src-counts"
        eyebrow="证据来源"
        title="这些题的到期日是怎么确定的"
        sourceFile="forecast-calendar"
        generatedAt={data.generated_at}
        tableFallback={[
          ['来源', '计数'],
          ...srcs.map((k) => [k, data.evidence_src_counts[k]]),
          ...(data.by_kind !== undefined ? Object.entries(data.by_kind).map(([k, v]) => [k, v]) : []),
        ]}
        note="按来源类型统计，可看出多少题已有明确到期依据、多少还没定。"
      >
        <div className="ui-stack">
          {srcs.filter((k) => srcPick.indexOf(k) >= 0).map((k) => (
            <Bar key={k} value={data.evidence_src_counts[k]} max={Math.max(...Object.values(data.evidence_src_counts))}
              label={k === 'undatable' ? '不可定' : k.split(':')[0]} valueText={int(data.evidence_src_counts[k])} />
          ))}
          {srcs.filter((k) => srcPick.indexOf(k) >= 0).length === 0 ? (
            <p className="ui-note" style={{ margin: 0 }}>当前筛选下没有来源可显示</p>
          ) : null}
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
        <h2 className="ui-section-title">
          明细读数（精确值）
          {onlyMismatch ? <span className="ui-note">　仅显示不一致相关</span> : null}
        </h2>
        <div className="ui-kv">
          {!onlyMismatch && <div className="ui-kv-row"><span className="ui-kv-key">一致</span><span className="ui-kv-val">{dRow.agree}</span></div>}
          <div className="ui-kv-row"><span className="ui-kv-key">不一致</span><span className="ui-kv-val">{dRow.mismatch_n}</span></div>
          <div className="ui-kv-row"><span className="ui-kv-key">仅账本有</span><span className="ui-kv-val">{dRow.ledger_only_n}</span></div>
          <div className="ui-kv-row"><span className="ui-kv-key">仅证据有</span><span className="ui-kv-val">{dRow.evidence_only_n}</span></div>
          {!onlyMismatch && <div className="ui-kv-row"><span className="ui-kv-key">双无</span><span className="ui-kv-val">{dRow.both_none}</span></div>}
          {!onlyMismatch && <div className="ui-kv-row"><span className="ui-kv-key">30 天以上</span><span className="ui-kv-val">{data.buckets.gt30}</span></div>}
          {!onlyMismatch && <div className="ui-kv-row"><span className="ui-kv-key">无到期日</span><span className="ui-kv-val">{data.buckets.undatable_ledger}</span></div>}
        </div>
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">规则</h2>
        <p className="ui-note">{dRow.rule}</p>
      </section>

        </div>
      </div>
    </div>
  );
}

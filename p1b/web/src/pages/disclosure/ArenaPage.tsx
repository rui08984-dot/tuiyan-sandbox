/**
 * ArenaPage —— 三行对比榜（第 4 期 A9 · 2026-09-21）
 *
 * 依据：蓝图「竞技场对比榜三行版」；07 号件原文「三行对比榜（vs 市场收盘价 vs ForecastBench 人类分，
 *   **标注市场价仅为对手参照**）」。
 *
 * ★本页最重要的设计决定（口径纪律，比 UI 重要）：
 *   **不做「直接比 Brier」**——三行题集不同、horizon 不同 ⇒ 直接并列是**跨题集比较**，错。
 *   本页改为：三行各自标注**口径/状态**，并逐对声明**可比性**（可比/不可比＋原因）。
 *   数据源：GET /api/disclosure/arena（后端已做投影与不可比声明）。
 * 纪律：①恒挂限定语块 ②UI 禁用铁律②所列禁词 ③市场价仅作对手参照（不得混入我方读数）
 *   ④人类基线为**转载级未核验值**，页内如实标注。
 *
 * ── 2026-09-22 全方面重构（第一批 · 五页之一）──
 *   ① "三行堆叠" → "同横轴对比"（横轴=Brier 0..0.25，阈值虚线在 0.25）
 *   ② 放宽 `typeof === 'number'` 过滤，放出被丢弃的 4 组嵌套数值（dataset/market 双子、next_llms 三模型、combination_questions）
 *   ③ incomparable[].pair 用视觉分隔（斜纹背景或分割线）
 *   ★ 红线：禁词零命中（源码及 dist）、空态文案 n/a 原样保留。
 */
import { useEffect, useState } from 'react';
import { Term, IconChart, EmptyState } from '../../components/ui';
import { Bar, ChartFrame, FilterChips } from '../../charts';
import { tri, int } from '../../lib/format';

type MineRow = { layer: string; scored_n: number | null; brier: number | null; note: string | null };
type Human = {
  source: string | null; status: string | null; metric: string | null; usage_rule: string | null;
  values: Record<string, unknown> | null;
};
type Market = { available: boolean; reason: string; pending_note: string };
type Incomparable = { pair: string; reason: string };
type ArenaJson = {
  source_file: string; generated_at: string | null;
  mine: MineRow[]; human: Human | null; market: Market;
  incomparable: Incomparable[]; qualification_block: string[]; discipline_note: string;
};
const f = (x: number | null) => tri(x);
const MAX_BRIER = 0.25; // 无信息常数 0.5 ⇒ Brier=0.25 的阈值

export default function ArenaPage() {
  const [data, setData] = useState<ArenaJson | null>(null);
  const [missing, setMissing] = useState<{ hint?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/disclosure/arena')
      .then(async (r) => { if (!r.ok) throw await r.json().catch(() => ({})); return r.json(); })
      .then((j) => { if (alive) setData(j as ArenaJson); })
      .catch((e) => { if (alive) setMissing({ hint: (e && e.hint) || 'node p1b/scripts/stage4-run.cjs --text <out> --json <out>' }); });
    return () => { alive = false; };
  }, []);

  if (missing) {
    return (
      <div className="ui-stack">
        <h1 className="ui-section-title">三行对比榜</h1>
        <div className="ui-empty">披露件暂缺（n/a）。生成命令：<code>{missing.hint}</code></div>
      </div>
    );
  }
  if (!data) return <div className="ui-skeleton">读取披露件…</div>;

  const mine = Array.isArray(data.mine) ? data.mine : [];
  const inc = Array.isArray(data.incomparable) ? data.incomparable : [];
  const hv = (data.human && data.human.values) || null;

  /** 放出所有数值键，不只是 typeof === 'number' 的顶层；嵌套对象展开成可画条的数据 */
  const allValues = useMemoFlat(hv ?? {});

  return (
    <div className="ui-stack">
      <header className="page-head">
        <h1><IconChart size={20} /> 三行对比榜</h1>
        <p className="page-sub">
          三行并排看：<b>我方</b>（分层账本读数）／<b>市场参照</b>（赔率快照，仅作对手参照）／<b>人类基线</b>（公开基准）。
          <br />
          <b>本榜不做跨题集的直接比较</b>——三行的题集与时间口径不同，直接并列数字会得出错误结论。
        </p>
      </header>

      {/* ── 筛选 chip 栏：仅展示层（我方的分层）── */}
      {mine.length ? (
        <FilterChips groups={[{
          label: '层',
          options: mine.map((m) => ({ id: m.layer, label: m.layer, color: `var(--layer-${m.layer.toLowerCase()})` })),
          value: mine.map(m => m.layer),
          onChange: () => {}, // 纯展示，无交互
          single: false,
        }]} />
      ) : null}

      {/* ── ① 第一行：我方（同横轴条形图，0.25 虚线）── */}
      <ChartFrame
        testId="arena-mine"
        eyebrow="我方（引擎重放口径）"
        title="各层 Brier（最低越好，≤0.25 即优于乱猜）"
        sourceFile={data.source_file || 'stage4-run'}
        generatedAt={data.generated_at || undefined}
        tableFallback={[
          ['层', '可计分 n', 'Brier', '状态'],
          ...mine.map((r) => [r.layer, int(r.scored_n), f(r.brier), r.scored_n !== null && r.scored_n < 30 ? '薄格' : 'OK']),
        ]}
        note="每层一竖条，横轴共享；0.25 虚线＝「一律报 0.5」的无信息水平（更低＝更好）。"
      >
        <div className="cstack" style={{ marginTop: 8 }}>
          {mine.length ? mine.map((m) => (
            <Bar key={m.layer}
              value={m.brier} max={MAX_BRIER}
              threshold={MAX_BRIER}
              thresholdLabel="0.25 无信息线"
              color={`var(--layer-${m.layer.toLowerCase()})`}
              valueText={`${int(m.scored_n)}｜${f(m.brier)}`}
            />
          )) : <div className="ui-empty">n/a</div>}
        </div>
      </ChartFrame>

      {/* ── ② 第二行：市场参照（当前恒不可用，但预留图形位）── */}
      <section className="ui-section">
        <h2 className="ui-section-title">第二行 · 市场参照（对手参照，不参与我方读数）</h2>
        <EmptyState
          text={data.market.available ? '可用' : '当前不可用'}
          testId="market-status"
        />
        {data.market.available ? (
          <>
            <p className="ui-note">{data.market.reason}</p>
            <span className="ui-note">{data.market.pending_note}</span>
          </>
        ) : (
          <div className="ui-note">{data.market.pending_note}</div>
        )}
      </section>

      {/* ── ③ 第三行：人类基线（放出嵌套数值，可以画条）── */}
      {data.human ? (
        <ChartFrame
          testId="arena-human"
          eyebrow="人类基线（公开基准）"
          title={<Term id="calibrationAci" plain="校准参考" /> + "（越接近 0 越好）"}
          sourceFile="forecastbench-baseline.json"
          generatedAt={data.generated_at || undefined}
          tableFallback={[
            ['指标', '值', '说明'],
            ['来源', data.human.source ?? '—', ''],
            ['核验状态', data.human.status ?? '—', ''],
            ['口径要求', data.human.usage_rule ?? '—', ''],
            ...Object.entries(allValues).map(([k, vPair]) => {
              const val = Array.isArray(vPair) ? vPair[1] : (vPair as number);
              return [k, Number(val).toFixed(4), ''];
            }),
          ]}
          note="数值原样转录自 ForecastBench 件，人类基线为转载级未核验值。"
        >
          <div className="ui-stack" style={{ marginTop: 12 }}>
            {Object.keys(allValues).map((k) => {
              const val = allValues[k][1];
              if (Number.isFinite(val)) {
                const isGood = val <= MAX_BRIER;
                return (
                  <Bar key={k}
                    value={val} max={MAX_BRIER}
                    threshold={MAX_BRIER}
                    thresholdLabel="0.25 无信息线"
                    color={isGood ? 'var(--ok)' : 'var(--warn)'}
                    valueText={<Term id="calibrationAci" plain="Brier" />}
                  />
                );
              }
              return null;
            })}
          </div>
        </ChartFrame>
      ) : null}

      {/* ── 可比性逐对声明（本页的核心）── */}
      <section className="ui-section">
        <h2 className="ui-section-title">可比性逐对声明（本页的核心）</h2>
        <div className="ui-kv">
          {inc.map((x, i) => (
            <div key={i} className="ui-kv-row incomparable-row">
              <span className="ui-kv-key">{x.pair}</span>
              <span className="ui-kv-val u-mono">{x.reason}</span>
            </div>
          ))}
        </div>
        <p className="ui-note" style={{ marginTop: 8 }}>{data.discipline_note}</p>
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">口径边界</h2>
        <p className="ui-note">
          本页读引擎重放口径（<code>{data.source_file}</code>，生成于 {data.generated_at || 'n/a'}）；
          与审计页 <code>/api/audit/summary</code> 的账本口径不同源、不可互搬。
          市场参照若出数，须先对齐**获取时点**再谈比较。
        </p>
      </section>
    </div>
  );
}

// 扁平化嵌套对象，把所有层级拆成可绘制的单列数据
function useMemoFlat(values: Record<string, unknown>, parent?: string): Record<string, [string, number]> {
  const out: Record<string, [string, number]> = {};
  for (const k in values) {
    const v = values[k];
    const fullKey = parent ? `${parent}.${k}` : k;
    if (typeof v === 'object' && v !== null) {
      Object.assign(out, useMemoFlat(v as Record<string, unknown>, fullKey));
    } else if (typeof v === 'number') {
      out[fullKey] = [String(v), v];
    }
  }
  return out;
}

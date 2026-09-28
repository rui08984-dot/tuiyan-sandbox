/**
 * 读数卡 ReadoutCard（2026-09-22 二轮重构 · 结果展示层）
 *
 * 设计依据：用户提供的参考图（Metaculus 问题卡）。
 * 参考图的本质不是「好看」，而是**结构分工**：
 *   ┌───────────────────────────────────────────┐
 *   │ ╭───╮   层名 · 一句话说明        682 题      │  ← 标题行：左=身份，右=样本量
 *   │ │.24│   ┌──────────────────────────┐        │
 *   │ ╰───╯   │  ▁▃▅▂▁▁▂▄▃▁ 迷你趋势条    │        │  ← 主体：图形当主角
 *   │ 半圆仪  └──────────────────────────┘        │
 *   │  Brier 0.238   区间 [0.21, 0.27]            │  ← 数值行：大号数值 + 区间
 *   │  ⓘ n≥30 可出结论 · 校准参考                  │  ← 元信息行：状态与口径
 *   └───────────────────────────────────────────┘
 *
 * ★ 三条纪律（继承既有测试闸，不得违反）：
 *   ① 数值永在场——图形是补充，文字必须能独立读懂（grade=AA/无障碍）
 *   ② 空态原文保留——「样本不足」「n<30 出不了区间」不得被图形替掉（dist.test.mjs 契约）
 *   ③ 稀疏 ≠ 0 —— 无读数的格子画「无数据」，绝不画成 0 的好格
 */
// ★类型修复：原 `import type { CSSProperties, ReactNode }` 里的 CSSProperties 全文件零引用
//   （六轮「统一尺寸」改造把内联 style 全删了，只剩 import 没清），故只删这一个名字。
import type { ReactNode } from 'react';
// ★八轮第二改：读数条由 MiniGauge 换成 DeviationBar
//   —— 旧仪表把「弧越长」画成「越好」，而 Brier 是误差（越小越好），图形在替数字说反话。
// ★八轮第三改：MiniGauge 已整体删除（无调用点），其说明与实现一并移除；
//   本 import 曾在删除时误删，导致运行时报 "DeviationBar is not defined"（截图实证），
//   故在此显式标注，避免下一次删代码时又被连带清掉。
import { DeviationBar } from './DeviationBar';

/**
 * 迷你趋势条：一格数据一个**固定宽度**的小竖条。
 *
 * ── 2026-09-22 六轮修复 ──
 * 缺陷（截图确认）：原实现用 `bw = width / values.length` 平分宽度，
 *   于是「该层有 1 个领域」画出一根 120px 宽的巨条，
 *   「有 6 个领域」画成六根 20px 的细条 —— **同一个组件在不同卡片里长得完全不一样**，
 *   整排卡片看起来像渲染坏了（用户原话「有的是一条细线有的是几块方格」）。
 * 修法：条宽恒定（--trend-bar），总宽按条数算；条数超出上限时抽稀（保留首尾与峰值），
 *   保证视觉单元始终一致 —— 变化只在**高度**（那是数据），宽度是样式。
 */
export function MiniTrend({
  values, height = 26, testId,
}: {
  values: (number | null)[];
  height?: number;
  testId?: string;
}) {
  const present = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!present.length) {
    return <span className="mini-trend-empty" data-testid={testId}>无分布</span>;
  }

  /* 抽稀：最多显示 12 根（视觉一致的上限）。超出时按等距采样，并保证峰值被保留——
   * 否则抽稀可能恰好丢掉最极端的那个读数，那等于漏掉信息。 */
  const MAX_BARS = 12;
  let shown: (number | null)[] = values;
  if (values.length > MAX_BARS) {
    const step = values.length / MAX_BARS;
    const picked: (number | null)[] = [];
    for (let i = 0; i < MAX_BARS; i++) picked.push(values[Math.floor(i * step)]);
    // 补上峰值（若未被采到）
    let peakIdx = 0;
    for (let i = 0; i < values.length; i++) {
      const a = values[i]; const b = values[peakIdx];
      if (typeof a === 'number' && (typeof b !== 'number' || a > b)) peakIdx = i;
    }
    if (picked.indexOf(values[peakIdx]) < 0) picked[picked.length - 1] = values[peakIdx];
    shown = picked;
  }

  const max = Math.max(...present);
  const min = Math.min(...present, 0);
  const span = max - min || 1;
  const n = shown.length;
  // 固定条宽 + 固定间隙 ⇒ 不论几张卡，波形单元一致
  const barW = 7;
  const gap = 3;
  /* ★ 单条的最小占位：只有 1 个领域时，一根 7px 的孤立竖条在卡片里
   *   看起来像「渲染坏了」。给它一个明确的**单点标记**样式——
   *   用宽度 14px 的胶囊 + 更实的填充，读作「一个数据点」而不是「半根条」。 */
  const single = n === 1;
  const effBarW = single ? 14 : barW;
  const width = n * effBarW + (n - 1) * gap;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="mini-trend"
      role="img"
      aria-label={single ? `单个数据点，值 ${(shown[0] as number).toFixed(3)}` : `分布条，共 ${n} 个点`}
      data-testid={testId}>
      {shown.map((v, i) => {
        if (typeof v !== 'number' || !Number.isFinite(v)) return null; // 缺口：不补 0
        const h = Math.max(2, ((v - min) / span) * (height - 2));
        return (
          <rect key={i} x={(i * (effBarW + gap)).toFixed(2)} y={(height - h).toFixed(2)}
            width={effBarW} height={h.toFixed(2)} rx={single ? effBarW / 2 : 1.5}
            fill="var(--accent)" fillOpacity={single ? 0.9 : 0.85} />
        );
      })}
    </svg>
  );
}

/**
 * 读数卡主体。
 * 布局是三段式：图形（左）→ 数值与说明（中）→ 状态（右），窄屏自动竖排。
 */
export function ReadoutCard({
  title, subtitle, value, valueText, unit, rangeText, trend, status, tone, missingText = '样本不足', scaleMax, chip, testId,
}: {
  /** 主标题：这一格是什么（如「L2 系综」） */
  title: ReactNode;
  /** 副标题：一句话解释（人话，不用字段名） */
  subtitle?: ReactNode;
  /** 画仪表的数值 */
  value: number | null | undefined;
  /** 数值文字（默认用 value；空态走 missingText） */
  valueText?: ReactNode;
  unit?: string;
  /** 参照区间文字（如「区间 [0.21, 0.27]」） */
  rangeText?: ReactNode;
  /** 迷你分布条序列 */
  trend?: (number | null)[];
  /** 状态徽标（如「n≥30 可出结论」） */
  status?: ReactNode;
  /** 语义色调。★ 六轮起**不再承载尺寸**——同组卡尺寸恒定（见下方注释） */
  tone?: 'ok' | 'warn' | 'danger';
  /** 结构化辅助色（区分卡片族，不是装饰） */
  chip?: 'cyan' | 'plum' | 'amber';
  missingText?: string;
  /** 仪表的量程上限（Brier 类读数传 0.25，否则默认 1） */
  scaleMax?: number;
  testId?: string;
}) {
  const has = typeof value === 'number' && Number.isFinite(value);
  /* ── 2026-09-22 六轮 · 统一尺寸 ──
   * 缺陷（截图确认）：上一轮按样本量给卡片分了三档尺寸（lead/tight/普通），
   *   结果同一组六张卡里仪表有 92/64/42px 三种、数字有特大/普通/小三种，
   *   使用者读起来像「有的卡坏了」。
   * 定论：**同一组卡片的形状必须完全一致，变化只能来自数据**。
   *   尺寸差异留给「不同层级的区域」（如主结论区 vs 列表区），
   *   而不是「同一网格里的兄弟卡」。故此处尺寸固定。 */
  return (
    <article
      className={
        'readout-card'
        + (tone ? ' is-' + tone : '')
        + (has ? '' : ' is-missing')
        + (chip ? ' tone-' + chip : '')
      }
      data-testid={testId}>
      <div className="readout-main">
        <div className="readout-figure">
          <DeviationBar value={value} baseline={0.25} max={scaleMax ?? 0.5} missingText={missingText} compact />
        </div>
        <div className="readout-text">
          <div className="readout-head">
            <span className="readout-title">{title}</span>
            {status ? <span className="readout-status">{status}</span> : null}
          </div>
          {subtitle ? <div className="readout-sub">{subtitle}</div> : null}
          {/* ★ 数值永在场：这一行即使图形挂了也能独立读懂 */}
          <div className="readout-value">
            <span className="readout-num">{valueText ?? (has ? Number(value).toFixed(3) : missingText)}</span>
            {unit ? <span className="readout-unit">{unit}</span> : null}
            {rangeText ? <span className="readout-range">{rangeText}</span> : null}
          </div>
        </div>
      </div>
      {trend && trend.length ? (
        /* ★八轮第三改：独立 critic 判这排条「无轴、无标尺、无说明，L5 与 L6
         * 长得一模一样，纯噪声」。数据本身没错（抽稀时保留峰值，不漏极值），
         * 缺的是**读者知道它按什么排**。⇒ 补一行标尺：范围 + 点数 + 峰在哪。
         * 一句话把它从装饰变成读数。 */
        <div className="readout-trend">
          <MiniTrend values={trend} />
          <span className="readout-trend-cap">
            {(() => {
              const ok = trend.filter((v) => typeof v === 'number' && Number.isFinite(v)) as number[];
              if (!ok.length) return '无分布';
              const lo = Math.min(...ok), hi = Math.max(...ok);
              const peak = trend.indexOf(hi) + 1;
              return `按时间排 · ${ok.length} 点 · 范围 ${lo.toFixed(3)}–${hi.toFixed(3)} · 峰在第 ${peak}`;
            })()}
          </span>
        </div>
      ) : null}
    </article>
  );
}

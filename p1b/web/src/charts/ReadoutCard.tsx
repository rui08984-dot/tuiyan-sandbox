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
import type { CSSProperties, ReactNode } from 'react';

/** 半圆仪表：弧长＝读数占比，阈值虚线＝参照线
 * ★ 2026-09-22 三轮：数据轨带「引擎启动」扫描动画——从 0 扫到目标值，
 *   像仪表通电后指针弹到位。动画只影响视觉，aria-label 始终是准确值。 */
export function MiniGauge({
  value, lo = 0, hi = 1, threshold, size = 56, missingText = '样本不足', testId,
}: {
  value: number | null | undefined;
  lo?: number; hi?: number;
  threshold?: number;
  size?: number;
  missingText?: string;
  testId?: string;
}) {
  const has = typeof value === 'number' && Number.isFinite(value);
  const t = has ? Math.min(1, Math.max(0, (value - lo) / (hi - lo || 1))) : 0;
  const r = size / 2 - 5;
  const cx = size / 2;
  const cy = size / 2;
  const CIRC = Math.PI * r; // 半圆弧长
  const stroke = 6;

  const thrT = typeof threshold === 'number' ? Math.min(1, Math.max(0, (threshold - lo) / (hi - lo || 1))) : null;

  return (
    <svg width={size} height={size / 2 + 6} viewBox={`0 0 ${size} ${size / 2 + 6}`} role="img"
      className="mini-gauge"
      aria-label={has ? `读数 ${value}` : missingText}
      data-testid={testId}
      style={{ '--arc-circ': CIRC.toFixed(2) } as CSSProperties}>
      {/* 底轨 */}
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none" stroke="var(--panel-3)" strokeWidth={stroke} strokeLinecap="round" />
      {/* 数据轨：通电扫描（sweep-arc 关键帧从 dasharray 0 涨到目标） */}
      {has ? (
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke="var(--accent)" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${(t * CIRC).toFixed(2)} ${CIRC.toFixed(2)}`}
          className="sweep-arc" />
      ) : null}
      {/* 阈值刻度（承载参照语义，不是装饰） */}
      {thrT !== null ? (
        <line
          x1={cx - r * Math.cos(Math.PI * thrT)} y1={cy - r * Math.sin(Math.PI * thrT)}
          x2={cx - (r - stroke) * Math.cos(Math.PI * thrT)} y2={cy - (r - stroke) * Math.sin(Math.PI * thrT)}
          stroke="var(--chart-threshold)" strokeWidth="2" strokeDasharray="2 2" />
      ) : null}
    </svg>
  );
}

/** 迷你趋势条：一排小竖条，形状＝变化（无读数处留缺口，不补 0） */
export function MiniTrend({
  values, width = 120, height = 26, testId,
}: {
  values: (number | null)[];
  width?: number; height?: number;
  testId?: string;
}) {
  const present = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!present.length) {
    return <span className="mini-trend-empty" data-testid={testId}>暂无趋势</span>;
  }
  const max = Math.max(...present);
  const min = Math.min(...present, 0);
  const span = max - min || 1;
  const bw = width / Math.max(values.length, 1);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="mini-trend"
      role="img" aria-label={`趋势条，共 ${values.length} 个点`} data-testid={testId}>
      {values.map((v, i) => {
        if (typeof v !== 'number' || !Number.isFinite(v)) return null; // 缺口：不补 0
        const h = Math.max(1.5, ((v - min) / span) * (height - 2));
        return (
          <rect key={i} x={(i * bw + bw * 0.15).toFixed(2)} y={(height - h).toFixed(2)}
            width={Math.max(1, bw * 0.7).toFixed(2)} height={h.toFixed(2)}
            fill="var(--accent)" fillOpacity="0.85" />
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
  title, subtitle, value, valueText, unit, rangeText, trend, status, tone, missingText = '样本不足', scaleMax, testId,
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
  /** 迷你趋势序列 */
  trend?: (number | null)[];
  /** 状态徽标（如「n≥30 可出结论」） */
  status?: ReactNode;
  tone?: 'ok' | 'warn' | 'danger';
  missingText?: string;
  /** 仪表的量程上限（Brier 类读数传 0.25，否则默认 1）
   *  ★ 不传会按 0..1 缩放——0.19 的读数会画成 19% 弧长，看起来像没数据。 */
  scaleMax?: number;
  testId?: string;
}) {
  const has = typeof value === 'number' && Number.isFinite(value);
  return (
    <article className={'readout-card' + (tone ? ' is-' + tone : '') + (has ? '' : ' is-missing')} data-testid={testId}>
      <div className="readout-main">
        <div className="readout-figure">
          <MiniGauge value={value} hi={scaleMax ?? 1} threshold={0.25} size={64} missingText={missingText} />
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
        <div className="readout-trend">
          <MiniTrend values={trend} />
        </div>
      ) : null}
    </article>
  );
}

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
// ★八轮第二改：读数条由 MiniGauge 换成 DeviationBar
//   —— 旧仪表把「弧越长」画成「越好」，而 Brier 是误差（越小越好），图形在替数字说反话。
import { DeviationBar } from './DeviationBar';

/** 半圆仪表：弧长＝读数占比，阈值虚线＝参照线
 *
 * ── 2026-09-22 五轮 · 去机械化 ──
 * 依据 ui-ux-pro-max chart 域规范（Gauge 条目）：
 *   ① 「Always show numerical value + % of target as text beside chart」
 *   ② 「Performance: Red → Yellow → Green gradient. Target: marker line」
 * 改动：
 *   · 弧线变细（6px → 4.5px）＋ 端点圆帽 → 更接近仪表针脚而非管道
 *   · 数据轨用**青→抹茶渐变**（不是单色块），对应规范里的 gradient 要求
 *   · 末端加一个实心点（读数落点），给「指针停在哪」一个明确的视觉锚
 *   · 底轨改虚线，弱化存在感，让数据轨成为唯一主角
 *   · 阈值刻度保留（承载「无信息线」语义，非装饰）
 */
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
  const r = size / 2 - 6;
  const cx = size / 2;
  const cy = size / 2;
  const CIRC = Math.PI * r;
  const stroke = 4.5;

  const thrT = typeof threshold === 'number' ? Math.min(1, Math.max(0, (threshold - lo) / (hi - lo || 1))) : null;
  // 数据轨末端坐标（用于端点圆点）
  const endAngle = Math.PI * t;
  const endX = cx - r * Math.cos(endAngle);
  const endY = cy - r * Math.sin(endAngle);
  // 渐变 id 需要唯一：用 size + 值派生，避免多仪表互相覆盖
  const gid = `mg-${size}-${Math.round(t * 1000)}`;

  return (
    <svg width={size} height={size / 2 + 6} viewBox={`0 0 ${size} ${size / 2 + 6}`} role="img"
      className="mini-gauge"
      aria-label={has ? `读数 ${value}` : missingText}
      data-testid={testId}
      style={{ '--arc-circ': CIRC.toFixed(2) } as CSSProperties}>
      <defs>
        {/* 青 → 抹茶：冷起暖收，比单色多一层信息（越靠右越接近满值） */}
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--cyan)" />
          <stop offset="100%" stopColor="var(--accent)" />
        </linearGradient>
      </defs>
      {/* 底轨：虚线弱化，像刻度盘上未填充的部分 */}
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none" stroke="var(--panel-3)" strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray="1 5" opacity="0.7" />
      {/* 数据轨：通电扫描 + 渐变描边 */}
      {has && t > 0.001 ? (
        <>
          <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none" stroke={`url(#${gid})`} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${(t * CIRC).toFixed(2)} ${CIRC.toFixed(2)}`}
            className="sweep-arc" />
          {/* 末端锚点：读数停在哪 */}
          <circle cx={endX.toFixed(2)} cy={endY.toFixed(2)} r={stroke / 2 - 0.6}
            fill="var(--accent)" className="gauge-tip" />
        </>
      ) : null}
      {/* 阈值刻度（无信息线） */}
      {thrT !== null ? (
        <line
          x1={cx - r * Math.cos(Math.PI * thrT)} y1={cy - r * Math.sin(Math.PI * thrT)}
          x2={cx - (r - stroke * 1.6) * Math.cos(Math.PI * thrT)} y2={cy - (r - stroke * 1.6) * Math.sin(Math.PI * thrT)}
          stroke="var(--chart-threshold)" strokeWidth="1.6" strokeLinecap="round" />
      ) : null}
    </svg>
  );
}

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
        <div className="readout-trend">
          <MiniTrend values={trend} />
        </div>
      ) : null}
    </article>
  );
}

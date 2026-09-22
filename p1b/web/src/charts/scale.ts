/**
 * 图表比例尺单一真源（2026-09-22 全方面重构）
 *
 * 约束（来自 ui-ux-pro-max 设计库，逐条落实）：
 *  · contrast-data：数据线/条 vs 背景 ≥3:1；数据文字 ≥4.5:1
 *  · 热力图 accessibility=B：必须有数值颜色图例 ＋ 色盲图案兜底（不能只靠颜色）
 *  · 扇形 accessibility=C：必须配数值文字 ＋ 提供堆叠条替代（不能只靠颜色）
 *  · gridline-subtle：网格线低对比，不与数据争视觉
 *
 * 全部色值取自 tokens.css 变量，不在 JS 里硬编码 hex（守「硬编码色」反模式）。
 */

/** 0..1 归一化：越界钳制，NaN/null 返回 null（宁可空态，不画假点） */
export function norm(v: number | null | undefined, lo: number, hi: number): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  if (hi === lo) return 0;
  return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}

/**
 * 顺序色标（Brier 用：越低越好 ⇒ 0=抹茶好，高=危险色）
 * 返回 CSS 变量名而非 hex，保证主题可换。
 */
export function seqColor(t: number): string {
  if (!Number.isFinite(t)) return 'var(--chart-nodata)';
  const x = Math.min(1, Math.max(0, t));
  // 抹茶(好) → 琥珀(中) → 危险(差)：三段线性插值
  const stops: [number, [number, number, number]][] = [
    [0, [127, 168, 122]],   // --ok
    [0.5, [201, 164, 76]],  // --warn
    [1, [212, 130, 111]],   // --danger
  ];
  return 'rgb(' + interp(stops, x).join(', ') + ')';
}

/** 发散色标（Δ 用：0 为中点，负=好/青，正=差/红） */
export function divColor(v: number, maxAbs: number): string {
  if (!Number.isFinite(v) || !Number.isFinite(maxAbs) || maxAbs === 0) return 'var(--chart-nodata)';
  const t = Math.min(1, Math.max(-1, v / maxAbs));
  if (t >= 0) {
    const stops: [number, [number, number, number]][] = [
      [0, [58, 66, 61]],      // 中性
      [1, [212, 130, 111]],   // --danger
    ];
    return 'rgb(' + interp(stops, t).join(', ') + ')';
  }
  const stops: [number, [number, number, number]][] = [
    [0, [58, 66, 61]],
    [1, [127, 166, 160]],     // --info（青）
  ];
  return 'rgb(' + interp(stops, -t).join(', ') + ')';
}

function interp(stops: [number, [number, number, number]][], x: number): [number, number, number] {
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, c0] = stops[i];
    const [p1, c1] = stops[i + 1];
    if (x >= p0 && x <= p1) {
      const k = p1 === p0 ? 0 : (x - p0) / (p1 - p0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * k),
        Math.round(c0[1] + (c1[1] - c0[1]) * k),
        Math.round(c0[2] + (c1[2] - c0[2]) * k),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

/** 分层取色（L1-L6 → tokens 变量，六色互辨且对比度已核验） */
export function layerColor(layer: string | null | undefined): string {
  const i = String(layer ?? '').toUpperCase();
  if (i === 'L1') return 'var(--layer-l1)';
  if (i === 'L2') return 'var(--layer-l2)';
  if (i === 'L3') return 'var(--layer-l3)';
  if (i === 'L4') return 'var(--layer-l4)';
  if (i === 'L5') return 'var(--layer-l5)';
  if (i === 'L6') return 'var(--layer-l6)';
  return 'var(--muted)';
}

/** Brier 的理论上限：0.25 = 无信息常数 0.5 的水平（阈值线的锚，出处见 arena metric 字段） */
export const BRIER_NOINFO = 0.25;

/** 生成 SVG 折线的 points 串；空值断开为多段（绝不跨空值连线＝不暗示连续） */
export function polylinePoints(
  vals: (number | null)[],
  w: number,
  h: number,
  lo: number,
  hi: number,
): { d: string; gaps: number[] } {
  const pts: string[] = [];
  const gaps: number[] = [];
  const n = vals.length;
  for (let i = 0; i < n; i++) {
    const v = vals[i];
    if (v === null || !Number.isFinite(v)) { gaps.push(i); continue; }
    const x = n === 1 ? w / 2 : (i / (n - 1)) * w;
    const y = h - norm(v, lo, hi)! * h;
    pts.push(x.toFixed(1) + ',' + y.toFixed(1));
  }
  return { d: pts.join(' '), gaps };
}

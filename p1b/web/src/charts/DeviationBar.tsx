/** DeviationBar —— 偏差条（2026-09-27 八轮第二改 · 替换 MiniGauge）
 *
 * 【为什么换掉半圆仪表】独立 critic（只看截图，5.5/10）指出三条，本条是最严重的：
 *   ① **弧长语义与数字相反**：仪表把「弧越长」画成「越好」，
 *      而 Brier 是误差——**越小越好**。弧长 0.192/0.25 看着「快满格了」，
 *      实际是「比无信息线好 0.058」。图形在替数字说反话。
 *   ② 同一个半圆在观测台画了 **7 次**（1 主角 + 6 层卡）——装饰的签名，不是数据的签名。
 *   ③ 阈值 0.25 只是一道金色刻度，**无标签、无标尺**，读者不知道它是什么。
 *
 * 【本组件怎么改】
 *   · **以基准为零轴**：把读数画成「相对基准偏了多少」，方向与量一眼可读。
 *     偏差在左（−，优于基准）用青，偏差在右（＋，劣于基准）用砖红——
 *     ★颜色在此是**状态标记**（符合本轮「已落定一律灰、颜色只给状态」的精神）：
 *     优于基准与劣于基准是两种不同的事实，不该同色。
 *   · **基准线自带文字**（「基准 0.25」），不再是一道无名金线。
 *   · 零值时（与基准齐平）落灰——「没有偏离」是常态，不该上色。
 *   · 一根条可承载全部尺寸，替代 7 个仪表 ⇒ 页面少 6 个重复图形。
 *
 * 无障碍：role="img" + aria-label 说完整（「读数 0.192，优于基准 0.25，差 0.058」），
 * 不靠颜色单独承载信息（方向由条的位置本身表达，色觉障碍亦可读）。
 */
import type { CSSProperties } from 'react';

export function DeviationBar({
  value, baseline = 0.25, max, missingText = '样本不足', testId, compact = false,
}: {
  value: number | null | undefined;
  /** 基准线（默认 0.25＝「一律报五成」的无信息线）。 */
  baseline?: number;
  /** 量程上限，默认取 baseline*2（左右对称，零轴居中）。 */
  max?: number;
  missingText?: string;
  testId?: string;
  compact?: boolean;
}) {
  const has = typeof value === 'number' && Number.isFinite(value);
  const hi = max ?? baseline * 2;
  const span = hi || 1;

  if (!has) {
    return (
      <p className="devbar-missing" data-testid={testId}>
        <span className="is-unmeasured" aria-hidden="true" />{missingText}
      </p>
    );
  }

  const dev = value - baseline;
  // 半宽归一：dev>0 画右半，dev<0 画左半；0 落中轴
  const ratio = Math.max(-1, Math.min(1, dev / (span / 2)));
  const pct = Math.abs(ratio) * 50;           // 相对整条（100%）的宽度
  const side = dev > 0 ? 'right' : dev < 0 ? 'left' : 'mid';
  const better = dev < 0;                      // 误差：低于基准＝更好
  const state = dev === 0 ? 'mid' : better ? 'better' : 'worse';
  const shown = Math.abs(dev).toFixed(3).replace(/^0$/, '0');

  const label =
    `读数 ${value.toFixed(4)}，${dev === 0 ? '与基准持平' : better ? '优于' : '劣于'}基准 ${baseline}，相差 ${shown}`;

  return (
    <div className={'devbar' + (compact ? ' devbar--compact' : '')} data-testid={testId}>
      <div className="devbar-track" role="img" aria-label={label}>
        <span className="devbar-axis" aria-hidden="true" />
        <span
          className={'devbar-fill is-' + state + ' is-' + side}
          style={{ width: pct + '%' } as CSSProperties}
          aria-hidden="true"
        />
      </div>
      {!compact ? (
        <div className="devbar-cap">
          <span className={'devbar-delta is-' + state}>{dev > 0 ? '+' : dev < 0 ? '−' : '±'}{shown}</span>
          <span className="devbar-base">基准 {baseline}</span>
        </div>
      ) : null}
    </div>
  );
}

export default DeviationBar;

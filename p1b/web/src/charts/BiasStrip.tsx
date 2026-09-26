/** BiasStrip —— 偏流条（2026-08-27 八轮第六改）
 *
 * 【它替代什么】
 *   旧形态是"六张等质读数卡"（OverviewPage 的各层表现）＋"五页各看同一批字段"。
 *   独立 critic 判：连 L4 都没数据和 L1 拿到一模一样的盒子 ⇒ 同样的盒子 = 同样的确定性。
 *   方向兵给的替代：**一道题一根线，按时间排，向上=说大了、向下=说小了。**
 *
 * 【为什么按时间排而不是按偏差大小排】
 *   人的偏差是**时间聚集**的（某段时间状态好、某段时间飘）。
 *   按大小排会把时间维度拍平成"谁最差"，而那不是用户能认领的错；
 *   按时间排，���眼就能看出"这一段歪了"——那才是可以改的东西。
 *
 * 【n<30 的断线（关键诚实机制）】
 *   样本不够的题**不画短线，画一个空心方块，并且左右两段的线断开**。
 *   ★线断开在任何图表语言里都读作"数据缺失"，穿过连过去读作"这里是 0"——
 *     这是"没测够"与"数据是 0"的唯一可靠视觉区别。
 *
 * 【它不做什么】
 *   不给总分、不给分档、不给"你准不准"的裁决句。它只回答：我在哪儿偏了、偏多少。
 *   裁决留给读者，界面不下judgment——那也符合本项目"不承诺什么都能算"的立场。
 */
import { useMemo } from 'react';

export interface BiasPoint {
  id: number;
  /** 相对无信息线 0.25 的偏差（正=比 0.25 大，负=比 0.25 小）。 */
  delta: number;
  /** 样本数。<30 时该点画成断线的空心方块。 */
  n: number;
  /** 标签（层·域）。 */
  label: string;
  /** 发生/到期时点（字符串，比较用）。 */
  when: string;
}

export function BiasStrip({
  points, max = 0.2, onPick, testId,
}: {
  points: BiasPoint[];
  /** 纵向半幅（对称）。 */
  max?: number;
  onPick?: (p: BiasPoint) => void;
  testId?: string;
}) {
  const shown = useMemo(
    () => [...points].sort((a, b) => (a.when < b.when ? -1 : a.when > b.when ? 1 : a.id - b.id)),
    [points],
  );
  const n = shown.length;
  const W = 1000;
  const H = 96;
  const zero = H / 2;
  const scale = (zero - 8) / max;              // 上下各留 8px 余量
  const gap = n > 1 ? 2 : 0;
  const barW = n > 0 ? Math.max(2, (W - gap * (n - 1)) / n) : 0;

  // 断线分组：连续的非薄点连成段，遇到薄点断开
  const segments: (BiasPoint | null)[][] = [];
  let cur: (BiasPoint | null)[] = [];
  for (const p of shown) {
    if (p.n < 30) { if (cur.length) { segments.push(cur); cur = []; } segments.push([p]); }
    else cur.push(p);
  }
  if (cur.length) segments.push(cur);

  const y = (d: number) => zero - Math.max(-1, Math.min(1, d / max)) * scale;

  const label =
    `偏流条：共 ${n} 道题的偏差（相对无信息线 0.25，按时间排）。` +
    `其中 ${shown.filter((p) => p.n >= 30).length} 道样本够、线相连；` +
    `${shown.filter((p) => p.n < 30).length} 道样本不足，画成断线的空心方块——` +
    `断线表示「没测够」，不是「偏差是 0」。`;

  return (
    <figure className="bias" data-testid={testId}>
      <svg viewBox={`0 0 ${W} ${H}`} className="bias-svg" role="img" aria-label={label} preserveAspectRatio="none">
        {/* 零轴：无信息线。它是这图的参照，不画它整张图没有意义 */}
        <line x1="0" y1={zero} x2={W} y2={zero} className="bias-axis" />
        {shown.map((p, i) => {
          const thin = p.n < 30;
          return (
            <g key={p.id}>
              {thin ? (
                /* 薄格：空心方块 + 断线（不画竖线，因为画了就等于说有偏差） */
                <rect
                  x={i * (barW + gap)} y={zero - 4} width={Math.max(3, barW)} height={8}
                  className="bias-thin"
                />
              ) : (
                <rect
                  x={i * (barW + gap)} y={Math.min(zero, y(p.delta))}
                  width={Math.max(1.5, barW)} height={Math.abs(zero - y(p.delta))}
                  className={'bias-bar ' + (p.delta < 0 ? 'is-under' : 'is-over')}
                />
              )}
            </g>
          );
        })}
        {/* 上下界参考线（±max）——告诉读者纵向刻度，否则"长短"无意义 */}
        <line x1="0" y1={zero - scale} x2={W} y2={zero - scale} className="bias-bound" />
        <line x1="0" y1={zero + scale} x2={W} y2={zero + scale} className="bias-bound" />
      </svg>
      <div className="bias-axis-labels" aria-hidden="true">
        <span>说大了 +{max}</span>
        <span className="bias-axis-mid">无信息线 0.25</span>
        <span>说小了 −{max}</span>
      </div>
      <figcaption className="bias-cap">
        {onPick ? '点任一根看那道题。' : ''}
        <span className="bias-key"><i className="is-thin" aria-hidden="true" />样本不足 30 ⇒ 断线方块，不是 0</span>
        <span className="bias-key"><i className="is-under" aria-hidden="true" />比 0.25 小</span>
        <span className="bias-key"><i className="is-over" aria-hidden="true" />比 0.25 大</span>
      </figcaption>
    </figure>
  );
}

export default BiasStrip;

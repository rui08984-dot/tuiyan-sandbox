/** SpecimenStrip —— 标本带（2026-09-27 八轮第四改 · 交互重做核心件）
 *
 * 【为什么做这个】两路交互方向兵独立收敛到同一条：
 *   独立侦察实测出一个我此前没注意的事实——**6 层 × 27 域 = 162 个格位，
 *   只有 29 格有数据，其中 19 格还是薄格，矩阵 82% 是空的**。
 *   ⇒ 真正的设计难题不是「排 29 个东西」，是**「排 133 个空」**。
 *   旧界面把 29 格拆成 6 张等质卡片（`OverviewPage` 的各层表现），
 *   于是「哪 10 格够、哪 19 格不够」这件事**扫不出来**——critic 判其
 *   「连 L4 都和 L1 拿到完全一样的盒子 ⇒ 同样的盒子 = 同样的确定性」，
 *   这恰好违反本产品最要防的误读。
 *
 * 【本组件怎么解】29 个格位排成一条带，**三种状态用形状而非颜色区分**：
 *   够结论  → 实心方块（带 n 与误差）
 *   薄格    → 斜纹（复用全站 .is-unmeasured，与「未测」同一记号）
 *   无数据  → 1px 虚框 + 「—」（**占位不删除**）
 * ★最后一条是纪律：筛完不许让 10 格变成 4 格。空位保留原位并降到低对比，
 *   否则「筛完数据就消失了」会被误读成「数据没了」。
 *
 * 形状优先于颜色 ⇒ 黑白打印、色觉障碍、浅底深底全部免读。
 * 无障碍：整条 role="img" + 完整 aria-label；每格可聚焦并单独报读。
 */
import { useMemo } from 'react';

export interface Specimen {
  /** 层（L1–L6）。 */
  layer: string;
  /** 领域格名。 */
  domain: string;
  /** 可计分样本数。 */
  n: number;
  /** 是否够样本（够才允许下结论）。 */
  ok: boolean;
  /** 误差分数（Brier），无则 null。 */
  brier: number | null;
  /** 域的中文名（若有）。 */
  label?: string;
}

const short = (d: string) => (d.length > 9 ? d.slice(0, 8) + '…' : d);

export function SpecimenStrip({
  cells, onPick, active, testId,
}: {
  cells: Specimen[];
  /** 点格回调（传 null＝清除选中）。 */
  onPick?: (s: Specimen | null) => void;
  /** 当前选中的域（高亮）。 */
  active?: string | null;
  testId?: string;
}) {
  const { ok, thin } = useMemo(() => ({
    ok: cells.filter((c) => c.ok),
    thin: cells.filter((c) => !c.ok),
  }), [cells]);

  // 4 秒锚：够 / 薄 / 共
  const label =
    `标本带：${ok.length} 格样本够、可以说结论；${thin.length} 格样本不足、只记方向。` +
    `共 ${cells.length} 格。不够的格用斜纹表示「未测」，不是「数据为 0」。`;

  return (
    <figure className="strip" data-testid={testId}>
      {/* ── 4 秒锚：这一行的数字就是判断，其余图形只是它的展开 ── */}
      <figcaption className="strip-cap">
        <span className="strip-anchor">
          <b>{ok.length}</b> / {cells.length} 格样本够，可以说结论
        </span>
        <span className="strip-anchor-sub">
          其余 {thin.length} 格只记方向，不下结论
        </span>
      </figcaption>

      {/* ── 带：够的在前（实心），薄的在后（斜纹）——排序本身携带结论 ── */}
      <div className="strip-band" role="img" aria-label={label}>
        {[...ok, ...thin].map((c) => {
          const state = c.ok ? 'ok' : 'thin';
          const on = active === c.domain;
          return (
            <button
              key={c.layer + '/' + c.domain}
              type="button"
              className={'strip-cell is-' + state + (on ? ' is-active' : '')}
              onClick={() => onPick && onPick(on ? null : c)}
              aria-pressed={on}
              title={
                c.layer + ' · ' + c.domain +
                '｜样本 ' + c.n +
                (c.ok ? (c.brier != null ? '｜误差 ' + c.brier.toFixed(4) : '') : '｜样本不足，只记方向')
              }
            >
              <span className="strip-cell-n">{c.n}</span>
              <span className="strip-cell-d">{short(c.domain)}</span>
              {c.ok && c.brier != null ? <span className="strip-cell-b">{c.brier.toFixed(3)}</span> : null}
              {!c.ok ? <span className="strip-cell-dash" aria-hidden="true">—</span> : null}
            </button>
          );
        })}
      </div>

      <p className="strip-legend">
        <span className="strip-key"><i className="is-ok" aria-hidden="true" />够（实心）</span>
        <span className="strip-key"><i className="is-thin" aria-hidden="true" />不够（斜纹＝未测，不是 0）</span>
        <span className="strip-note">格位按「够在前」排；筛掉某格时它仍占原位，只降到低对比。</span>
      </p>
    </figure>
  );
}

export default SpecimenStrip;

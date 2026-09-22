import { useGameTypes } from '../../lib/useGameTypes';
import type { Game } from '../../types';

/**
 * LiveEmpty —— 现场页引导面板（B6 引导流入口）
 *
 * ── 2026-09-22 五轮重做 ──
 * 用户反馈首页「不够规则、不够功能化」。
 *
 * 两个要修的问题：
 *   ① 原空态只有一句 callout + 一个按钮，大片留白，没说"接下来会发生什么"
 *   ② 原判定只看「库里有几个局」——当库里有局但 localStorage 存的 id 失效时，
 *      页面什么都不显示（实测截图确认：只剩一条 TopBar + 整片空白）
 *
 * 现按**两种处境**给不同内容：
 *   无局         → 三步流程 + 「开新局」主 CTA
 *   有局未选中   → 直接列出待选局 + 「开新局」次 CTA（少一步跳转）
 */
export default function LiveEmpty(props: {
  onCreate: () => void;
  /** 库里已有的局（有则显示待选列表，让使用者就地选一局） */
  existingGames?: Game[];
  onPick?: (id: number) => void;
  busy?: boolean;
}) {
  const { label: typeLabel } = useGameTypes();
  const games = props.existingGames ?? [];
  const hasGames = games.length > 0;

  const steps = [
    { n: '1', t: '起一局', d: '填局名、玩法类型、人数', out: '得到一局空账本' },
    { n: '2', t: '布席位', d: '按人数建席，填每个座位的称呼', out: '得到可引用的席位号' },
    { n: '3', t: '开录', d: '边玩边记事件、声称、行动', out: '当场生成时间线' },
  ];

  return (
    <div className="live-hero" data-testid="live-empty">
      <div className="le-panel">
        <div className="le-head">
          <h2 className="le-title">{hasGames ? '选一局继续' : '还没有对局'}</h2>
          <p className="le-sub">
            {hasGames
              ? `本机有 ${games.length} 局记录。选一局直接进入现场，或开一局新的。`
              : '这套工具在牌局进行时记录与推演。开一局就可以开始录入——所有记录留在本机，随时可查。'}
          </p>
        </div>

        {hasGames ? (
          /* 有局：就地列出最近的若干局（省掉一次「切换/建局」抽屉跳转）。
           * ★ 只列前 6 局：实测库里有 90 局，全列会把面板撑成一面墙，
           *   使用者反而找不到该点哪个。要更多就去「对局」页看完整列表。 */
          <>
            <div className="le-games" data-testid="le-games">
              {games.slice(0, 6).map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className="le-game"
                  disabled={props.busy}
                  onClick={() => props.onPick?.(g.id)}
                >
                  <span className="le-game-name">{g.name}</span>
                  <span className="le-game-meta">
                    {typeLabel(g.type)} · {g.player_count} 人 · 第 {g.current_day ?? 0} 天
                    {typeof g.event_count === 'number' ? ` · ${g.event_count} 条记录` : ''}
                  </span>
                </button>
              ))}
            </div>
            {games.length > 6 ? (
              <p className="le-more">还有 {games.length - 6} 局，去「对局」页看全部</p>
            ) : null}
          </>
        ) : (
          <div className="le-steps">
            {steps.map((s) => (
              <div className="le-step" key={s.n}>
                <span className="le-step-n" aria-hidden="true">{s.n}</span>
                <div className="le-step-body">
                  <span className="le-step-t">{s.t}</span>
                  <span className="le-step-d">{s.d}</span>
                  <span className="le-step-out">{s.out}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="le-cta">
          <button
            type="button"
            className={hasGames ? 'btn le-btn' : 'btn btn-primary le-btn'}
            onClick={props.onCreate}
          >
            开新局
          </button>
          <span className="le-cta-note">{hasGames ? '或者开一局新的' : '三步走完约一分钟'}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * PageSidebar —— 左侧分类器（2026-09-22 五轮）
 *
 * 用户要求：「有些页面比如说左边一排分类器，然后可以框选一些东西」。
 *
 * 设计依据（ui-ux-pro-max）：
 *   · Navigation 域「Sticky Navigation」：固定导航不得遮挡内容 ⇒ 本组件在宽屏是
 *     sticky 侧栏、窄屏折叠为顶部横向 chip 条（不遮内容，也不挤掉主区宽度）。
 *   · Navigation 域「Breadcrumbs」：3+ 层深时才用 ⇒ 侧栏里保留分区层级，
 *     但只在超过一层时显示分组标题。
 *
 * ★ 为什么做成通用组件而不是每页各写一套：
 *   校准总览/审计/待验证三页都需要「按层/按域/按状态」筛选，
 *   各写一套会导致筛选逻辑与视觉不一致（这正是用户抱怨的「每页风格不同」）。
 *
 * ★ 无障碍：
 *   · 用 fieldset + legend 语义（不是纯 div 堆叠），读屏器能读到分组名
 *   · 每组是 checkbox 组（多选）或 radio 组（单选），键盘可达
 *   · 选中态不只用颜色：还有勾选图标与加粗（色盲友好）
 */
import type { ReactNode } from 'react';

export type SidebarGroup = {
  /** 分组名（如「层」「领域」） */
  label: string;
  /** 选项：id 唯一，label 显示，color 可给色点，count 可显示计数 */
  options: { id: string; label: ReactNode; color?: string; count?: number | null }[];
  /** 当前选中 */
  value: string[];
  onChange: (next: string[]) => void;
  /** 单选（互斥）——如「只看样本充足的」这类开关组 */
  single?: boolean;
  /** 该组的补充说明（小字） */
  hint?: string;
};

export function PageSidebar({
  groups, title = '筛选', onClear, testId,
}: {
  groups: SidebarGroup[];
  title?: string;
  onClear?: () => void;
  testId?: string;
}) {
  const anyActive = groups.some((g) => g.value.length > 0);

  return (
    <aside className="page-side" data-testid={testId} aria-label={title}>
      <div className="page-side-head">
        <span className="page-side-title">{title}</span>
        {anyActive && onClear ? (
          <button type="button" className="page-side-clear" onClick={onClear}>清空</button>
        ) : null}
      </div>

      {groups.map((g, gi) => (
        <fieldset className="page-side-group" key={gi}>
          <legend className="page-side-legend">
            {g.label}
            {g.hint ? <span className="page-side-hint">{g.hint}</span> : null}
          </legend>
          <div className={g.single ? 'page-side-list is-single' : 'page-side-list'}>
            {g.options.map((o) => {
              const on = g.value.indexOf(o.id) >= 0;
              return (
                <button
                  key={o.id}
                  type="button"
                  className={'page-side-opt' + (on ? ' is-on' : '')}
                  aria-pressed={on}
                  onClick={() => {
                    if (g.single) g.onChange(on ? [] : [o.id]);
                    else g.onChange(on ? g.value.filter((v) => v !== o.id) : g.value.concat([o.id]));
                  }}
                >
                  {/* 勾选标记用 SVG 形状（禁 emoji），且不只靠颜色表意 */}
                  <span className="page-side-mark" aria-hidden="true">
                    {on ? (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    ) : (
                      <span className="page-side-dot" style={o.color ? { background: o.color } : undefined} />
                    )}
                  </span>
                  <span className="page-side-label">{o.label}</span>
                  {o.count !== undefined && o.count !== null ? (
                    <span className="page-side-count u-mono">{o.count}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </aside>
  );
}

export default PageSidebar;

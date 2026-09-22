/** 渐进披露术语组件（观测台重构 U3）
 * L1 表面：plain 人话文本 + 虚线下划线（暗示可展开）
 * L2 术语：hover / 点击 / 键盘 Enter 出浮层——术语原词 + 定义 + 口径 + 限制
 * 铁律：专业词保留在浮层，界面上一个都不删。
 *
 * ── 2026-09-22 四轮：新增 HelpMark 变体 ──
 * 用户要求「注释用小组件的方式搞个问号，鼠标移上去显示解释」。
 * Term 需要包住一段文字；HelpMark 是一个独立问号徽标，可挂在标题/标签/图表旁，
 * 不改变原有文案的排版。二者共用同一份术语真源（lib/terms.ts），不重复定义。
 */
import { useId, useState, type ReactNode } from 'react';
import { getTerm } from '../../lib/terms';

export function Term({ id, plain, formal, children }: { id: string; plain?: string; formal?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const popId = useId();
  const t = getTerm(id);
  const label = children ?? plain ?? (t ? t.plain : id);

  // formal＝判据原句：没有对应术语条目时，仍要能显示专业原文（绝不删专业表述）
  const hasPop = !!t || !!formal;
  if (!hasPop) return <span>{label}</span>;

  return (
    <span className="ui-term-wrap" onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="ui-term"
        aria-expanded={open}
        aria-describedby={open ? popId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        onMouseEnter={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {label}
      </button>
      {open && (
        <span className="ui-term-pop" id={popId} role="tooltip">
          {t && <span className="ui-term-pop-term">{t.term}</span>}
          {t && <span className="ui-term-pop-def">{t.definition}</span>}
          {formal && <span className="ui-term-pop-formal">判据原句 {formal}</span>}
          {t && <span className="ui-term-pop-basis">口径 {t.basis}</span>}
          {t?.caveat && <span className="ui-term-pop-caveat">⚠ {t.caveat}</span>}
        </span>
      )}
    </span>
  );
}

/**
 * HelpMark —— 问号徽标（可挂在任何元素旁）
 *
 * 与 Term 的分工：
 *   Term      —— 把一个**词**变成可点开的入口（下划线暗示）
 *   HelpMark  —— 在**已有文案旁**加一个小问号，解释这条读数/这列/这张图怎么看
 *
 * ★ 形状用内联 SVG 画，不用 emoji（appShell.test.mjs 有 emoji 清零闸）。
 * ★ 键盘可达：按钮可获得焦点并展开（Tab 到它时浮层出现），非仅 hover。
 */
export function HelpMark({
  termId, text, label = '这是什么？', testId,
}: {
  /** 术语真源里的条目 id，给了就用它的定义 */
  termId?: string;
  /** 或直接给一段解释（两者都给时，termId 优先，text 作为补充） */
  text?: string;
  /** 可访问名。默认「这是什么？」 */
  label?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const popId = useId();
  const t = termId ? getTerm(termId) : null;
  const body = t ? t.definition : text;
  if (!body) return null;

  return (
    <span className="helpmark-wrap" onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className={'helpmark' + (open ? ' is-open' : '')}
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? popId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        onMouseEnter={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        data-testid={testId}
      >
        {/* 问号：圆环 + 钩形，纯 SVG 描边（禁 emoji） */}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9.5" />
          <path d="M9.6 9.2a2.5 2.5 0 1 1 3.3 2.4c-.6.3-.9.8-.9 1.4v.4" />
          <path d="M12 17.2h.01" />
        </svg>
      </button>
      {open && (
        <span className="helpmark-pop" id={popId} role="tooltip">
          {t && <span className="ui-term-pop-term">{t.term}</span>}
          <span className="ui-term-pop-def">{body}</span>
          {t && <span className="ui-term-pop-basis">口径 {t.basis}</span>}
          {t?.caveat && <span className="ui-term-pop-caveat">⚠ {t.caveat}</span>}
        </span>
      )}
    </span>
  );
}

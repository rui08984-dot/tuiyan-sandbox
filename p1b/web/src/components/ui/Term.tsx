/** 渐进披露术语组件（观测台重构 U3）
 * L1 表面：plain 人话文本 + 虚线下划线（暗示可展开）
 * L2 术语：hover / 点击 / 键盘 Enter 出浮层——术语原词 + 定义 + 口径 + 限制
 * 铁律：专业词保留在浮层，界面上一个都不删。
 */
import { useId, useState, type ReactNode } from 'react';
import { getTerm } from '../../lib/terms';

export function Term({ id, plain, children }: { id: string; plain?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const popId = useId();
  const t = getTerm(id);
  const label = children ?? plain ?? (t ? t.plain : id);

  if (!t) return <span>{label}</span>;

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
          <span className="ui-term-pop-term">{t.term}</span>
          <span className="ui-term-pop-def">{t.definition}</span>
          <span className="ui-term-pop-basis">口径 {t.basis}</span>
          {t.caveat && <span className="ui-term-pop-caveat">⚠ {t.caveat}</span>}
        </span>
      )}
    </span>
  );
}

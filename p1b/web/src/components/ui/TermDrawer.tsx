/** 术语表抽屉（观测台重构 U4）—— 渐进披露 L3 全量层：全站术语可搜
 * 铁律：术语只收进第二/三层，界面上一个都不删。
 */
import { useMemo, useState } from 'react';
import { TERMS } from '../../lib/terms';
import { IconClose, IconBook } from './index';

export function TermDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const all = Object.values(TERMS);
    const kw = q.trim().toLowerCase();
    if (!kw) return all;
    return all.filter((t) =>
      (t.term + t.plain + t.definition + t.basis).toLowerCase().indexOf(kw) >= 0);
  }, [q]);

  if (!open) return null;

  return (
    <div className="ui-drawer-backdrop" onClick={onClose}>
      <aside
        className="ui-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="术语表"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      >
        <header className="ui-drawer-head">
          <span className="ui-drawer-title"><IconBook size={16} /> 术语表</span>
          <button type="button" className="ui-drawer-close" onClick={onClose} aria-label="关闭术语表">
            <IconClose size={16} />
          </button>
        </header>
        <input
          className="ui-drawer-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜术语／人话／口径"
          aria-label="搜索术语"
        />
        <div className="ui-drawer-list">
          {rows.map((t) => (
            <div className="ui-drawer-item" key={t.id}>
              <div className="ui-drawer-item-head">
                <span className="ui-drawer-term">{t.term}</span>
                <span className="ui-drawer-plain">{t.plain}</span>
              </div>
              <p className="ui-drawer-def">{t.definition}</p>
              <p className="ui-drawer-basis">口径 {t.basis}</p>
              {t.caveat && <p className="ui-drawer-caveat">⚠ {t.caveat}</p>}
            </div>
          ))}
          {rows.length === 0 && <p className="ui-drawer-empty">没匹配到术语</p>}
        </div>
      </aside>
    </div>
  );
}

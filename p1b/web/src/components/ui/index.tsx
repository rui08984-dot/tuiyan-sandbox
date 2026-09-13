/**
 * UI 组件基座（UI 重构 §5；自研，不引 UI 库）——
 * StatCard / Badge / KVTable / Tabs / Breadcrumb / AlertBar / EmptyState。
 * 图标=内联 SVG（Lucide 路径），**emoji 图标清零**；全部吃 styles/tokens.css + styles/ui.css。
 */
import { useState, type ReactNode } from 'react';
import '../../styles/ui.css';

type IconProps = { size?: number };
/** 极简 SVG 包装：d 用 | 分隔多条 path；stroke=currentColor */
const S = (d: string, size: number) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
);
export const IconChart = ({ size = 16 }: IconProps) => S('M3 3v18h18|M7 15l4-5 3 3 5-7', size);
export const IconPen = ({ size = 16 }: IconProps) => S('M12 20h9|M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z', size);
export const IconAlert = ({ size = 16 }: IconProps) => S('M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z|M12 9v4|M12 17h.01', size);
export const IconClock = ({ size = 16 }: IconProps) => S('M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z|M12 6v6l4 2', size);
export const IconInbox = ({ size = 16 }: IconProps) => S('M22 12h-6l-2 3h-4l-2-3H2|M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1Z', size);
export const IconLayers = ({ size = 16 }: IconProps) => S('M12 2 2 7l10 5 10-5-10-5Z|M2 17l10 5 10-5|M2 12l10 5 10-5', size);
export const IconShield = ({ size = 16 }: IconProps) => S('M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z', size);
export const IconTarget = ({ size = 16 }: IconProps) => S('M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z|M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z|M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z', size);
export const IconArrow = ({ size = 16 }: IconProps) => S('M5 12h14|M12 5l7 7-7 7', size);
export const IconGear = ({ size = 16 }: IconProps) => S('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z|M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 19a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z', size);
export const IconCompass = ({ size = 16 }: IconProps) => S('M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z|M16.2 7.8l-2.1 6.3-6.3 2.1 2.1-6.3 6.3-2.1Z', size);
export function StatCard({ label, value, caption, tone, testId }: {
  label: ReactNode; value: ReactNode; caption?: ReactNode; tone?: 'accent' | 'warn' | 'danger'; testId?: string;
}) {
  return (
    <div className={'ui-stat' + (tone ? ' is-' + tone : '')} data-testid={testId}>
      <span className="ui-stat-label">{label}</span>
      <span className="ui-stat-value">{value}</span>
      {caption ? <span className="ui-stat-caption">{caption}</span> : null}
    </div>
  );
}

export function Badge({ children, tone, testId }: { children: ReactNode; tone?: string; testId?: string }) {
  return <span className={'ui-badge' + (tone ? ' is-' + tone : '')} data-testid={testId}>{children}</span>;
}

export function KVTable({ rows, testId }: { rows: { k: ReactNode; v: ReactNode }[]; testId?: string }) {
  return (
    <div className="ui-kv" data-testid={testId}>
      {rows.map((r, i) => (
        <div className="ui-kv-row" key={i}>
          <span className="ui-kv-key">{r.k}</span>
          <span className="ui-kv-val">{r.v}</span>
        </div>
      ))}
    </div>
  );
}

export function Tabs({ tabs, testId }: { tabs: { id: string; label: ReactNode; content: ReactNode }[]; testId?: string }) {
  const [active, setActive] = useState(tabs.length ? tabs[0].id : '');
  const cur = tabs.filter((t) => t.id === active)[0] || tabs[0];
  return (
    <div data-testid={testId}>
      <div className="ui-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} type="button" className="ui-tab" role="tab" aria-selected={t.id === active}
            onClick={() => setActive(t.id)}>{t.label}</button>
        ))}
      </div>
      <div className="ui-tabpanel" role="tabpanel">{cur ? cur.content : null}</div>
    </div>
  );
}

export function Breadcrumb({ items, testId }: { items: { label: ReactNode; current?: boolean }[]; testId?: string }) {
  return (
    <nav className="ui-crumbs" data-testid={testId} aria-label="面包屑">
      {items.map((it, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {i > 0 ? <span className="ui-crumb-sep" aria-hidden>/</span> : null}
          <span className={'ui-crumb' + (it.current ? ' is-current' : '')}>{it.label}</span>
        </span>
      ))}
    </nav>
  );
}

export function AlertBar({ alerts, testId }: { alerts: { tone: string; text: ReactNode }[]; testId?: string }) {
  if (!alerts.length) return null;
  return (
    <div className="ui-alertbar" data-testid={testId} role="status">
      {alerts.map((a, i) => (
        <div className={'ui-alert is-' + a.tone} key={i}><span className="ui-alert-dot" aria-hidden />{a.text}</div>
      ))}
    </div>
  );
}

export function EmptyState({ text, testId }: { text: ReactNode; testId?: string }) {
  return <div className="ui-empty" data-testid={testId}><IconInbox size={22} /><span>{text}</span></div>;
}

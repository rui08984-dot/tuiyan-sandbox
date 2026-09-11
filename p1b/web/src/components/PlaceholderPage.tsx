import type { ReactNode } from 'react';

interface Props {
  icon: string;
  title: string;
  phase: string;
  children: ReactNode;
}

/** 占位页壳：本轮只保证 Tab 导航真实可用，具体功能由 P1b-3 / P1b-4 填充。 */
export function PlaceholderPage({ icon, title, phase, children }: Props) {
  return (
    <section className="page">
      <header className="page-head">
        <span className="page-icon" aria-hidden>{icon}</span>
        <h1>{title}</h1>
      </header>
      <div className="callout">
        <p className="callout-title">🚧 {phase} 施工中</p>
        <div className="callout-body">{children}</div>
      </div>
    </section>
  );
}

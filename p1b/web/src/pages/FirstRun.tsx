/**
 * 首访两条常驻条（SPEC-first-run-ux）：① 引导只指路 ② 归属说明账本里的数据是谁的。
 *
 * ★判定一律在 lib/firstRun.ts（本项目禁 jsdom，组件级渲染测不了；能测的必须是纯函数）。
 *   本文件只做两件事：读本机标记、把文案画出来。
 * ★挂载点在壳层（App.tsx 的 <main> 内、页面容器之外）⇒ **任何页面都可见**，
 *   且不随路由切换重挂（归属条不会每切一页重取一次）。
 */
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  GUIDE_STEPS, guideStepFor, readGuideOff, writeGuideOff, ownershipLine, stepShift,
} from '../lib/firstRun';
import { ensureVisitorId } from '../lib/visitor';

/** 归属常驻条。取不到时**照样渲染**（说明读不出来）——常驻条空着＝"没这一行"，那是在骗人。 */
export function OwnershipBar() {
  const [o, setO] = useState<{ c: { mine: number; corpus: number; others: number; total: number }; minN: number } | null>(null);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    let alive = true;
    void ensureVisitorId()
      .then((vid) => fetch('/api/analytics/questions?view=mine&limit=1'
        + (vid ? '&visitor_id=' + encodeURIComponent(vid) : '')))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!alive) return; if (j && j.counts) setO({ c: j.counts, minN: j.min_n }); else setBad(true); })
      .catch(() => { if (alive) setBad(true); });
    return () => { alive = false; };
  }, []);
  return (
    <p className="own-bar" data-testid="own-bar" data-state={bad ? 'failed' : o ? 'ok' : 'loading'}>
      {bad ? '这一行说明账本里的数据是谁的——现在读不出来（后端没响应）。'
        : o ? ownershipLine(o.c, o.minN)
          : '在读「账本里的数据是谁的」…'}
    </p>
  );
}

/** 引导条：一行、可折叠、不遮挡；`×` 关掉即本机永不再现。 */
export function FirstRun() {
  const { pathname } = useLocation();
  const [off, setOff] = useState(readGuideOff);
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  if (off) return null;
  const s = GUIDE_STEPS[i];
  const here = guideStepFor(pathname);
  return (
    <div className="fr-bar" data-testid="first-run">
      <button type="button" className="fr-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        第 {s.n} 步 / 共 {GUIDE_STEPS.length} 步：{s.title}
        {here ? <span className="fr-here">（你正在这一页）</span> : null}
      </button>
      {open ? (
        <p className="fr-how">
          {s.how} <Link to={s.path}>去这一页</Link>
        </p>
      ) : null}
      <span className="fr-nav">
        <button type="button" aria-label="上一步" onClick={() => setI((v) => stepShift(v, -1))}>←</button>
        <button type="button" aria-label="下一步" onClick={() => setI((v) => stepShift(v, 1))}>→</button>
        <button type="button" aria-label="不再显示引导"
          onClick={() => { writeGuideOff(); setOff(true); }}>×</button>
      </span>
    </div>
  );
}

export default FirstRun;

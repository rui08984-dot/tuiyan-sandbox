/**
 * P1b 应用壳（UI 重构步 1+2，2026-09-14）：HashRouter —— 后端静态托管 dist，无需 SPA fallback。
 * 导航收敛为四组「概览／接题／对局／审计」+ 右侧工具（排盘／设置）；容器按页分类
 * （数据页 .content--wide 1280 ／ 表单页 .content--form 720 ／ 其余 860 阅读宽）。
 * 路由全兼容：/live→/、/games→/manage、/input|/advisor→/、*→/（一个不破）。
 */
import { useEffect, useRef, useState } from 'react';
import { HashRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import LivePage from './pages/LivePage';
import ManagePage from './pages/ManagePage';
import SettingsPage from './pages/SettingsPage';
import MysticPage from './pages/mystic/MysticPage';
import OverviewPage from './pages/audit/OverviewPage';                       // 2026-09-22 二轮：校准总览（四页合一）
import AuditPage from './pages/audit/AuditPage';
import IntakePage from './pages/intake/IntakePage';
import CalendarPage from './pages/disclosure/CalendarPage';           // P0-U7（2026-09-16）：待验证队列日历页
import NegativeResultsPage from './pages/disclosure/NegativeResultsPage';   // 第 4 期 I2（2026-09-21）：负结果账本对外页
import CompilerPage from './pages/disclosure/CompilerPage';                 // 第 4 期（2026-09-21）：编译器门面
import { IconLayers, IconCompass, IconGear, IconBook, TermDrawer } from './components/ui';
import { CanvasField } from './components/CanvasField';
import './styles/p1b6.css';
import './styles/motion.css';

const linkCls = ({ isActive }: { isActive: boolean }) => 'appbar-link' + (isActive ? ' is-active' : '');
const toolCls = ({ isActive }: { isActive: boolean }) => 'appbar-gear' + (isActive ? ' is-active' : '');

/** 容器分类（治 D1：860 一刀切）
 *  2026-09-15 三轮：接题/对局改宽到 1280（与审计页同档）——
 *  接题页＝表单＋结果左右并列，对局页＝列表可横排多列；设置页仍为表单宽（720，单列易读）。
 */
function containerClass(path: string): string {
  if (path === '/overview') return 'content content--wide';   // 2026-09-22 二轮：校准总览（读数卡网格需宽档）
  if (path === '/audit') return 'content content--wide';
  if (path === '/intake' || path === '/manage') return 'content content--wide';
  if (path === '/calendar' || path === '/calibration') return 'content content--wide'; // P0-U7/U8 披露页（表格宽档）
  if (path === '/negative-results' || path === '/bayes-lens' || path === '/arena' || path === '/compiler') return 'content content--wide'; // 第 4 期 I2/I6 披露页（宽档）
  if (path === '/settings') return 'content content--form';
  return 'content';
}

function Shell() {
  const { pathname } = useLocation();
  const [termsOpen, setTermsOpen] = useState(false);

  /**
   * 页面转场（2026-09-22 三轮）：路由变化时给主内容区换 key，触发「仪表通电」动画，
   * 同时放一条扫描线自上而下扫过（仪器自检的视觉语言）。
   *
   * ★ 为什么用 key 换而不是状态机：React 在 key 变化时会卸载重挂，
   *   于是 CSS animation 自然从头播一次——比手写 enter/exit 状态更少出错。
   * ★ 扫描线的 key 也要变，否则连续切页时第二次不重播。
   */
  const [runId, setRunId] = useState(0);
  const firstRun = useRef(true);
  useEffect(() => {
    // 首屏不播扫描线（页面刚打开时用户还没切换过，扫一下反而突兀）
    if (firstRun.current) { firstRun.current = false; return; }
    setRunId((n) => n + 1);
  }, [pathname]);

  return (
    <div className="app">
      <CanvasField testId="field-bg" />
      <span key={runId} className={'scanline' + (runId > 0 ? ' is-running' : '')} aria-hidden="true" />
      <header className="appbar">
        <div className="appbar-inner">
          <NavLink to="/" className="brand" aria-label="AI 推演沙盘">
            <IconLayers size={18} />
            <span>推演沙盘</span>
          </NavLink>
          <nav className="appbar-nav" aria-label="主导航">
            <NavLink to="/" end className={linkCls}>概览</NavLink>
            <NavLink to="/intake" className={linkCls}>接题</NavLink>
            <NavLink to="/manage" className={linkCls}>对局</NavLink>
            <NavLink to="/overview" className={linkCls}>校准总览</NavLink>
            <NavLink to="/audit" className={linkCls}>账本审计</NavLink>
            <NavLink to="/calendar" className={linkCls}>待验证</NavLink>
            <NavLink to="/negative-results" className={linkCls}>负结果</NavLink>
            <NavLink to="/compiler" className={linkCls}>编译器</NavLink>
          </nav>
          <button type="button" className="appbar-gear" onClick={() => setTermsOpen(true)} aria-label="术语表" title="术语表">
            <IconBook size={18} />
          </button>
          <NavLink to="/mystic" className={toolCls} aria-label="排盘（娱乐参考）" title="排盘（娱乐参考）">
            <IconCompass size={18} />
          </NavLink>
          <NavLink to="/settings" className={toolCls} aria-label="设置" title="设置">
            <IconGear size={18} />
          </NavLink>
        </div>
      </header>
      <main className={containerClass(pathname)}>
        {/* key 变化 ⇒ 重挂载 ⇒ 播一次「通电」动画（首屏也播，进场要有仪式感） */}
        <div key={pathname} className="page-enter">
        <Routes>
          <Route path="/" element={<LivePage />} />
          <Route path="/manage" element={<ManagePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/mystic" element={<MysticPage />} />
          {/* 2026-09-22 二轮：校准总览（原 calibration/bayes-lens/arena 三页合并到此） */}
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/intake" element={<IntakePage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/negative-results" element={<NegativeResultsPage />} />
          <Route path="/compiler" element={<CompilerPage />} />
          {/* 旧路径重定向保兼容（书签/旧链接）：已并入总览的三页 */}
          <Route path="/calibration" element={<Navigate to="/overview" replace />} />
          <Route path="/bayes-lens" element={<Navigate to="/overview" replace />} />
          <Route path="/arena" element={<Navigate to="/overview" replace />} />
          {/* 旧路径重定向保兼容（书签/旧链接） */}
          <Route path="/live" element={<Navigate to="/" replace />} />
          <Route path="/games" element={<Navigate to="/manage" replace />} />
          <Route path="/input" element={<Navigate to="/" replace />} />
          <Route path="/advisor" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </div>
      </main>
      <TermDrawer open={termsOpen} onClose={() => setTermsOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}

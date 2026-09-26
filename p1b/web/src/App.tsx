/**
 * P1b 应用壳（UI 重构步 1+2，2026-09-14）：HashRouter —— 后端静态托管 dist，无需 SPA fallback。
 * 导航收敛为四组「概览／接题／对局／审计」+ 右侧工具（排盘／设置）；容器按页分类
 * （数据页 .content--wide 1280 ／ 表单页 .content--form 720 ／ 其余 860 阅读宽）。
 * 路由全兼容：/live→/、/games→/manage、/input|/advisor→/、*→/（一个不破）。
 */
import { useEffect, useRef, useState } from 'react';
import { HashRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import LivePage from './pages/LivePage';
import HomePage from './pages/HomePage';                           // 2026-09-27 八轮：入口页（回答「这是什么/什么状态/两条线」）
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
// ★八轮：装饰性 Canvas 粒子场（components/CanvasField.tsx）已从壳层移除，
//   理由与「组件源码保留未删」的原因见 JSX 处注释。此处**不再 import**（免得 tsc 报未使用）。
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
      // ★八轮：色温编码模式——现场（狼人杀，夜间线下局）走深色，观测台走浅色。
      //   挂 data-mode 而非换 class，令牌层用 [data-mode="live"] 覆盖即可，页面零改动。
      const live = ['/live', '/manage', '/mystic'].indexOf(pathname) !== -1;
      document.documentElement.setAttribute('data-mode', live ? 'live' : 'desk');
    }, [pathname]);

    useEffect(() => {
    // 首屏不播扫描线（页面刚打开时用户还没切换过，扫一下反而突兀）
    if (firstRun.current) { firstRun.current = false; return; }
    setRunId((n) => n + 1);
  }, [pathname]);

  return (
    <div className="app">
      {/* ★2026-09-27 八轮：**移除**装饰性 Canvas 粒子场（CanvasField）。
       *  理由不是「不好看」，是它**宣称了没实现的语义**——组件头注写「密度随页面数据量变化」，
       *  实测密度公式是 `min(MAX, (w*h)/100000*DENSITY)`，**只跟视口面积有关**，
       *  与页面数据无关（实测接题页与校准总览的粒子场完全一致）。
       *  即：拿一句假的数据语义，包装一段纯装饰的持续动画（每帧重绘 + 鼠标避让），
       *  同时让面板边界更难分辨。这正是要清掉的那类东西。
       *  组件源码与其 reduced-motion 测试**保留未删**（要恢复只需重新挂载一行），
       *  但本文件新增闸锁死「不得重新挂载」——见 styles/appShell 下的八轮用例。 */}
      <span key={runId} className={'scanline' + (runId > 0 ? ' is-running' : '')} aria-hidden="true" />
      <header className="appbar">
        <div className="appbar-inner">
          <NavLink to="/" className="brand" aria-label="AI 推演沙盘">
            <IconLayers size={18} />
            <span>推演沙盘</span>
          </NavLink>
          <nav className="appbar-nav" aria-label="主导航">
            {/* ★2026-09-27 八轮：导航按「用途」分两组，取代此前 8 项平铺。
             *  病象：平铺时 1-3 项属推演沙盘现场、4-8 项属读数观测台，两条线交错，
             *  新人无法从导航看出这是个什么东西。分组后每组内部同质、一眼可辨。 */}
            <span className="appbar-group">
              <NavLink to="/" end className={linkCls}>入口</NavLink>
              <NavLink to="/overview" className={linkCls}>观测台</NavLink>
              <NavLink to="/audit" className={linkCls}>账本</NavLink>
              <NavLink to="/calendar" className={linkCls}>待验证</NavLink>
              <NavLink to="/negative-results" className={linkCls}>负结果</NavLink>
              <NavLink to="/intake" className={linkCls}>接题</NavLink>
              <NavLink to="/compiler" className={linkCls}>编译器</NavLink>
            </span>
            <span className="appbar-sep" aria-hidden="true" />
            <span className="appbar-group">
              <NavLink to="/live" className={linkCls}>现场</NavLink>
              <NavLink to="/manage" className={linkCls}>对局</NavLink>
            </span>
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
          {/* ★2026-09-27 八轮：`/` 由 LivePage 改为 HomePage。
           *  病象见 HomePage 头注：入口页原先是狼人杀选局，新人第一屏答错了问题。
           *  现场页让位到 /live（下方 /live 的旧重定向同步改指向，路径不破）。 */}
          <Route path="/" element={<HomePage />} />
          <Route path="/live" element={<LivePage />} />
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
          {/* 旧路径重定向保兼容（书签/旧链接）—— ★八轮：/live 已成实页，其余旧别名照旧 */}
          <Route path="/games" element={<Navigate to="/manage" replace />} />
          <Route path="/input" element={<Navigate to="/live" replace />} />
          <Route path="/advisor" element={<Navigate to="/live" replace />} />
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

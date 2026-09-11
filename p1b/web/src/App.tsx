/**
 * B6 一页现场流壳：三区导航（现场 / 管理 / 设置齿轮）+ 旧四 Tab 路由重定向保兼容。
 * HashRouter 保留 —— 后端静态托管 dist 无需 SPA fallback，手机直接刷新不 404。
 */
import { HashRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import LivePage from './pages/LivePage';
import ManagePage from './pages/ManagePage';
import SettingsPage from './pages/SettingsPage';
import MysticPage from './pages/mystic/MysticPage';
import './styles/p1b6.css';

function NavLinkCls(isActive: boolean) {
  return isActive ? 'is-active' : undefined;
}

export default function App() {
  return (
    <HashRouter>
      <div className="app">
        <header className="appbar">
          <div className="appbar-inner">
            <NavLink to="/" className="brand" aria-label="AI 推演沙盘">
              <span aria-hidden>🎭</span>
              <span>推演沙盘</span>
            </NavLink>
            <nav className="appbar-nav" aria-label="主导航">
              <NavLink to="/" end className={({ isActive }) => 'appbar-link ' + (NavLinkCls(isActive) ?? '')}>
                现场
              </NavLink>
              <NavLink to="/manage" className={({ isActive }) => 'appbar-link ' + (NavLinkCls(isActive) ?? '')}>
                管理
              </NavLink>
              <NavLink to="/mystic" className={({ isActive }) => 'appbar-link ' + (NavLinkCls(isActive) ?? '')}>
                ☯ 排盘
              </NavLink>
            </nav>
            <NavLink to="/settings" className={({ isActive }) => 'appbar-gear' + (NavLinkCls(isActive) ? ' is-active' : '')}
              aria-label="设置" title="设置">
              <span aria-hidden>⚙️</span>
            </NavLink>
          </div>
        </header>
        <main className="content">
          <Routes>
            <Route path="/" element={<LivePage />} />
            <Route path="/manage" element={<ManagePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/mystic" element={<MysticPage />} />
            {/* 旧四 Tab 路径重定向（书签/旧链接兼容） */}
            <Route path="/games" element={<Navigate to="/manage" replace />} />
            <Route path="/input" element={<Navigate to="/" replace />} />
            <Route path="/advisor" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}

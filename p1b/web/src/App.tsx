/**
 * P1b 应用壳（UI 重构步 1+2，2026-09-14）：HashRouter —— 后端静态托管 dist，无需 SPA fallback。
 * 导航收敛为四组「概览／接题／对局／审计」+ 右侧工具（排盘／设置）；容器按页分类
 * （数据页 .content--wide 1280 ／ 表单页 .content--form 720 ／ 其余 860 阅读宽）。
 * 路由全兼容：/live→/、/games→/manage、/input|/advisor→/、*→/（一个不破）。
 */
import { useEffect, useRef, useState } from 'react';
import { HashRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import LivePage from './pages/LivePage';
import HomePage from './pages/HomePage';
import ResolvePage from './pages/ResolvePage';   // ★八轮第五改：待落定（题线第二个动作）
import WhereOffPage from './pages/WhereOffPage'; // ★八轮第六改：我在哪儿偏了（五页看板的合并体）
import NotePage from './pages/NotePage';        // ★八轮第七改：记一笔（接题页减负版） // ★八轮第六改：我在哪儿偏了（五页看板的合并体）   // ★八轮第五改：待落定（题线第二个动作）                           // 2026-09-27 八轮：入口页（回答「这是什么/什么状态/两条线」）
import ManagePage from './pages/ManagePage';
import SettingsPage from './pages/SettingsPage';
import MysticPage from './pages/mystic/MysticPage';
import QuestionPage from './pages/QuestionPage';               // ★T9（2026-09-28）：一道题的完整一生（/question/:id）
import NegativeResultsPage from './pages/disclosure/NegativeResultsPage';   // 第 4 期 I2（2026-09-21）：负结果账本对外页
// ★T9：五页（Overview/Audit/Intake/Calendar/Compiler）的 **import 已删**——八轮第六/七改把
//   它们的路由全部改成重定向，组件再没被渲染过，tsc 报 TS6133（实测 5 条，见本轮 tsc 输出）。
//   ★为什么只删 import、不删源码：(a) 删源码会让「禁词扫描」与「可达性」两道闸失去扫描目标；
//   (b) 旧路径的 Route 必须留着（书签不断），源码是它们的历史留痕。
//   五个旧路径的重定向去向（删 import 前逐条核对过，不是猜的）：
//     /overview /audit /calendar /compiler → /where-off（合并体「我在哪儿偏了」）
//     /intake                            → /note（「记一笔」＝接题页减负版，调用同一个 classify 端点）
//   ★不并入别处的一处（如实记账，不假装已并）：/calendar 的**内容**（待验证队列日历、
//     守恒自检、双源比对）在合并体里**没有对应区块**——它重定向过去的是聚合偏差页。
//     这不是本轮引入的（重定向早于本轮就在），本轮只删未使用的 import，不动路由语义；
//     要真并进去属另立项。
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
  // ★2026-09-28 收口：/where-off 是八轮合并体，**接管了下面四条旧路径**（见下方 Route）。
  //   它原先不在宽档表里 ⇒ 容器退回 .content 的 720px（app.css:87），
  //   而它接手的 /overview /audit /calendar /compiler 在合并前**全都是 content--wide（1280）**。
  //   即：数据一条没少，宽档在合并中掉了（容器 1280 → 720）——这正是 disclosureUx 那道闸要防的事。
  //   补上的是「意图不丢」，不是新增要求。
  //   ★如实记账：页面自身 whereoff.css:7 还有 max-width: 980px，会先于容器生效；
  //     改它属页面设计决策，本轮闸门修复不碰（要改另立项）。
  if (path === '/where-off') return 'content content--wide';
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
  // ★八轮第八改：现场覆盖层所需的三样东西——
  //   isLive    当前是不是在「现场模式」（现场/对局/排盘）
  //   navigate  退出时要跳回哪儿
  //   lastDesk  **进现场之前**所在的题线路径（退出即回原处，位置不丢）
  const isLive = ['/live', '/manage', '/mystic'].indexOf(pathname) !== -1;
  const navigate = useNavigate();
  const lastDesk = useRef<string>('/resolve');

    useEffect(() => {
      // ★八轮：色温编码模式——现场（狼人杀，夜间线下局）走深色，观测台走浅色。
      //   挂 data-mode 而非换 class，令牌层用 [data-mode="live"] 覆盖即可，页面零改动。
      if (isLive) {
        document.documentElement.setAttribute('data-mode', 'live');
      } else {
        document.documentElement.setAttribute('data-mode', 'desk');
        // 记住"进现场之前在哪"，退现场时原路返回
        lastDesk.current = pathname;
      }
    }, [pathname, isLive]);

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
            {/* ★八轮第八改：现场是**覆盖层**，不是同一排导航里的另一组。
             *  理由（方向兵）：现场是线下狼人杀时的密集操作（秒级节奏），
             *  题线三动作是独处时做的（分钟级）。两种节奏挤在一排导航里会互相打断——
             *  局中想记一笔、或答题答到一半被"去对局"分神，都是真实会发生的事。
             *  ⇒ 进现场后**整条导航换掉**：只剩现场/对局 + 一个显式的「退出现场」，
             *    退出回到进来之前那一页（lastDesk 记忆），位置不丢。
             *    题线三动作在局中**不可见**，这不是隐藏功能，是不打断。 */}
            {isLive ? (
              <span className="appbar-group appbar-group--live">
                <NavLink to="/live" className={linkCls}>现场</NavLink>
                <NavLink to="/manage" className={linkCls}>对局</NavLink>
                <button
                  type="button" className="appbar-exit"
                  onClick={() => navigate(lastDesk.current || '/')}
                >退出现场</button>
              </span>
            ) : (
              <>
                {/* ★八轮第六改：导航由 9 项收成 5 项。
                 *  病象（用户原话）：「数值太多了…页面都是在展示数值，有点像后端维护的东西」。
                 *  实测：五个「看数」页合计展示 99 处、交互 10 处；其中三页在展示**同一批字段**。
                 *  收法：「看数」压成**一个**入口，题线只留三个动作——且写成**动词/问句**而非名词
                 *  （方向兵判据：「名词导航 = 仪表盘，问句导航 = 工具」）：
                 *    待落定（今天该干的）· 记一笔（写新的）· 我在哪儿偏了（回声）
                 *  旧路径全部保留重定向 ⇒ 书签与外部链接不断。 */}
                <span className="appbar-group">
                  <NavLink to="/resolve" className={linkCls}>待落定</NavLink>
                  <NavLink to="/note" className={linkCls}>记一笔</NavLink>
                  <NavLink to="/where-off" className={linkCls}>我在哪儿偏了</NavLink>
                </span>
                <span className="appbar-sep" aria-hidden="true" />
                <span className="appbar-group">
                  <NavLink to="/live" className={linkCls}>现场</NavLink>
                </span>
              </>
            )}
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
          {/* ★八轮第六改：五页看板收成「我在哪儿偏了」。**源码刻意保留不删**——
              禁词扫描测试（disclosureUx）仍以它们为扫描目标，删了就失去那道闸的目标。 */}
          <Route path="/overview" element={<Navigate to="/where-off" replace />} />
          <Route path="/audit" element={<Navigate to="/where-off" replace />} />
          <Route path="/resolve" element={<ResolvePage />} />
          {/* ★八轮第六改：合并体。旧五页路径全部重定向到它 ⇒ 书签不断。 */}
          <Route path="/where-off" element={<WhereOffPage />} />
          {/* 旧接题页保留重定向（书签不断）；源码保留＝禁词扫描测试的目标。 */}
          <Route path="/note" element={<NotePage />} />
          <Route path="/intake" element={<Navigate to="/note" replace />} />
          <Route path="/calendar" element={<Navigate to="/where-off" replace />} />
          <Route path="/negative-results" element={<NegativeResultsPage />} />
          {/* 编译器并入合并页：它的全部功能是「选个 kind 告诉你它属于哪层」，
              而那层信息在新流程里是回执上的一行字，不值一个顶级导航位。源码保留（禁词扫描目标）。 */}
          <Route path="/compiler" element={<Navigate to="/where-off" replace />} />
          {/* ★T9：单题的一生。挂在题线三动作之下，不占导航位——
              它是**从别的页跳进来**的详情页（回声页 → 具体某一道题），
              给它一个顶级导航位等于把"看一道"抬成"看全局"。 */}
          <Route path="/question/:id" element={<QuestionPage />} />
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

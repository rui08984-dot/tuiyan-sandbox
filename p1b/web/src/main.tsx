import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
// 字体本地打包（@fontsource，离线可用）：Fira Sans 正文 + Fira Code 数字/ID/判据
import '@fontsource/fira-sans/latin-400.css';
import '@fontsource/fira-sans/latin-500.css';
import '@fontsource/fira-sans/latin-600.css';
import '@fontsource/fira-code/latin-400.css';
import './styles/app.css';
import './styles/tokens.css'; // 设计令牌（需在 app.css 之后：body 字体规则胜出）
// ★2026-09-29 修一个真实的生产缺陷：charts.css 原先**只**由 components/charts/ChartFrame.tsx
//   引入，而 ChartFrame 唯一的使用者是 pages/audit/OverviewPage.tsx —— 那是 8 个「死页面」之一
//   （路由被重定向，源码只留作禁词扫描的扫描目标）。
//   ⇒ Vite 的 tree-shaking 判定 charts.css 不可达，**整份样式表被摇出生产产物**。
//   后果不是「少了几条无人用的规则」：components/ui/index.tsx 也用 .chart-eyebrow，
//   而 components/ui 被 **App.tsx** 与 **QuestionPage.tsx**（活页）引用
//   ⇒ 活页上的 eyebrow 小标签在生产环境**完全没有样式**（字号/字距/颜色全丢）。
//   同时每次 vite build 都会打印一条 CSS minify 警告，位置正落在 charts.css 的
//   --eyebrow-size 声明附近（该变量本身在产物里，用它的规则不在）。
//   ★改法：把它挂到全局入口，而不是靠某个可能死掉的组件 import —— 样式表的可达性
//   不该取决于「谁恰好用了其中一个类」。这与 ADR-004「写路径收口」是同一条纪律：
//   **别让「能不能被 shake 掉」取决于组件树的偶然形状。**
//   ★注意：本注释里**不要写出裸的 JSX 标签** —— render-smoke.test.mjs ① 用正则扫
//   每个 .tsx 里出现的 JSX 组件名，注释里提到某个路由组件名会被误判成「未导入组件」
//   （已踩过一次：注释里描述重定向时写出了那个标签的名字，测试当场红，pre-commit 拦下了提交）。
import './styles/charts.css';
import './styles/charts.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root 未找到');

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

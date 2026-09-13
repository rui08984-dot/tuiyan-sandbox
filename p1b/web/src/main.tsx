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

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root 未找到');

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

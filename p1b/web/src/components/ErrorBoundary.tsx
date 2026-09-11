import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null }

/** 渲染异常兜底：任何未捕获渲染错误都落到这里，给出可读提示而非白屏。 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[P1b] 渲染异常:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-fullscreen">
          <h1>页面出错了</h1>
          <p className="muted">{this.state.error.message}</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            刷新页面
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

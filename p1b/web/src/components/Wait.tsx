/** Wait —— 等待态（2026-09-28 · T2 / 模块 M5）
 *
 * 【为什么它不是个小细节】
 * 用户明确要求「回复的时候要转圈等待什么的」。这不是装饰需求：
 * 本产品的核心动作是**算数**（数同类题的历史样本、跑引擎基率），
 * 那是要等网络往返 + 聚合的。等待时那行「在数什么」的字，
 * **就是产品对这次等待的解释**——空白 + 一个孤零零的圈 = 用户以为坏了。
 *
 * 【四条纪律，都是从"别晃眼"倒推出来的】
 * ① **<400ms 不显示任何东西**：真实快请求配一圈是噪音，用户只会被闪到。
 * ② **>400ms 才淡入**：且淡入要慢（180ms），让元素出现本身也是轻的。
 * ③ **>1.5s 补第二句**：说明"还在等、不是卡了"。
 * ④ **失败必须可重试**：只说失败不给重试，等于把问题推给用户。
 *
 * 频次门（find-animation-opportunities）：本页每天用几十次 ⇒ 只允许近乎无感。
 * 所以环很小（14px）、转速慢（1.1s/圈）、不动布局（不占位变化）。
 *
 * `prefers-reduced-motion` 下：环停转但**保留文案**——文案是信息，不是动效。
 */
import { useEffect, useRef, useState } from 'react';
// ★这个 import 不可省：漏掉它时 Vite **不报错**、测试也全绿（内容断言照样过），
//   但页面上的等待圈是**完全没样式**的裸 div——典型的「测试绿、功能死」。
//   wait-state.test.mjs 的第 ⑦ 条就是为堵这个而加的。
import '../styles/wait.css';

export type WaitState = 'idle' | 'pending' | 'error';

export function Wait({
  state, what, error, onRetry, testId,
}: {
  /** idle=没在等；pending=在等；error=失败 */
  state: WaitState;
  /** 正在等什么——**必填**，这是等待态存在的全部理由。 */
  what?: string;
  /** 失败原因（state=error 时显示）。 */
  error?: string | null;
  /** 重试回调（给了才显示重试键）。 */
  onRetry?: () => void;
  testId?: string;
}) {
  const [shown, setShown] = useState(false);
  const [slow, setSlow] = useState(false);
  const t1 = useRef<number | null>(null);
  const t2 = useRef<number | null>(null);

  useEffect(() => {
    if (state !== 'pending') {
      setShown(false); setSlow(false);
      if (t1.current) window.clearTimeout(t1.current);
      if (t2.current) window.clearTimeout(t2.current);
      return;
    }
    // 纪律①：400ms 内不显示
    t1.current = window.setTimeout(() => setShown(true), 400);
    // 纪律③：1.5s 后补"还在等"
    t2.current = window.setTimeout(() => setSlow(true), 1500);
    return () => {
      if (t1.current) window.clearTimeout(t1.current);
      if (t2.current) window.clearTimeout(t2.current);
    };
  }, [state]);

  if (state === 'idle') return null;

  if (state === 'error') {
    return (
      <div className="wait wait--error" role="alert" data-testid={testId}>
        <span className="wait-x" aria-hidden="true">✗</span>
        <span className="wait-msg">{error || '出错了'}</span>
        {onRetry ? (
          <button type="button" className="wait-retry" onClick={onRetry}>重试</button>
        ) : null}
      </div>
    );
  }

  return (
    // pending 但还在 400ms 内 ⇒ 什么都不渲染（纪律①）
    shown ? (
      <div className="wait wait--pending" role="status" aria-live="polite" data-testid={testId}>
        <span className="wait-ring" aria-hidden="true" />
        {/* ★纪律：文案必填——空白 + 一个孤圈 = 用户以为坏了 */}
        <span className="wait-msg">{what || '在处理…'}</span>
        {slow ? <span className="wait-slow">还在等，不是卡了</span> : null}
      </div>
    ) : null
  );
}

export default Wait;

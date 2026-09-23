/**
 * useModalDismiss —— 弹层统一关闭行为（2026-09-23 七轮）
 *
 * 起因：用户反馈「叠加页交互有点奇怪」。
 * 实测：站点里有 9 个弹层（开新局向导 / 宏表 / 编辑表 / 判词 / 供应商编辑 /
 *   术语抽屉 / 确认卡 / 切换建局 / 排盘回看），其中**只有术语抽屉**支持 Esc。
 *   同一个网站里有的弹层能按 Esc 关、有的不能 —— 这不是"奇怪"，是**不一致**。
 *
 * 本 hook 统一三条键盘/指针约定（业界标准，也是无障碍基线）：
 *   ① Esc 关闭
 *   ② 点遮罩关闭（点内容区不关）
 *   ③ 打开时锁 body 滚动（防背景跟着滚，那是最典型的"叠加页很奇怪"）
 *
 * 用法：
 *   const { overlayProps, contentProps } = useModalDismiss(onClose);
 *   <div className="sheet-overlay" {...overlayProps}><div className="sheet" {...contentProps}>…</div></div>
 *
 * ★ 为什么不直接写 CSS：点遮罩关闭必须区分「点在遮罩」与「点在内容」，
 *   纯 CSS 做不到（需要事件目标判断）。
 * ★ 为什么要锁滚动：弹层打开时背景仍可滚动，会让使用者以为自己点错了地方。
 */
import { useEffect, useRef, type MouseEvent, type Ref } from 'react';

export function useModalDismiss<T extends HTMLElement = HTMLDivElement>(
  onClose: () => void,
  opts?: { closeOnOverlay?: boolean; lockScroll?: boolean; initialFocus?: boolean },
): {
  /** 直接展开到遮罩元素上：<div className="sheet-overlay" {...overlayProps}> */
  /** 直接展开到遮罩元素上：<div className="sheet-overlay" {...overlayProps}> */
  overlayProps: { onClick: (e: MouseEvent) => void; ref: Ref<T> };
  contentProps: { onClick: (e: MouseEvent) => void };
} {
  const { closeOnOverlay = true, lockScroll = true, initialFocus = true } = opts ?? {};
  const overlayRef = useRef<T>(null);
  const prevFocus = useRef<Element | null>(null);

  /* ① Esc 关闭 + ③ 锁滚动 + 焦点管理
   * 焦点：打开时把焦点移进弹层（键盘用户不会"卡"在背后的页面上），
   * 关闭时还给原元素——这是无障碍要求，也是"手感对不对"的关键。 */
  useEffect(() => {
    prevFocus.current = document.activeElement;

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);

    let prevOverflow = '';
    if (lockScroll) {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }

    let timer = 0;
    if (initialFocus && overlayRef.current) {
      // 延后一帧：让弹层先完成挂载（有些实现是动画后才有可聚焦元素）
      timer = window.setTimeout(() => {
        const el = overlayRef.current;
        if (!el) return;
        const focusable = el.querySelector<HTMLElement>(
          'input:not([type="hidden"]), select, textarea, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        (focusable ?? el).focus?.();
      }, 30);
    }

    return () => {
      document.removeEventListener('keydown', onKey);
      window.clearTimeout(timer);
      if (lockScroll) document.body.style.overflow = prevOverflow;
      // 焦点归还：回到打开前的元素（不存在则不动，不报错）
      const p = prevFocus.current;
      if (initialFocus && p && (p as HTMLElement).focus) {
        try { (p as HTMLElement).focus(); } catch { /* 元素可能已卸载 */ }
      }
    };
  }, [onClose, lockScroll, initialFocus]);

  return {
    overlayProps: {
      ref: overlayRef,
      onClick: (e: MouseEvent) => {
        if (!closeOnOverlay) return;
        // 只在"事件目标就是遮罩本身"时关闭——点内容区冒泡上来不该关
        if (e.target === e.currentTarget) onClose();
      },
    },
    contentProps: {
      onClick: (e: MouseEvent) => { e.stopPropagation(); },
    },
  };
}

export default useModalDismiss;

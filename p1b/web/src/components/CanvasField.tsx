/**
 * CanvasField —— 数据场背景（2026-09-22 三轮）
 *
 * 设计命题：背景不是装饰，是这个系统的**数据场本体**——
 *   粒子＝账本里的题目；连线＝它们之间的同类关联；粒子随鼠标轻微避让＝
 *   观测者的位置会影响观测（这是本项目「自反层 L4」的视觉隐喻）。
 *
 * ★ 三条工程纪律：
 *   ① 零依赖：手写 Canvas 2D，不引任何库（守零依赖铁律）。
 *   ② 低功耗：requestAnimationFrame + 标签页隐藏时暂停 + DPR 上限 2（4K 屏不烧 GPU）
 *      + 粒子数按面积自适应 + 连线用距离平方比较避免开方。
 *   ③ 可访问性：prefers-reduced-motion 时**完全不启动** rAF（不是动画变快），
 *      并彻底不渲染（CSS 层已 display:none，此处再兜一层短路）。
 *
 * ★ 为什么用 Canvas 而不是 DOM 粒子：几百个元素做 DOM 动画会持续触发样式重算，
 *   在低端设备上会拖慢主线程；Canvas 只画位图，主线程空出来给交互。
 */
import { useEffect, useRef } from 'react';
import '../styles/motion.css';

/** 粒子密度：每 10 万平方像素的粒子数 */
const DENSITY = 7;
/** 连线距离阈值（px）——超过此距离不连线 */
const LINK_DIST = 132;
/** 粒子最大数（大屏上限，防 4K 屏铺满） */
const MAX_PARTICLES = 90;
/** 鼠标避让半径 */
const CURSOR_R = 110;

type P = { x: number; y: number; vx: number; vy: number; r: number; a: number };

export function CanvasField({ testId }: { testId?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    // ── 可访问性短路：尊重系统「减少动态效果」 ──
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) return;

    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let parts: P[] = [];
    let running = true;
    const cursor = { x: -999, y: -999 };

    /** 从 CSS 变量取当前主题色（主题切换后重读，保持与色板单一真源一致） */
    function themeColors() {
      const cs = getComputedStyle(document.documentElement);
      return {
        dot: cs.getPropertyValue('--accent').trim() || '#8FAF7B',
        link: cs.getPropertyValue('--accent').trim() || '#8FAF7B',
        grid: cs.getPropertyValue('--grid-line').trim() || 'rgba(255,255,255,0.04)',
      };
    }

    function resize() {
      if (!canvas) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);   // DPR 上限 2：4K 屏不烧 GPU
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      const target = Math.min(MAX_PARTICLES, Math.round((w * h) / 100000 * DENSITY));
      parts = new Array(target).fill(0).map(() => ({
        x: Math.random() * w,
        y: Math.random() * h,
        // 极慢漂移：像悬在液体里的尘埃，不是飞行的星星
        vx: (Math.random() - 0.5) * 0.16,
        vy: (Math.random() - 0.5) * 0.16,
        r: 0.7 + Math.random() * 1.1,
        a: 0.18 + Math.random() * 0.28,
      }));
    }

    function step() {
      if (!canvas || !ctx) return;
      const C = themeColors();
      ctx.clearRect(0, 0, w, h);

      // 位置推进 + 边界回绕（粒子数恒定，不生成/销毁对象避免 GC 抖动）
      for (const p of parts) {
        // 鼠标避让：观测者影响观测
        const dx = p.x - cursor.x;
        const dy = p.y - cursor.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < CURSOR_R * CURSOR_R && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const push = (1 - d / CURSOR_R) * 0.5;
          p.x += (dx / d) * push;
          p.y += (dy / d) * push;
        }
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -8) p.x = w + 8; else if (p.x > w + 8) p.x = -8;
        if (p.y < -8) p.y = h + 8; else if (p.y > h + 8) p.y = -8;
      }

      // 连线：距离平方比较，避免每次开方
      ctx.lineWidth = 0.6;
      for (let i = 0; i < parts.length; i++) {
        const a = parts[i];
        for (let j = i + 1; j < parts.length; j++) {
          const b = parts[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > LINK_DIST * LINK_DIST) continue;
          // 距离越近线越实（透明度做距离插值）
          ctx.strokeStyle = C.link;
          ctx.globalAlpha = (1 - Math.sqrt(d2) / LINK_DIST) * 0.16;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      // 粒子本体
      for (const p of parts) {
        ctx.globalAlpha = p.a;
        ctx.fillStyle = C.dot;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (running) raf = requestAnimationFrame(step);
    }

    function onMove(e: PointerEvent) {
      const r = canvas!.getBoundingClientRect();
      cursor.x = e.clientX - r.left;
      cursor.y = e.clientY - r.top;
    }
    function onLeave() { cursor.x = -999; cursor.y = -999; }

    function onVisibility() {
      // 标签页隐藏时停帧：不浪费电，回来时无缝恢复
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        raf = requestAnimationFrame(step);
      }
    }

    // 系统偏好中途切换：立即停/启
    function onMqChange() {
      if (mq.matches) {
        running = false;
        cancelAnimationFrame(raf);
        if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
      } else if (!running) {
        running = true;
        raf = requestAnimationFrame(step);
      }
    }

    let resizeTimer = 0;
    function onResize() {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 180);
    }

    resize();
    raf = requestAnimationFrame(step);
    window.addEventListener('resize', onResize);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVisibility);
    if (mq.addEventListener) mq.addEventListener('change', onMqChange);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      if (mq.removeEventListener) mq.removeEventListener('change', onMqChange);
    };
  }, []);

  return <canvas ref={ref} className="field-bg" aria-hidden="true" data-testid={testId} />;
}

export default CanvasField;

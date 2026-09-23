/**
 * PagePlate —— 页头铭牌（2026-09-22 三轮）
 *
 * 用户要求（原话拆解）：
 *   「字从两边交叉穿插进来形成一个主体字」→ 主字从左侧进、尾字从右侧进，对穿
 *   「投射的背影字，有阴影」→          → 偏移副本压在色块后面（低对比度实色，非模糊阴影）
 *   「大标题后面有一个纯色色块来映照」→ → 底色块从左侧延展出宽度
 *   「粗体大字，艺术字体也没问题」      →  字重 800 + 收紧字距 + 主副字尺寸对比
 *
 * ★ 为什么不用模糊阴影做「影子字」：仓库测试闸禁止 `box-shadow: 0 0 Npx`（装饰性发光），
 *   且这类模糊在深色底上会显脏。改用**同一文本的偏移实色副本**，
 *   对比度低（opacity 0.09）但边缘干净——更像印刷品的压印，而不是数码辉光。
 *
 * ★ 无障碍：投影字与色块是 aria-hidden 的纯装饰；标题语义由真实 <h1> 承担。
 */
import type { ReactNode } from 'react';
import '../styles/motion.css';

export function PagePlate({
  icon,
  title,
  tail,
  subtitle,
  actions,
  testId,
}: {
  /** 页头图标（内联 SVG，禁 emoji） */
  icon?: ReactNode;
  /** 主标题（左进） */
  title: string;
  /** 尾字：英文名/编号之类的短标签（右进，与主字对穿）。不给则不渲染 */
  tail?: string;
  /** 一句话说明（人话，满行） */
  subtitle?: ReactNode;
  /** 页级主操作（七轮补）：如「开新局」。
   *  ★ 存在的必要性：此前各页把主操作放在自造页头里，换成统一铭牌时极易遗漏
   *    （实测：管理页的「开新局」就是这么丢的）。有了这个插槽，主操作随铭牌一起统一。 */
  actions?: ReactNode;
  testId?: string;
}) {
  return (
    <header className="page-plate" data-testid={testId}>
      <div className="plate-row">
        <div className="plate">
          {/* 投影字：同一文本的偏移副本。z-index 低于色块，形成"字浮在底板上"的层次 */}
          <span className="plate-shadow" aria-hidden="true">{title}</span>
          <h1 className="plate-title">
            {icon ? <span className="plate-icon" aria-hidden="true">{icon}</span> : null}
            {title}
          </h1>
          {tail ? <span className="plate-tail" aria-hidden="true">{tail}</span> : null}
        </div>
        {actions ? <div className="plate-actions">{actions}</div> : null}
      </div>
      {subtitle ? <p className="plate-sub">{subtitle}</p> : null}
    </header>
  );
}

export default PagePlate;

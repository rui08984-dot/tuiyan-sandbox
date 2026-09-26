/** SourceTag —— 口径标注（2026-09-27 八轮第四改）
 *
 * 【病象：同一份数字在多页重复且口径不一，读者无从判断能不能比】
 *   实测「29 格 / 10 格样本够」在 4 个页面出现（入口、观测台总览、
 *   以及两个已并入总览的旧披露页）。它们多数同源，但**页面上没写**，
 *   于是读者只能凭记忆假设"这两处是同一个数"——而这正是最容易出错的地方：
 *   同名不同口径的数字并排出现，是数据看板最经典的误导手法。
 *
 * 【本组件做什么】不新增数字，只给已有数字**挂出处**：
 *   · 鼠标悬停 / 键盘聚焦 ⇒ 说出这个数从哪来、什么口径、什么时候算的；
 *   · 无悬停时是极轻的一行灰字，不抢主数字的注意力。
 * ★纪律：口径标注**不许自己算数字**，只许引用——避免"标注的算法"与
 *   "数字的算法"分叉（本项目已吃过多次口径漂移的亏）。
 *
 * 用法：<SourceTag of="29/29 格" from="校准总览 · 引擎重放" asOf="2026-09-27" />
 */
export function SourceTag({
  of, from, asOf, testId,
}: {
  /** 这个数字是什么。 */
  of: string;
  /** 口径来源（端点/文件/算法名）。 */
  from: string;
  /** 计算时点。 */
  asOf?: string;
  testId?: string;
}) {
  const text = '口径：' + of + '｜来自 ' + from + (asOf ? '｜算于 ' + asOf : '');
  return (
    <span className="srctag" tabIndex={0} title={text} aria-label={text} data-testid={testId}>
      {from}
      {asOf ? <span className="srctag-asof">{asOf}</span> : null}
    </span>
  );
}

export default SourceTag;

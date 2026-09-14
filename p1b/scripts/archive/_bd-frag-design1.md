### §4.2.4 修订 R4.3：① 池入池判定扩展——date_derivation 周期题换算【2026-09-14 · 用户已批口径 B · 版本递进】

> 触发：月度/年度/周期题（427 行）因 resolve 无 date 被 no_resolve_date 排除出 ① 池——L2 系综主力域被结构性排除。全案见 docs/specs/决策brief-月度年度resolve.date口径-20260914.md。实施＝四微步（契约表扩展 → g2-report 接线 → 存量化补列 → 本节文档化）。

**D1 · 新口径（① 入池判定）**
- 入池判定＝resolve.date **或** 契约表 date_derivations[kind] 换算出的 effective_date（契约表 p1b/sim/out/g2-contract-frozen-r4.json sha 007b41188807…，规则 **22 kind**，落顶层 map——alias kind 直查，不解别名）。
- 换算失败行（source_key 缺失／格式异常／无锚年段）**仍排除但计入 date_derivation failed 计数披露，不许静默丢**（实测 failed=0）。

**D2 · 周期题「到期」语义＝数据发布日**
- 月度题到期＝**次月最后一日**、年度题＝**次年最后一日**（保守近似＝发布窗口上界）；horizon 由此度量「从下注到可验证」，与 Metaculus 类预测平台同构，不再与日频题的事件日混淆。
- cutoff 判定**不变**（细则 B：realtime=created_at／backfill=matures_at−1d）；derived 行 horizon 按发布日口径分桶。


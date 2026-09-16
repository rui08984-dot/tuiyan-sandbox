# P0+ 收据 · 蓝图 §2.1 剩余件（cached_tokens／U8 三列／O7／I2／A6）（2026-09-16）

> 棒位：P0+ 收尾（承接 §30 盘点节）；纪律：零 LLM、零账本写、库只读、禁词 0
> 说明：本批把蓝图 §2.1 表中**未做的四组**补齐三组半；「滞后集合秩检验」与「成本台账」如实降级/挂账（理由见 §3）。

## 1. 交付件

| 件 | 文件 | 说明 |
|---|---|---|
| cached_tokens 打点 | `p1b/src/lib/llmChat.js` | `noteUsage` 增记 `prompt_tokens_details.cached_tokens`＋`calls_with_cached`（前缀缓存命中的唯一实测口径；缺失时不记 0 不报错） |
| U8 三列读侧派生 | `p1b/scripts/u8-columns.cjs`＋`p1b/sim/out/u8-columns-20260916.{json,md}` | KL 可预报性／Murphy 三分解／prequential 累计曲线；**L1 按语义整层排除**（Brier=计算错误率） |
| O7 最大熵注记 | 并入 `p1b/scripts/calibration-report.cjs`（新节） | 先验透明度声明：无信息起点＝Beta(1,1)（最大熵） |
| I2 负结果账本 v0 | 新 `p1b/scripts/negative-results.cjs`＋`p1b/sim/out/negative-results-ledger-20260916.{json,md}` | 实证 9 条＋设计层拒绝 4 条；**四要素运行时校验**（引用文件不存在即报错退出） |
| A6 发布纪律 | `docs/specs/A6-校准报告发布纪律-20260916.md` | 发布面／三条恒挂限定语／禁词（含 bundle 层扫描）／口径边界／发布流程／版本递进 |
| 报告接线 | `p1b/scripts/calibration-report.cjs` | 新增四节：U8 加列／秩检验（n/a 如实）／O7／负结果账本指针 |
| 测试 | `p1b/test/llm-chat-usage.test.cjs`、`p1b/test/u8-columns.test.cjs`、`p1b/test/negative-results.test.cjs` | 共 9 例 |

## 2. 实跑读数（只读）

- **U8 三列**（与 stage4 分层 Brier 逐位一致＝口径自洽）：L2 n=296 Brier 0.2494｜KL 0.0584｜RES 0.0079｜prequential 0.2494；L3 n=399 0.2426｜0.0357｜0.0090；L5 n=30 0.1338｜0.1083｜0.0225；L6 n=270 0.1755｜0.0532｜0.0943。
- **Murphy 恒等式**：对桶口径 Brier（Brier_binned = REL + Σ(n_j/N)ō_j(1−ō_j)）残差 < 1e-12（测试锁 <1e-9）；与原始 Brier 的差＝桶内预测方差（如实并列披露）。
- **校准报告 md 禁词扫描 = 0**；节序：限定语块→防泄漏→五层语义→分域表→**U8 加列**→**秩检验(n/a)**→**O7**→**负结果指针**→口径边界。
- **负结果账本**：9 实证条（命题 A／R-B／R-C／VoI／calibration beta／E2 R3／D2 model／阶段 5 检索式／ACR full 窗）＋4 设计层拒绝（专家网络／乘法公式／因果图反事实／辩论主持），四要素校验全过。
- **测试 415/415 绿**（406 → ＋9）。

## 3. 诚实降级与挂账（未做完的部分）

1. **滞后集合 3 档秩检验（Watson）**：**未实现**——逐对（城×lead）数据不在任何落盘件里（`stage5-forecast-signal-20260915.json` 只存汇总/判据/覆盖，无逐对序列）。报告内如实标 **n/a 并写明缺什么**，不编数。补齐前提＝信号管线补落逐对件（属第 3 期厚格队工作）。
2. **成本台账**（蓝图 §2.2#6）：**未做**——`verdicts` 表无 token 列（10 列实查无 usage），`llmChat` 的 usageStats 仅内存。本批已加 cached_tokens 打点（往台账走的第一步）；完整台账需 LLM 调用路径落 usage（改动面涉及判词跑批，另批评估）。
3. **9 臂先导 λ̂**：**未做**——λ̂ 的定义在项目内尚无冻结文本（Satopää 2014 语义 vs 辩论同质性的两种口径并存）⇒ 按「判据须先冻结」纪律不凭记忆造判据；建议先出 λ̂ 定义 PREREG（0.5 天）再算。

## 4. 验证

- 测试 415/415；三新测试含：zero-write（生产库 sha 前后不变）、确定性（两次逐位相等）、四要素独立复核（测试自己重验文件存在，不信任脚本自证）、bundle 禁词。
- 全部新脚本零写库（u8-columns/negative-results 纯读；llmChat 改动为 additive 计数）。

（P0+ 收据完 · 2026-09-16）

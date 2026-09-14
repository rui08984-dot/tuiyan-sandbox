# 任务 6 · 批次 3 收据 —— 结构化读数 ＋ kind 目录表 ＋ F4 同批账本操作 ＋ 命名归档（2026-09-14）

> 用户令：「任务 6 我同意」⇒ 批次 3（结构化读数／kind 目录表，与 F4 同批动账本）＋ 命名整理（以「归档＋脚本目录」替代破坏性改名）。
> 执行纪律：每项「改前快照 → 改后对比 → 零翻转核验 → 留痕」；测试全绿；四件套（收据/留痕/README §4.5/p19 锚）。

## 一 · B1-1 结构化读数（基率单一真源）

| 项 | 内容 |
|---|---|
| 新模块 | `p1b/src/evidence/baseRate.js`——原语（分数/占X%/基率=/组合数理论值/样本量抽取）＋**三条既有读序**（L2 序、G2 序、L5 三态）收敛为一份 |
| 三处委托 | `src/engines/l2_baseline.js`（parseCount/parseBaseRateNote）、`scripts/g2-report.cjs`（parseNoteN/parseBaseRate）、`src/engines/l5_sources.js`（parseCertifiedFromNote）——**逐字等价**；`l3_aci` 透传 |
| 结构化字段 | `evidence[i].baseRate = { p, n, k, kind:'empirical'\|'certified', window, basis, cmp, threshold, schema }`；写端随行落库＝**store 唯一写入口 `insertPrediction` 物化**（覆盖全部语料写手；物化值＝同注记解析读数 ⇒ 零翻转由构造保证）；读端结构化优先、文本兜底 |
| 读端接线 | `stage4-run.cjs`（L2/L3/L5 三处）／`g2-report.cjs`（④ b 值 + 结构化 vs 文本不一致计数）／`intake.js`（`evidence.baseRate` **形态判别**：结构化走新路、旧「计数」别名零变化） |
| **零翻转实测** | `stage4-run` 改前改后 JSON diff＝**0 处**；`g2-report`＝**1 处**（仅新增披露节 `baserate_structured_read_report_only`，值 0/0）；五门读数一字未动 |
| 金样冻结 | `p1b/scripts/base-rate-golden.cjs`（重构**前**逐字实现冻结器）→ `p1b/test/fixtures/base-rate-golden.json`（51 kind × ≤3 条去重注记＝**151 条**真实样本，三读序输出）；`p1b/test/base-rate-module.test.cjs` 10 例逐条回放 |
| 旧行 | **零改动**（无结构化字段 ⇒ 走文本，读数逐字不变）；老行物化**不做**（三读者读序不同，物化须保 pattern 才不翻转，收益低风险高）——留作 F4/D2 账本批可选项 |
| 顺手修 | stage4-run 陈旧文案（「覆盖 L2/L3/L5 三层」→ 五层，纯文字）；intake 计数别名冲突（形态判别） |

## 二 · B1-2 kind 目录表

- `p1b/scripts/kind-table.cjs`（只读生成器）→ `docs/specs/kind-目录表.md` ＋ `p1b/sim/out/kind-table-latest.json`
- **52 kind**（有账本行 51／仅契约 1）；列：取数源（账本真实 URL 主机，回退 resolver 源码内联域名）｜契约必需参数｜one_of 组｜层:题数｜引擎（L2/L3 基率引擎／L5 认证注册表 N 变体／未注册如实标注）｜题数｜已解｜源码现位｜备注
- 真发现：契约表 `src` 行位是**冻结时旧位**（文件增长后漂移）⇒ 表内改用**抽取器给的现位**并注明；下划线 helper 契约单列（不进主表）
- 测试 `p1b/test/kind-table.test.cjs` 2 例（临时库四类 kind 全覆盖＋在库产物契约 sha 防换版）

## 三 · F4 同批账本操作：truth_vault 真值镜像同步（**动了生产库，唯一一笔**）

| 项 | 内容 |
|---|---|
| 背景 | `truth_vault` 是 F4 一期的**一次性镜像**（`source='predictions'`）；`merged-migration` 只 INSERT 缺行、不 UPDATE ⇒ 之后 `resolvePrediction` 只写 predictions，vault 不再跟随。**F4 自己的对账函数当前 ok=false**（实测：vault 1923／predictions 1935、25 行真值列不一致、12 行缺失） |
| 工具 | 新 `p1b/scripts/vault-sync.cjs`：dry-run 默认；`--confirm` 先**在线快照**（backup API，防 WAL 未 checkpoint 丢数据）再单事务写；写后对账 missing/orphan/diff 与 integrity 全过才收工；**孤儿只报告不删**；predictions **全列 dump sha256** 前后一致＝「只动 vault」证据 |
| 实排 | ①副本演练：insert 12／update 25／6ms／predictions 零改动／integrity ok；②回滚剧本实测（用写前快照覆盖 ⇒ 回到 missing=12/diff=25 原态） |
| 落库 | **写前快照** `.scratch/backup/p1a-pre-vaultsync-2026-09-14T15-11-50-344Z.db`（sha256 `f4b253e9…`，integrity ok）；写后 vault **1935 == predictions 1935**、missing/orphan/diff **全 0**、integrity ok；stage4 读数**零变化** |
| 环境披露 | 写入时用户 8787 服务在跑（PID 15236，同日 12:18 起）——本操作为**单事务小写入**（6ms，无 DDL、不改 predictions），WAL 并发安全；事后本机只读复核通过。若有异常，回滚＝覆盖快照文件 |
| 测试 | `p1b/test/vault-sync.test.cjs`（临时库三态＋孤儿只报告＋dry-run 逐字节零写＋回滚快照可读） |

## 四 · 命名整理（归档 ＋ 脚本目录）

- 全库单遍扫描（排除 `.dshwolf/` 会话导出）：84 个下划线前缀候选中 **69 件零活引用** ⇒ `git mv` → `p1b/scripts/archive/`（保历史；`archive/README.md` 说明路径映射与「为何不改名」）；**15 件有活引用留置原位**（`_sqlite-guard.cjs`／`_rollback-template.cjs`／被收据点名的核对探针等）
- `p1b/scripts/scripts-index.cjs` → `p1b/scripts/README.md`：**在役 73 脚本**按前缀分组（使用者友好面／corpus-／g2-／stage4-／prereg-a-／其余），每行「一句话＋写库标记（63 只读／17 可写库——默认 dry-run、`--confirm` 才写）」
- 零破坏：未改任何文件名前缀；历史文档里的旧路径仍可按 `archive/<name>` 解析

## 五 · 测试与全局核验

- `cd p1b && node --test`：**284/284 绿**（271 → 281 → 283 → 284，批次 3 新增 13 例）
- 零翻转：`stage4-run`／`g2-report` 改前改后 diff 见 §一；vault 同步后 stage4 复跑仍零差异
- 账本：integrity ok；predictions 1935 未动（dump sha 证据）；truth_vault 1935 一致；verdicts 4765
- 阶段 5：立项书 v1.1 ＋ PREREG 骨架（未冻结）＋ 独立评审（16 发现／8 必改已并入）——**待用户拍板，拍板前不写检索代码**

## 六 · 提交

| commit | 内容 |
|---|---|
| `6084521` | B1-1 结构化读数（模块＋委托＋结构化字段＋零翻转＋金样） |
| `c03d542` | B1-2 kind 目录表（生成器＋文档＋测试） |
| `7e96cc5` | F4 同批账本操作（vault 同步＋快照＋测试） |
| `3621952` | 命名整理（归档 69 件＋脚本目录索引） |
| 本次末笔 | 阶段 5 立项书 v1.1 ＋ 评审报告 ＋ PREREG 骨架修订 ＋ 四件套 |

（收据完 · 2026-09-14 · 任务 6 批次 3 全部落地 · 阶段 5 待拍板）

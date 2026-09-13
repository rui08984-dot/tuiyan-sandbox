# PREREG · 命题 A「证据块 3.0 消融」v1（**已冻结** 2026-09-13 · 专家会统一清单 #14）

> sha256：`5d6907d1910acab842b92a172714d44b13cadf474f33d45008ea67f0a6098845`（本行整行剔除后的正文 UTF-8 字节口径；计算命令见 §7）
> 上游：`.scratch/forecast-debate/研讨会-20260913/00-专家会纪要与裁决.md` §3 议题三（命题 A＝限时抢跑；P1 五条件）＋ §6 排程批次 4 ｜ `交叉对抗-合议纪要.md` §1.4 #14 ｜ `查阅A-外部对标.md` §2.2（空位话术＝「未找到同构物」）与 §4/§5。
> 效力：本文件冻结后即消融实验的**唯一判据来源**；开跑前不得再改。任何改动＝新建 `PREREG-命题A-3.0消融-v2.md` 并**回链本文件**（sha256 留痕）。
> 状态：**已冻结，未开跑**。本回合只做前置核查与冻结——**零实验、零 LLM 调用、零写库**。

## §1 前置核查（只读实测，2026-09-13）

| 项 | 值 | 判定 |
|---|---|---|
| **已 resolve 的 sim 判词点** | **1349**（distinct prediction_id×prompt_variant） | **≥120 ✓**（P1 条件二满足） |
| 可用 sim 局数 | **31**（game_type 全为 `werewolf_sim_6p_onenight`） | — |
| sim 题/解 | 450 题，**全部已 resolve**（L1 180 / L6 270） | 开卷样本（R1-F14 已登记），本消融不改变该事实 |
| verdicts 三批量 | R-A **268 行**（run_id NULL）／R-B **1080 行**（run_id `ca1b5cdbddfc`）／R-C **1072 行**（run_id `f4f760aa50e1`） | 各 3 路（v1_evidence / v2_skeptical / v3_baserate） |
| 可配对（同题同路，双批次都在）上限 | **1071** 点（R-B ∩ R-C）；另单批 10 点、R-A 268 点（run_id NULL） | **≥120 ✓** |
| 题源列口径 | 题域过滤须走 `games.source='sim'`（`predictions.source_type` 恒为中文「预测卡」，不可作域过滤） | 已实测确认 |

**可复现 SQL（只读；better-sqlite3 打开须 `{readonly:true}`）**
```sql
-- 1) 已 resolve 的 sim 判词点
SELECT COUNT(DISTINCT v.prediction_id || '|' || v.prompt_variant) AS pts
FROM verdicts v JOIN predictions p ON p.id = v.prediction_id JOIN games g ON g.id = p.game_id
WHERE g.source = 'sim' AND p.outcome IS NOT NULL;
-- 2) 可用 sim 局数 / sim 题
SELECT COUNT(*) FROM games WHERE source='sim';
SELECT COUNT(*) FROM predictions p JOIN games g ON g.id=p.game_id WHERE g.source='sim';
-- 3) verdicts 三批量
SELECT run_id, COUNT(*) rows, COUNT(DISTINCT prediction_id) pids FROM verdicts GROUP BY run_id;
-- 4) 同题同路可配对上限（双 run 都在）
SELECT COUNT(*) FROM (SELECT v.prediction_id, v.prompt_variant FROM verdicts v
  JOIN predictions p ON p.id=v.prediction_id JOIN games g ON g.id=p.game_id
  WHERE g.source='sim' GROUP BY v.prediction_id, v.prompt_variant HAVING COUNT(DISTINCT v.run_id) >= 2);
```
运行：`node .scratch/d2/probe9-sim.cjs`（只读探针，落盘为收据；p1a.db 全程 readonly）

## §2 配对设计（单变量）

**配对键**＝`(prediction_id, prompt_variant, temperature, model)` —— 同题、同路、同温、同模型；**只允许证据块版本变化**（题源/判据结构/跑批链/写回口径一律不变，对齐 PREREG-RC 的单变量声明范式）。

**三臂**（缺一不可）：
| 臂 | 内容 | 开关 |
|---|---|---|
| **A 消融臂** | 3.0 ＝ 2.0 三段 + **d 段机械矛盾特征**（reliability 用真实特征内容） | `P1B_EVIDENCE_V3` 默认开、`contradictions` 默认开 |
| **B 对照臂** | 2.0（三段式） | `P1B_EVIDENCE_V3=0` 或 `contradictions:false` ⇒ **逐字节退回 2.0 形状**（既有测试已锁） |
| **C 等 token 空特征对照臂** | 3.0 结构 + **等长度空/打乱特征**（同 token 预算、零特征内容） | 新开关（实现侧待做，见 §6 未落地件） |

- **主对比**＝A vs B（3.0 相对 2.0 的边际贡献）。
- **正效应宣称的附加必要条件**＝**A vs C 也达阈**；否则只能宣称「多喂字有用」，不得宣称「矛盾特征有增量」（P1 条件三；合议 §2.1 已把该对照臂由「可选」升为「正效应时的必要件」）。
- 禁用 median 聚合顶替单路（沿用 R-A §五）；主判据取**该路单路读数**。

## §3 主判据

- **主量**：逐配对差值 `ΔBrier = Brier(B) − Brier(A)`（正值＝3.0 更优）。
- **判据**：`ΔBrier ≥ 0.02` **且** bootstrap 95% CI（配对重采样 B=1000，种子 **987654321**）**下界 > 0**。
- **阈值 0.02 由数据前定，理由两条**：① P1 自带门槛（合议纪要 §2.1 原文「Murphy 预注册主假设 + ΔBrier<0.02 + bootstrap CI + n≥120 + 禁重跑」）；② 量级校验：n≈1080、b≈0.30 时 §4.2.1-K2 统计容差 `1.96·√(V/n)≈0.011`，0.02 ≈ 其 **1.8 倍** ⇒ 超阈才作方向性结论。
- **Murphy 分解同时必报**（`Brier = reliability − resolution + uncertainty`，10 等宽桶，操作化照 design §4.2.3-B5）：主结论看 **resolution 增量**；ECE(binned) 仅记账（恒挂「下界估计＋小样本正偏」双标注）。
- **分层分区报**：L1 与 L6 **分别报、禁混算**（design §4.3）；每区报 n / Brier_A / Brier_B / ΔBrier / CI / reliability / resolution。
- **双窗（§5）两套各自独立计分**，禁止把两窗合并成单一读数。

## §4 n 与功效

- 目标完成配对 **n ≥ 120**（P1 条件二）；存量可配对上限 **1071** ≥ 120，故 n 有达标条件（3.0 消融需两臂**新跑**，本回合不跑）。
- **降级条款**：若实际完成配对 n < 120，或 bootstrap 95% CI 含 0，或 ΔBrier < 0.02 ⇒ **只发方向性信号**（照 design §4.2.3 的 Wilson/n≥35 精神：报点估计 + CI，不下「证得」结论）。
- **可宣称方向成立的充分条件**（须全部满足）：n≥120 ∧ ΔBrier≥0.02 ∧ CI 下界>0 ∧（正效应宣称时）A vs C 同样达标。
- 功效说明：配对设计消掉题间难度方差；Δ 的标准误 ≈ 逐对差值 sd ÷ √n。n=120 时对 sd≤0.22 的效应可检出 0.02（近似上界估计；实际以数据前定的 b 与实测配对 sd 反推）。**报告必须附 sd 与 CI**。

## §5 stop-rule 与双窗

**stop-rule**（照 R-A/R-B/R-C 先例）
1. 一次跑完，禁止择优重跑；工程故障重跑 ≤2 次且只修工程故障（网络/超时/抽取崩溃）；第 3 次即停，如实报告失败分布。
2. **不达标即止发负结果**：Δ 未达阈或 CI 含 0 ⇒ **负结果定版发布**（负结果也是资产），不得改口径再跑。
3. 跑前归档：verdicts 全量归档 + predictions 快照；PREREG 任何改动＝版本递进留痕。

**双窗（分别预注册，禁止合并）**

| 窗 | 定义 | 依据（ACR 二期） |
|---|---|---|
| `cutoff` | 只用 cutoff 前事件（发言结束/计票前） | cutoff 口径三类 PASS：0.0875 / 0.0850 / 0.0422（阈值 0.15） |
| `full` | 含计票/终局（≈生产 see-all 口径） | full 窗 0.6485 **FAIL**（≈7× 噪声）⇒ 漂移由**喂给 LLM 的事件窗**决定 |

- 两窗**各自**出主判据与 Murphy 分解；任一窗不达标＝该窗负结果，**不得**用另一窗掩盖或平均。
- 报告须明示每题的窗归属，**禁止跨窗池化**。

## §6 命名、话术与域边界

- **禁**「全网空白」；一律用「**未找到同构物**」，引用时点名最近亲：Polymarket 市场级预定义规则（经济版预注册）、ForecastBench 难度调整 Brier Index ＋双向固定效应（事后统计版分层）、Reciprocal Scoring（不可结算版）。
- **目标表述（冻结）**：**「首个社交推理域 Brier 边际贡献分解」**——不得扩写成「通用预测能力」或「AI 会预测未来」。
- **报表命名**：对齐 WOLF 四分类（omission / distortion / fabrication / misdirection），使消融结果与文献可比。
- **域边界**：低温单路（本消融）结论**不外推**高温臂（A0/A2）；高温臂解读另挂 2607.08046 对照，增量被压缩时按 K4 负结果保护处置。
- **反身性**：本件属内部推断，不公开进被预测系统（B-泼冷水公开性门）。

## §7 冻结声明与版本递进

- **冻结时刻**：2026-09-13（本文件落盘即冻结）。
- **sha256 计算规则（可复现）**：取本文件 UTF-8 字节，**剔除文首 `> sha256：…` 整行（含行尾换行）**后做 SHA256。计算命令（pwsh）：
  ```powershell
  $p='.scratch/forecast-debate/PREREG-命题A-3.0消融-v1.md'
  $t=[IO.File]::ReadAllText($p)
  $b=(($t -split "\n") | Where-Object { $_ -notmatch '^> sha256：' }) -join "\n"
  (Get-FileHash -InputStream ([IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes($b))) -Algorithm SHA256).Hash.ToLower()
  ```
  （哈希值已写回文首；复算不一致即视为被改动。）
- **版本递进**：本件一旦冻结，任何改动＝新建 `PREREG-命题A-3.0消融-v2.md`，文首必须回链本 v1 的 sha256；**v1 不删**。

## §8 开跑前仍缺的件（如实登记；本回合不做）

1. **C 臂（等 token 空特征对照）实现开关**尚未落地 —— 若 A vs B 为正而未跑 C，只能宣称「多喂字有用」，**不得**宣称「矛盾特征有增量」（P1 条件三）。
2. **双窗跑批参数**（cutoff vs full 的事件窗选择）需在跑批命令层显式落盘，并与 ACR 二期口径对齐。
3. **bootstrap 脚本**（配对重采样 B=1000、种子 987654321、输出 CI 与 Murphy 分量）尚未落盘。
4. **跑前归档**：verdicts 全量归档 + predictions 快照（照 R-A 四要素之「撤回留痕」）。

---
（PREREG-命题A-3.0消融 v1 · 已冻结 2026-09-13 · 依据专家会统一清单 #14 · 开跑前不得改，改动走 v2 回链）




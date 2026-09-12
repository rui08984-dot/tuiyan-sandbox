# R-B 负结果归因诊断 · C2 账本证据信号检验（零 LLM · 只读 · 探索性 · 2026-09-13）

> 脚本：`p1b/scripts/rb-attribution.cjs`（复跑：`node p1b/scripts/rb-attribution.cjs`；readonly 连接+query_only，全文件无写语句）· 全量输出回执：`.scratch/forecast-debate/_rbattr-receipt.txt`（113 行）
> 问题：R-B 360×3 判词≈分题型常数基率（负结果）——**C2 时点的账本证据里到底有没有可判别信号？**

## 1. 口径与管线校验

- 特征全部 **cutoff=C2 前可观测**（夜死公告/发言/claims）；计票/终局/roles/wolves 只用于 outcome 复算对照，绝不进特征。12 型 outcome 复算 vs 落库 resolve **全 30/30 一致**；分型基率逐项复现 p16 计分表（如 T1 0.5667/floor 0.2456、T6 0.6333/0.2322）；判词端 Brier 由 implied_prob 复算亦复现 p16（v1@T1 0.2579、v1@T6 0.1457、v1@T7 0.3491）——三重交叉验证通过。
- 统计口径：n=30/型，**只报方向与效应量**（|r| 分档 <0.1≈0/<0.2 small/<0.4 moderate/≥0.4 large），**禁 p 值**；Brier 差的噪声带 ±0.06 对齐 PREREG-RB v1。

## 2. 特征定义（机械，全部 C2 前）

| 特征 | 定义 | 备注 |
|---|---|---|
| stmtN_total / chars_total | 发言条数 / 发言总字数 | 局级；stmtN 恒 5（r 恒 0） |
| claims_total / idclaims_total | 声称总数 / 身份声称数（is_wolf/is_good/claims_role） | claims 表 JOIN events；**C2 可数** |
| wolfacc_total / accused_distinct / top_accused | 指认总数 / 被指认席位数 / 单席最高被指认数 | is_wolf 且指认者≠被指认者 |
| victim / first_speaker | 首日死亡席位 / 首讲者席位 | 夜死公告在 C2 前已公开 |
| x.*（仅 T1） | X 席位的 isVictim/claims/accused/chars + X 本身 | X 从题面解析（=gid%6+1） |
| fs.*（仅 T6/T10） | 首讲者 isVictim/accused/chars/claims/seat | fs.isVictim 恒 0（死者不能发言） |

（§3 特征×outcome 相关与 LOO 见下块）

## 3. 信号检验：相关 + LOO 逻辑回归（1-2 特征，leave-one-out）

### 每型 top-3 特征（点二列相关 r；n=30 探索性）

| 型 | top1 | top2 | top3 |
|---|---|---|---|
| T1 | x.isVictim **−0.45(large)** | x.accused −0.43(large) | x.chars +0.33(mod) |
| T2 | idclaims_total **+0.70(large)** | wolfacc_total +0.68(large) | claims_total +0.60(large) |
| T3 | top_accused −0.37(mod) | chars_total +0.31(mod) | first_speaker −0.30(mod) |
| T4 | chars_total +0.42* | accused_distinct −0.34 | victim −0.33 |
| T5 | top_accused +0.35(mod) | accused_distinct −0.28(mod) | claims_total −0.19(small) |
| T6 | fs.accused **−0.70(large)** | chars_total −0.43(large) | top_accused −0.37(mod) |
| T7 | idclaims_total **+0.88(large)** | claims_total +0.75 | wolfacc_total +0.72 |
| T8 | wolfacc_total −0.28(mod) | idclaims_total −0.22 | claims_total −0.22 |
| T9/T9a | chars_total −0.48(large) | first_speaker −0.34 | victim +0.20 |
| T9b | victim −0.31* | first_speaker +0.30* | wolfacc_total +0.21 |
| T10 | fs.accused **−0.71(large)** | claims_total −0.32 | top_accused −0.32 |

* T4（27/30 true）与 T9b（29/30 true）近恒基率，相关不稳定仅记账。

### LOO 逻辑回归 Brier vs 基率下限（ridge=0.1；Δ=floor−LOO；±0.06 噪声带）

| 型 | 特征 | LOO Brier | floor | Δ | 判读 |
|---|---|---|---|---|---|
| T1 | x.isVictim+x.accused | 0.1383 | 0.2456 | **+0.1072** | **超噪声带=有信号** |
| T2 | idclaims+wolfacc | 0.1497 | 0.2456 | **+0.0958** | **超噪声带=有信号** |
| T3 | top_accused+chars | 0.2068 | 0.2322 | +0.0254 | 带内弱方向 |
| T4 | chars+accused_dist | 0.1112 | 0.0900 | −0.0212 | 无改善 |
| T5 | top_accused+acc_dis | 0.2292 | 0.2500 | +0.0208 | 带内弱方向 |
| T6 | fs.accused+chars | 0.1033 | 0.2322 | **+0.1290** | **超噪声带=有信号** |
| T7 | idclaims+claims | 0.0190 | 0.2400 | **+0.2210** | **超噪声带=有信号** |
| T8 | wolfacc+idclaims | 0.1556 | 0.1389 | −0.0167 | 无改善 |
| T9/T9a | chars+first_speaker | 0.1807 | 0.2100 | +0.0293 | 带内弱方向 |
| T9b | victim+first_speaker | 0.0403 | 0.0322 | −0.0080 | 无改善 |
| T10 | fs.accused+claims | 0.1060 | 0.2489 | **+0.1429** | **超噪声带=有信号** |

### 构造性规则（比 LOO 更硬）

- **T7 精确规则**：outcome ≡ idclaims_total≥10，机械复算与落库 resolve 一致 30/30 → **可复算预测 Brier=0.0000**（判词三路 0.3491/0.2365/0.2880 vs floor 0.2400）。
- **T1 确定性子规则**：X==夜死者 → C2 时点即知必 false，命中 4/30 局（题面参数 X 单特征 per-X LOO Brier=0.2292，带内弱）。

## 4. 判词端利用度（r(implied_prob, 特征)，runId=ca1b5cdbddfc）

| 型·路 | Brier | r(P, top1) | 读法 |
|---|---|---|---|
| T1·v1 | 0.2579 | **−0.96** (x.isVictim) | 确定性规则用了（victim 局 meanP=0.020，4/4）**但其余 26 局 meanP=0.796 vs 基率 0.567=过度自信**，整型不超基率 |
| T5·v1 | 0.2552 | **+0.71** (top_accused) | 方向跟随特征但未转化为超基率 |
| T6·v1 | **0.1457★** | **−0.69** (fs.accused) | 唯一超噪声带星的机理=部分用了最大机械特征（机械 LOO 0.1033 仍更低） |
| T10·v1 | 0.2008 | **−0.76** (fs.accused) | 用了信号，Δ=+0.0481 恰在噪声带内 |
| T7·三路 | 0.3491/0.2365/0.2880 | +0.14 / +0.05 / −0.14 | **精确可复算规则三路全部未利用**（|r|≤0.14） |
| T2·v1 | 0.4658（29 行实测；p16 含 impute 行=0.4566） | +0.35 (idclaims) | 部分跟随，不足 |

**工程事实（读端源码 routes/verdicts.js loadEvidence）**：v1 证据块只渲染 **events**（每条 raw_text 截 200 字；发言中位 178 字、16% 被截），**结构化 claims 表从不注入**——T7 精确规则需要数的 325 条 claims 只能从 5 段发言散文中人工数；v2_skeptical 纯题面零证据（信息差对照臂，by design）。

## 5. 三段式定性结论

1. **域层：C2 账本证据非空。** 12 型中 **5 型（T1/T2/T6/T7/T10）**机械 1-2 特征 LOO Brier 超噪声带跑赢基率下限；T7 存在 Brier=0 的精确可复算规则；T1 存在确定性子规则。仅 T4/T8/T9b（近恒基率）机械也零信号——域空结论只对这三型局部成立。
2. **管道层：证据呈现有可指认缺口。** 结构化 claims 未注入判词（发言散文可读但需跨段计数）；每事件 200 字截断（咬合 16%）。T7 精确规则的丢失首因在此。
3. **模型层：判词未充分利用已可见的信号。** 确定性规则会用（T1 victim r=−0.96）但其余局过度自信（meanP 0.796 vs 基率 0.567）；大信号特征部分跟随（T5 +0.71、T6 −0.69、T10 −0.76）却未稳定转成超基率 Brier；v1@T6 唯一星的机理与机械最大特征一致，说明**信号是真实的、判词只抓到了零头**（T6 机械 LOO 0.1033 vs 判词 0.1457）。

**主定性（回答晨间问题）**：R-B 负结果 ≠ 「C2 证据对题型结局信息性为空」。定性=**「LLM 判词未充分利用 C2 可用信号」（模型/prompt/证据呈现结论），辅以局部域空（T4/T8/T9b 三型）**。晨间方向：修判词端优先于废题源——①证据块加结构化 claims 计数行（对 T7/T2 是构造性增益）；②特征化证据摘要（victim/首讲者/指认集中度）；③校准修正（确定性规则之外压回过度自信）；④T4/T8/T9b 从 R-B 型池剔除或改判据（近恒基率无信息空间）。机械 1-2 特征已给出 0.10-0.22 Brier 的可达提升带（T7 0.24→0）。

## 6. 诚实边界

- **探索性**：12 型 × ~19 特征 × 3 路相关矩阵未做事先注册，多重比较下 large 档亦可能有假阳性；构造性规则（T7 30/30、T1 子规则）不受此限。
- **n=30/型**：一切数字仅方向/效应量证据，禁结论性 p 值语言；LOO 逻辑回归在可分小样本偏乐观（T7 0.019 为构造性上限非泛化宣称）；±0.06 噪声带沿用 PREREG。
- 特征=机械可观测口径，与判词 prompt 实际注入内容的差异已单列（§4 工程事实）；本诊断未复跑任何 LLM、未写库任何一行（readonly+query_only 双保险）。
- 复跑：`node p1b/scripts/rb-attribution.cjs`（终端输出=回执同款）。



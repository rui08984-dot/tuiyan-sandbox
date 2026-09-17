# 收据 · 赔率题落库（英超 1X2 首版 · 20 题）（2026-09-17）

> 授权：用户 2026-09-17「**赔率题落库，首版英超 1X2**」。
> 依据：`docs/specs/第二期广域普查-体育赔率接入草案-20260917.md`（首版赛制＝英超 1X2；Q0-2/Q0-3 三问预检）＋蓝图附录 A2「体育赔率＝金矿」（市场提前发布的概率定价＝ previous_dayN 信号在体育域等价物）。
> 程序：**safe-mutation 五件**（在线快照／副本演练／行数变化／零翻转 diff／偏差披露）逐条见 §2。
> 纪律：零 LLM｜**库写入＝INSERT-only**｜key 不出服务端（铁律⑤）｜配额纪律（免费层 500/月）。

## 0. 一页结论

| 项 | 值 |
|---|---|
| **写入** | **+20 题**（kind `oddsapi_h2h`，layer L2，`assigned_prob`＝市场共识 p(主胜)，`outcome` NULL 待结算）＋**+1 容器局**（`corpus:oddsapi`） |
| **真值锚** | `resolve.kind='oddsapi_h2h'` ⇒ resolver 已加（`corpus-resolve.cjs`），源＝`/v4/sports/<league>/scores`（**实测 HTTP 200**；配额 remaining **494**） |
| **零翻转** | **14 表 sha 逐位不变**；`games` +1（容器局）、`predictions` +20（预期）；**旧行区段（id ≤ 1972）sha 完全相同** ⇒ 只增不改 |
| **vault** | `vault-sync --confirm` ⇒ vault 1972 → **1992**、missing 0、orphan 0、`ok=true`（凡写 predictions 必跟 vault-sync） |
| **测试** | **482/482 pass**（新增 `odds-questions.test.cjs` **5 例**） |

## 1. 交付件

| 文件 | 说明 |
|---|---|
| `p1b/scripts/odds-questions.cjs` | 出题器（纯函数区可 require）：Q0-2 两条／Q0-3 基带／canon 幂等／`--confirm` 才写；**离线**（无 fetch） |
| `p1b/scripts/corpus-resolve.cjs`（改） | 新增 resolver **`oddsapi_h2h`**（**判定规则单一实现**＝require 出题器 `h2hOutcome`）；key 读 gitignored 配置、缺 key ⇒ pending（不崩不写）、**不回显 key** |
| `p1b/test/odds-questions.test.cjs`（新） | 5 例：三向判定／**真实夹具回收**／Q0-2+Q0-3+lead_hours／canon 稳定性／CLI dry-run 零写＋require 零副作用 |
| `p1b/test/fixtures/odds-scores-sample-20260917.json`（新） | **实抓 API 响应**（The Odds API scores；**不含 key/URL**）⇒ 规则对真实数据的回收金样 |
| `docs/specs/kind-目录表.md`＋`p1b/sim/out/kind-table-latest.json`（重生成） | kind 52 → **53**（`oddsapi_h2h` 在列；该 kind **无契约条目**——见 §4 偏差披露） |

## 2. safe-mutation 五件（逐条）

1. **在线快照**：`.tmp/odds-pre-write-20260917-170928.db`（**5.5MB，sha256 `e129b56637253beb…`**；用 `VACUUM INTO`——`node:sqlite` 本版无 `backup()`，且**禁拷 .db 文件**（会丢 WAL））；另有 `vault-sync` 自建的 `.scratch/backup/p1a-pre-vaultsync-…db`（sha256 `bac91dd48c9ef14d…`，integrity=ok）。
2. **副本演练**：`.tmp/odds-drill.db`（＝快照副本）先跑 `--confirm --db .tmp/odds-drill.db` ⇒ **1972 → 1992（+20）**、本 kind 20 行、字段齐（layer L2／g2_regime R4／outcome NULL／matures_at＝开赛日）；演练期间**生产库仍为 1972**（反查证明演练未误打生产——照 §80 事故教训：**用目标物的 diff 核，不用日志核**）。
3. **行数变化**：`predictions 1972 → 1992`（+20）｜`games 87 → 88`（+1 `corpus:oddsapi` 容器局）｜`truth_vault 1972 → 1992`（vault-sync 补 20 行未结题）｜其余 14 表 **0 变化**。
4. **零翻转 diff**（指纹口径：每表 **COUNT ＋ 全列 dump sha256**，共 16 表）：除上条两表外**全部逐位不变**；`predictions` 的**旧行区段（id ≤ 1972）sha 逐位相同** ⇒ **INSERT-only**，无 UPDATE/DELETE 痕迹。
5. **偏差披露**：见 §4（四条，全部如实登记）。

## 3. 题面与语义（首版形态，实施选择）

- **每题＝「主队获胜」二值题**：`【forward】英超 <home> vs <away>（<开赛日> 开赛）主队获胜`；`assigned_prob`＝该场**去水后市场共识 p(主胜)**（`probs_mean[0]`，multiplicative 去水，24 家）。
- **cutoff 结构**：市场价＝**某张快照**（`snapshot_utc`）的定价 ⇒ `resolve.snapshot_utc` 即 cutoff 锚；入选题的**前置时间 lead_hours** 逐题留档（本批 35.6h–…，中位约 54.6h）。
- **档位说明（如实）**：草案设想「T ∈ {6h, 24h} 两档」——因**快照每 3 日一次**，自然形成的 lead 是「数天」量级（本批 35–80h）⇒ **本批按实际快照前置时间出题，不假装是 6h/24h 档**；若要精确档位，须把快照频率提到小时级（**配额不许**，见 §4③）。
- **三路口径全留档**：`evidence.marketPrice{p_home,p_draw,p_away,n_books,devig,prices_best}` ＋快照文件（逐家原始赔率）⇒ 日后扩「客胜/平局」题**不必重取**。

## 4. 偏差披露（如实，四条）

1. **无契约条目**：`oddsapi_h2h` 未进冻结契约 `g2-contract-frozen-r4.json`（那是**冻结件**，改动＝版本递进）⇒ kind 目录表里其「必需参数/组」列为 `—`。**本批不动契约**；是否登记属版本递进（须拍板）。
2. **layer＝L2 但无 `baseRate`**：市场共识**不是**历史频率（量纲不同，项目已立「同名不同量纲」警戒）⇒ 本批**不把市场价塞进 `baseRate`**，只放 `marketPrice`＋`assigned_prob`。其后果：**L2 引擎对这些题不出数**（无基率可解）⇒ 这些题目前只贡献「**市场先验 vs 结局**」这一路读数，不参与引擎分层读数。
3. **快照前置时间不经设计**：见 §3 档位说明（本批 lead 由 3 日采样自然决定）。
4. **样本极小且未结算**：20 题全部 `outcome IS NULL`（最早开赛 2026-09-18）⇒ 本批**零读数**，任何「市场准不准」的说法都还**没有证据**；首个结算将在开赛后由例行通道（`corpus-resolve-daemon`）完成。

## 5. 结算通道与后续

- **例行通道**：`corpus-resolve-daemon.cjs --once --due-only --confirm`（开赛后到期即结；`oddsapi_h2h` 走 `/v4/scores?daysFrom=3`，**每轮 1 次请求**）⇒ 结算后按纪律 **必跟 `vault-sync`** 与读数件刷新。
- **配额**：本批 API 用量＝探活/基准 4 ＋ 夹具抓取 2（remaining **494/500**）；出题器**零 API**（离线读快照）；采集＝每 3 日一次（已挂自动化 `automation-efa05952`，每 3 日 10:00，含冷却闸）。
- **不做**：不改契约（§4①）、不改快照频率（§4③）、不外推（§4④）。

（收据完 · 2026-09-17 · 英超 1X2 首版 20 题已落库 · 零 LLM · INSERT-only · 零翻转已核）

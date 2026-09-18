# 收据 · 到期题例行结算（66 条）＋ 读数刷新 ＋ ★两处缺陷（跨日测试／npm 空 URL）· 2026-09-18（二十五）批

> 触发：交接件 `.scratch/handoff/推演沙盘-交接-20260917-终态.md` §22／§23 的「下一步（a）」＝**09-18 复跑例行结算**（**例行通道，非拍板项**）。
> 纪律：**safe-mutation**（快照 → 副本演练 → 生产写入 → 零翻转核对 → 留痕）｜**progress-anchor**（锚 `docs/sandbox/p1b/itest/p25-例行结算-20260918-PROGRESS.md`，微步回写）｜8787 **未监听**（`netstat` 命中 0）⇒ 无其他连接持库｜零 LLM。
> 本批**不含**任何判据变更；不改口径；不动 PREREG；**未改任何冻结件**。

## §1 到期面刻画（写前，只读）

| 项 | 值 |
|---|---|
| 已到期未结（`matures_at ≤ 2026-09-18`） | **141** |
| 按层 | L2 **69**／L3 **64**／L5 **8** |
| 到期日分布 | 09-14: 3｜09-15: 4｜09-16: 13｜09-17: **71**｜**09-18: 50** |
| 未解总数 | 505（其中 `matures_at` 为 NULL 者 2） |

★与（二十）批的关系：该批末「到期 **91**」＝ 本批 141 减去**今日新成熟 50** ⇒ **昨日 pending 的自然收敛假设成立**。

## §2 执行（safe-mutation 五步）

1. **写前指纹**（可复算入口 `.scratch/p25/fingerprint.cjs`，只读打开）：predictions 1992/`5415aadd924712df`｜verdicts 5156/`d18ba8758d2601fb`｜truth_vault 1992/`54e1c77dc3a2ccdd`｜games 88/`0650ef60ace0e385`｜events 556/`9a3c4c3b882dff81`｜claims 447/`d37b8be0566cf1d0`｜resolved **1487**｜due **141**｜`integrity_check=ok`。证据 `.scratch/p25/fp-before.json`。
   · ★**跨批自证**：本批写前 predictions sha 与（二十）批收据的**写后**值 `5415aadd924712df` **逐位相同** ⇒ 上一批之后账本无第三方写入（该 sha16 为**表指纹，非 commit**）。
2. **写前 vault 态**：`vault-sync` dry-run ⇒ `truth_column_diff=0`／`ok=true`／`plan insert=0 update=0`（干净基线）。
3. **两份在线快照**（`VACUUM INTO`，脚本 `.scratch/p25/snapshot.cjs`；**禁拷文件**）：
   - `p1a-baseline-resolve-20260918.db`（**只读留存**作写前基线）
   - `p1a-drill-resolve-20260918.db`（**演练载体**，一次性件，用毕删除）
   - 两份 **6,033,408 B**／sha256 **逐位相同** `33b899258ff269010286269c927582b60fc0af8457dc64e9571c6a384d1aaa85`／六表行数与源一致／`integrity=ok`。证据 `snap-baseline.out.txt`／`snap-drill.out.txt`。
4. **副本演练**（`--db=<drill>`，**等号形式**；代理**于进程启动前设**）：**resolved 66／pending 58（含预筛 7）／fail 8／refused 0／同结论并发 0／口径护栏 8／unsupported 0／实打网 55**。
   · **双向核验**：副本**确被写**（resolved 1487→1553、predictions sha 变）∧ 生产**未被写**（指纹与写前逐位相同）⇒ 杜绝（十五）批「演练打在生产」的事故复现。
5. **生产写入**（**不带** `--db`）：日志首行 `db=E:\music player\p1a-terminal\data\p1a.db` ✓（实际路径恒入日志）⇒ **resolved 66／pending 58／fail 8**，与演练**逐项同数**。证据 `.scratch/p25/prod-run.out.txt`。
6. **零翻转核对**（`.scratch/p25/diff-rows.cjs`，逐表逐行逐字段）＋留痕（§3、§4）。

**环境配方**（照 §16③）：`NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:2080` 于进程启动前设 ⇒ 本轮 `实打网=55`、`取数失败=8`（明细见 §5）。

**写入了什么**（66 条，全为机检真值）：

| 维度 | 分布 |
|---|---|
| 按层 | L2 **32**／L3 **30**／L5 **4** |
| 按 outcome | false **34**／true **32** |
| 按引擎族 | `energycharts2_*` **33**（六国×五燃料：at/be/es/fr/it/nl）｜`openmeteo_wx2_*` **30**（temperature_2m_max 8／min 8／wind_gusts 8／precipitation_hours 6）｜`none_forward` **4**（cwl 双色球，L5） |

样例（**如实记录，不做解读**）：

| id | 层 | p | outcome | resolve_note（机检，截断） |
|---|---|---|---|---|
| 735 | L5 | 0.1818 | **false** | cwl 官方 2026108 期 red=06,11,13,14,20,28 blue=16（red 含 07，机检） |
| 736 | L5 | 0.5 | **false** | cwl 官方 2026108 期 red=06,11,13,14,20,28 blue=16（blue 为奇数，机检） |
| 1679 | L3 | 0.7018 | **true** | Open-Meteo daily.temperature_2m_max 2026-09-17=27.3（阈值 >= 23.8，机检） |
| 1762 | L2 | 0.403 | **false** | Energy-Charts es Load 2026-09-17 均值=28465.0417MW（阈值 >= 28502，机检） |

## §3 零翻转核对

| 表 | 写前 | 写后 | 判定 |
|---|---|---|---|
| predictions | 1992 行 / `5415aadd924712df` | 1992 行 / `14c519537f3eeb03` | **行数不变**；行级**恰 66 行不同**，变化字段**恰为** `resolved_at`／`outcome`／`resolve_note`（分布 `{resolved_at:66, outcome:66, resolve_note:66}`） |
| verdicts | 5156 / `d18ba8758d2601fb` | 同 | ✓ **逐位相同** |
| truth_vault | 1992 / `54e1c77dc3a2ccdd` | 同（vault-sync 后 `40cfd28639d4f2d0`） | ✓ 写前逐位相同；差异全部由 vault-sync 显式补齐 |
| games／events／claims | 88／556／447 | 同 | ✓ **逐位相同** |

计数：已解 **1487 → 1553**（+66）｜到期 **141 → 75**｜`integrity_check = ok`。证据 `diff-baseline-vs-prod.json`／`fp-after.json`。

**★确定性旁证（drill vs prod）**：66 行中 `outcome`／`resolve_note` **0 处不同**（逐字段比对），仅 `resolved_at` 全部不同——差值恰为两次运行时刻（13:05:27 vs 13:07:29）⇒ 写入路径**确定性**（差异可完全归因于时间戳）。

**vault-sync**：dry-run 显示 `truth_column_diff=66`／`plan update=66` ⇒ `--confirm`（自动在线快照 `.scratch/backup/p1a-pre-vaultsync-2026-09-18T05-08-37-830Z.db` sha256 `acea05431581f121…`／integrity ok）⇒ `updated=66`、**after: diff 0／ok=true**、**`predictions 零改动=true`**、`integrity=ok`。

## §4 读数刷新（读数**前进**，非口径变更）

| 维度 | 前（§22 末） | 后（本批） |
|---|---|---|
| L1 | 180 可计分，Brier 0.0000 | 不变 |
| **L2** | 342 可计分，Brier 0.2433 | **374 可计分，Brier 0.2418** |
| **L3** | 533 可计分，Brier 0.2388 | **563 可计分，Brier 0.2386** |
| **L5** | 34 可计分，Brier 0.1347 | **38 可计分，Brier 0.1354** |
| L6 | 270，Brier 0.1755 | 不变 |
| 门①／门④ | 1251／1057 | 不变 |
| **分域格数** | 29 格（可出结论 **8**） | **29 格（可出结论 8）** ⇒ 第 4 期放行门仍 **8 < 10** |
| u8（阶段 4 列） | — | 已重生成（L2 n=374／L3 n=563／L5 n=38／L6 n=270） |
| calibration-report | 20260917 版 | **20260918 版**（`cells_total=29`／`cells_with_conclusion=8`） |

**8 个可出结论格的构成（与上批同集合，内容前进）**：L1/werewolf_sim（n=180）｜L2/energycharts（n **67→99**，Brier 0.2403→**0.2357**）｜L2/dbnomics（n=79）｜L2/noaa（n=47）｜L2/wikimedia（n=38）｜L3/openmeteo（n **498→528**，Brier 0.2380→**0.2378**）｜L5/cwl（n **34→38**，Brier 0.1347→**0.1354**）｜L6/werewolf_sim（n=270）。**无新格、无丢格**。

**刷新命令（照 §16⑦ 纪律带显式输出路径）**：`stage4-run.cjs --json …/stage4-run-five-layers-20260918.json --text …/stage4-run-five-layers-20260918.txt`｜`u8-columns.cjs`｜`calibration-report.cjs`｜`board.cjs`。
★**过程自查（照 §16⑦ 纪律）**：`board` 首读仍显 **L2 342／L3 533（旧件）**——因 `board` 读的是**最新 `stage4-run-five-layers-YYYYMMDD.json` 真跑件**而非库 ⇒ **先核读数件时间戳再下结论**，未把「没变」当结论。

## §5 未解部分（75 条到期 + 其余）与原因（如实）

**本轮 pending 58（含预筛 7）／fail 8**，明细：

| 类别 | 条数 | 原因 |
|---|---|---|
| `openmeteo_forecast_daily_*`（wind_speed/sunshine/precipitation） | 23 | 「**2026-09-18 尚未到**」（前瞻事件未发生，不结算） |
| `ghcn_daily_tmax` | 10 | 「NCEI 尚无 2026-09-15/16 记录」（真值滞后） |
| `kraken_daily_close` | 6 | 「2026-09-18 尚未到（UTC 日未收盘）」 |
| `noaa_tide_daily_high` | 5 | 「2026-09-18 尚未到」 |
| `frankfurter_rate_range`（含预筛） | 7 | ECB 发布窗口（09-16~09-23／09-17~09-24）**尚未走完**，接口对未来区间 404 |
| `elexon_fuelhh_daily_mean`／`mlb_schedule_daily_total_runs`／`noaa_gml_co2_daily` | 4 | 当日数据未发布 |
| `cta_daily_total_rides` | 3 | CTA 无数据（**真值滞后约 2.5 月**） |
| **fail** `dlt_draw_result` | 4 | **HTTP 567**（老问题，与（十五）（二十）批同因） |
| **fail** `npm_downloads_window` | 4 | ★**新缺陷**——见 §6.2 |

⇒ pending 部分**次日复跑同一命令即可自然收敛**（**勿手改 `matures_at`**）；`cta` 属长期滞后；两个 fail 类**不会自愈**。

## §6 ★三处缺陷（本批自查发现）

### 6.1 测试**跨日必红**缺陷（4 例）——**已修**

- **现象**：`node --test` 首跑 **4 例 fail**：`e2-combo-precheck`／`e2-r1-rules`／`lambda-overlap`／`mdl-retention` 的「真实件」测试。
- **根因**：这 4 例把产物文件名**写死成 `…-20260917.json`**，而脚本按**当天 UTC 日期**命名产物 ⇒ **每跨一天就必红**。属**潜伏缺陷**（写测试那天恰好是 09-17，故当日绿），**非本批引入**。
- **修法**：在各自**专属 tmpDir** 内**按前缀取唯一产出件**（`/^<name>-\d{8}\.json$/`）＋加「**恰好一份**」断言；写法取自同文件既有先例（`e2-r1-rules.test.cjs` ② 已如此取件）。
- **结果**：**513/513 pass / 0 fail**（证据 `/tmp/p25-test2.out` 尾部 `ℹ tests 513 ｜ pass 513 ｜ fail 0`）。**未新增测试**（513 与批前同数）。
- **同族登记**：这是「**测试依赖了会随日期/数据漂移的量**」类（承 §16① stage4 金样钉库、§16② 数据标记）。**可复用纪律**：**测试不得写死产物文件名中的日期**——一律按前缀取件或显式指定输出路径。

### 6.2 `npm_downloads_window` **空 URL** 缺陷（4 条题永久不可结）——**未修，交裁决**

- **现象**：`fetch-fail kind=npm_downloads_window x1 — Failed to parse URL from `（URL 为空串）×4。
- **受影响行**：**id 1969／1970／1971／1972**（`game_id=87`，`created_at=2026-09-15 13:28:59`，`matures_at=2026-09-18`，L2，题面＝「npm 包 react／vue／express／typescript 在 2026-09-18（UTC）的单日下载量 ≥ 阈值」）。**全账本内该形态恰 4 条**（`npm_downloads_window` 共 30 条，另 26 条为旧形态）。
- **根因（两代 spec 混存 + 守卫字段错配）**：
  - 旧形态（26 条，可解）：`{kind, url_template, package, start, end, threshold, cmp, field}`
  - **新形态（4 条）**：`{kind, pkg, date, threshold, cmp}` —— **无 `url`／`url_template`，且字段名从 `package` 变 `pkg`、从 `start`/`end` 变 `date`**。
  - `corpus-resolve.cjs` 的 `npm_downloads_window(r)` 早退守卫是 **`if (r.end >= shToday())`** ⇒ 新形态 `r.end === undefined` ⇒ `undefined >= "2026-09-18"` 为 **false** ⇒ **守卫被绕过**；随后 `getJson(subst(r.url_template || r.url, r))` 两项皆 undefined ⇒ **空 URL** ⇒ `fetch('')` 抛「Failed to parse URL」。
  - **对照**：其余 resolver 的守卫一律用 `futureDay(r.date)`（如 kraken／mlb／frankfurter）⇒ 新形态对它们无害（今日它们均正确返回 `pending`）。**唯 npm 的守卫字段是 `end`**，故只此一族中招。
- **影响面（量化）**：**恰 4 条**，全部**今日到期**，且**每日复跑都会再 fail 一次**（`fail` 不会自愈，与 `pending` 不同）⇒ 会在日志与 fail 计数里**持续产生噪声**；这 4 条**永远不会结算**（除非改 resolver 或改题）。
- **为何不自行修**：修法有二——① **改 resolver** 支持新形态（新增一条解析路径 ⇒ **会产出 4 条新读数**，属**口径变更**）② **改/重生成这 4 条题**（动账本既有行）。**两者都不是纯技术修补**，按 safe-mutation「**变更会改既有读数 ⇒ 须拍板**」与项目「**不擅自改口径**」纪律 ⇒ **本批只登记，交裁决**（已入交接件 §5 待办）。
- **同族登记**：这是「**同一 resolver kind 存在两代 spec 形态、而守卫只认其中一代的字段**」类 ⇒ 可复用纪律：**新增题目形态时须核 resolver 的早退守卫字段**（守卫绕过的失败模式是「静默走到网络层」，只在 URL 为空时才可见）。

### 6.3 地图 §10 **二进制泄漏**（`.db` 原始头进 markdown）——**已修 ＋ 已加回归锁**

- **现象（本批修 §56 时撞上）**：`项目全资源地图-20260914.md` 里 `p1b/test/fixtures/stage4-golden-db-20260917.db` 那一行的「一句话摘要」**是 SQLite 文件的原始头字节**（含 **70 个 NUL**）⇒ 该 tracked 文件对 `grep`／编辑器／Edit 类工具**变成「二进制」**（实测：Edit 工具直接拒改）。★**该污染已在 HEAD 中**（`git show HEAD:…` 复算：同 178,812 B／同 70 NUL）——承 §23「地图 A 类重刷」。
- **根因（经典静默失败）**：`file-map.cjs` 的 `headline()` 用 **`fs.readFileSync(p, 'utf8')`**，而**对二进制文件它不抛错**——非法字节被静默替换成 U+FFFD ⇒ 原写的守卫 `catch (e) { return '（不可读/二进制）' }` **从不触发**，于是 `SQLite format 3\0…` 被当作合法「句子」返回。
- **修法（三层，均 additive）**：
  ① **判据下移到字节层**：新 `isBinary(buf)`——**前 8KB 出现 NUL 即视为二进制**，不抽句（返回「（二进制体：不抽句；随目录级列出）」）。
  ② **出口 sanitize**：任何进入地图的文本行剥掉 C0 控制字符（NUL 等）⇒ 防未来再有异常字节泄漏。
  ③ **写盘前硬门**：产物若含 NUL ⇒ **exit 3**（禁把二进制泄漏写进仓库文件）。
- **刷新（A 类原位替换）**：`.scratch/p25/splice-section10.cjs` ⇒ §10 区块 **L544–L896（353 行）→ 364 行**；自校验＝**节编号集合 56 → 56、零丢零多**；产物 **NUL = 0**；`p1b/test/fixtures/stage4-golden-db-20260917.db` 行已走「不抽句」分支。备份 `.scratch/p25/map-before-splice.md`（sha256 `95c7d29b1a8a68ac…`）。
- **回归锁**：新测试 `p1b/test/file-map-binary-guard.test.cjs`（**4 例**）——① 前置（仓库确有二进制夹具且含 NUL）② **生成物无 NUL／无 `SQLite format`／无 C0 控制字符**＋二进制行走「不抽句」③ **对照组**（「不抽句」不得成为普遍分支 ⇒ 证明断言非恒真）④ 零副作用。
  · ★**非恒真实证**：用 `git show HEAD:p1b/scripts/file-map.cjs` 跑**修复前版本** ⇒ 生成物含 **143 个 NUL**（>0）⇒ **本回归锁在修复前必红**。
- **同族登记**：这是「**用 utf8 读二进制当文本用，而 catch 守卫因「不抛错」而失效**」类（承 §9「顶层写盘＋require」的静默执行、§6.2 的守卫字段错配）。**可复用纪律**：**判「是否二进制」要在字节层判（NUL 扫描），不要指望 utf8 读取抛错**；**生成类脚本的产物要加「无控制字符」出口自检**。

## §7 稳定性自证（数据前进后重跑 E2 预检两件）

| 读数 | §22 末记录 | 本批（数据前进后） | 判定 |
|---|---|---|---|
| combo 队列 cohort_rows | 1389 | **1455**（+66＝本批结算） | 前进 |
| 多引擎题 | 1120 | **1184** | 前进 |
| **L1×L6 ρ̂** | 0.011469（n=240） | **0.011469（n=240）** | **逐位相同** ⇒ 「不停用」结论不变 |
| **L2×L3 ρ̂** | ≡ 1.000000（n 875） | **≡ 1.000000（n 937）** | **判死不变** |
| RES 门 | 四层全过 | **四层全过**（L1 0.1475／L2＝L3 0.013383／L5 0.011901／L6 0.088568，CI 下界均 > 0） | 不变 |
| **R1-A 改层** | 0 | **0**（no-op 1425／降档 30） | **不变**（C2 的 Δ 仍构造性为 0） |
| R1 冻结件 | MATCH | **MATCH=true**（sha `e0331cf8e7237a8a…`） | 不变 |
| R1-B | 保留 8 格／降档 15 | **保留 8／降档 15**（涉 146 题） | 不变 |

⇒ **三条 E2 结论（改层 0／L1×L6 不停用／L2×L3 判死）均未被本次数据前进改变** ＝稳定性自证 **PASS**。

**连带（数据标记更新，照 §16② 先例）**：`p1b/test/e2-combo-precheck.test.cjs` 队列标记 **1389 → 1455**（加注「09-18（二十五）批再结 66 条」）；`e2-r1-rules.test.cjs` 保留格标记 **8 未变**（无需改）。
**重跑件**（同日文件名覆盖，收据留痕）：`e2-combo-precheck-20260918.{json,md}`｜`e2-r1-rules-20260918.{json,md}`。

## §8 边界

- 本批为**例行真值回填**（官方通道／机检真值／只写一次，`resolvePrediction` 拒改已 resolve 行）——**不构成**任何精度或质量宣称；66 条 outcome 分布（34 false／32 true）**如实记录，不解读**。
- 明日复跑前**不要**手工改 `matures_at`；pending 的自然收敛依赖数据源发布节奏。
- E2 的**冻结判据与 PREREG 一字未动**；§7 的两次重跑属**稳定性自证**（读数前进），非版本递进。
- §6.2 的缺陷**未修**（改 resolver＝新增解析路径＝口径变更 ⇒ 须拍板）；§6.1／§6.3 的修复**只动测试取件方式与生成器守卫**，不改任何生产读数（账本零写、判词零写、PREREG 零动）。
- **测试总数**：**513 → 517**（+4 ＝ §6.3 的新回归锁 `p1b/test/file-map-binary-guard.test.cjs`）；**517/517 pass / 0 fail**。

## §9 本批产物（可复算入口）

| 件 | 路径 |
|---|---|
| 锚 | `docs/sandbox/p1b/itest/p25-例行结算-20260918-PROGRESS.md` |
| 指纹工具／结果 | `.scratch/p25/fingerprint.cjs`｜`fp-before.json`／`fp-drill-after.json`／`fp-after.json`／`fp-final.json`／`fp-prod-check.json` |
| 快照工具／快照 | `.scratch/p25/snapshot.cjs`｜`p1a-baseline-resolve-20260918.db`（**留存**）｜`p1a-drill-resolve-20260918.db`（**一次性，用毕删除**） |
| 逐行 diff 工具／结果 | `.scratch/p25/diff-rows.cjs`｜`diff-baseline-vs-drill.json`／`diff-baseline-vs-prod.json` |
| 运行日志 | `.scratch/p25/prod-run.out.txt`｜`snap-baseline.out.txt`／`snap-drill.out.txt` |
| 地图刷新工具／备份 | `.scratch/p25/splice-section10.cjs`｜`.scratch/p25/map-before-splice.md`（sha256 `95c7d29b1a8a68ac…`） |
| 读数件（新） | `p1b/sim/out/stage4-run-five-layers-20260918.{json,txt}`｜`u8-columns-20260918.*`｜`calibration-report-20260918.{json,md}`｜`e2-combo-precheck-20260918.{json,md}`｜`e2-r1-rules-20260918.{json,md}` |
| 修复的代码／测试 | `p1b/scripts/file-map.cjs`（二进制守卫＋出口 sanitize＋写盘前 NUL 硬门）｜`p1b/test/file-map-binary-guard.test.cjs`（新，4 例）｜`p1b/test/{e2-combo-precheck,e2-r1-rules,lambda-overlap,mdl-retention}.test.cjs`（跨日取件） |
| vault 快照 | `.scratch/backup/p1a-pre-vaultsync-2026-09-18T05-08-37-830Z.db`（sha256 `acea05431581f121…`） |

（收据完 · 2026-09-18（二十五）批 · resolved 66／pending 58／fail 8 · 已解 1487→1553 · vault ok · 分域 29 格／可出结论 8 · 测试 **517/517** · 零 LLM · 三处缺陷已登记（2 修 1 交裁））

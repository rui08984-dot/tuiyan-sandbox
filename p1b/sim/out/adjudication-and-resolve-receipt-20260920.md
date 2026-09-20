# 收据 · 2026-09-20（（二十八）批）：两项裁决落地 ＋ 09-20 例行结算

> 触发：用户令「不用等我按你推荐的继续吧」⇒ ①对交接件待裁清单按推荐一次性放行（对 1＝C、Granger＝封存）②09-20 例行结算（例行通道）。
> 边界：**零 LLM**｜结算走 resolver 真网（代理启动前设）｜8787 零接触（写前记档未监听）。

## §1 裁决落地（两项，PREREG 厚格 v1.3 冻结承载）

- **v1.3 裁决件**：`.scratch/forecast-debate/PREREG-厚格基建总票-v1.3-裁决补充-20260920.md`｜**sha256 `49a381db14f7f49b74818b351eb6cd4423a3db4610f74b0155649d6983346536`｜MATCH=true**。上游 v1／v1.1／v1.2 复算逐件 **MATCH=true（原件零改动）**。
  1. **对 1（`OPEN_daily_max`）＝方案 C 暂不判读**：读数冻结（既不并入也不剔除，v1.2 的 4 对名单一字不改）；kNN 判读单元＝对 2/3/4；重启＝forecast 侧真值口径缺陷集处置**另行立项并经拍板**后按注册口径重跑。理由与读数无关（A 时点污染／B 与 11 号件①冲突／C 推迟到前提可落实之日）。
  2. **Granger 滞后臂＝封存**：不实现（`thickcell-replay` 维持「已登记未实现 ⇒ exit 4」）；重启条件写死＝序列历史值入库（另行立项＋拍板）**且**出现「过 C1＋C2 的格需要滞后维解释」的证据需求。
  3. **待冻结项 4（nowcast P2）＝已测量登记**（09-19 读数：in-gap 0／队列 117／桥接 59=50.4% FX 族为主）；P2 判据冻结仍留实现期。
- **Granger 负结果入账 H11**：`p1b/scripts/negative-results.cjs` 新增 H11 ⇒ 账本 **实证 11／设计 4**，四要素校验全过；账本件 `negative-results-ledger-20260920.{json,md}`。
- **回归锁扩容**：`p1b/test/decouple9.test.cjs` ⑨ 冻结件复算清单 3→**7** 件（E2 v1/v1.1／9 臂／厚格 v1/v1.1/v1.2/v1.3 逐件 MATCH＋sha 前缀锁定）。

## §2 结算五步（safe-mutation，p25/p26 同款）

1. **写前指纹**：predictions 1992/`4fada2ca53da9f62`｜verdicts 5156｜truth_vault 1992/`39d7aa9d06072784`｜resolved 1597｜due=76（09-20 面）｜integrity ok。
   ★**过程自查（比对基准错误，未写库前抓到）**：首查把「09-19 **演练副本**写后指纹」当对照基准 ⇒ 误报 DIFF。真相＝演练与生产两次运行的 `resolved_at` 必差（正是已登记的确定性旁证语义）；对 `.scratch/backup/p1a-pre-vaultsync-2026-09-19…db`（=生产写后态）diff **0 变化** ⇒ **无第三方写入**。**纪律沉淀：写前指纹的对照基准＝上一批收据的『生产写后』态（或其快照），演练副本 sha 永远≠生产 sha；收据应显式记录生产写后指纹。**
2. **两份快照**：baseline＋drill sha 逐位同 `4f60b7bf8f513928…`（6,066,176 B／integrity ok）。
3. **副本演练**：**resolved 33／pending 13（含预筛 7）／fail 6／refused 0／口径护栏 12／实打网 42**。
4. **生产写入**：日志首行库路径 ✓ ⇒ **逐项同数**（33/13/6）。
5. **零翻转**：predictions 1992 行、**恰 33 行不同**（字段恰 `resolved_at`/`outcome`/`resolve_note`）；五表逐位相同；**确定性旁证＝1,630 已解行 outcome/resolve_note 0 处不同**（drill vs prod 仅时间戳差）。

## §3 已解 33 条明细

openmeteo_forecast wind 8／sunshine 8／precip 7（L3 共 23）｜ghcn_daily_tmax 8（L3）｜**cwl_ssq_red_contains 1＋cwl_ssq_blue_odd 1（L5 双色球，机检）**。

## §4 读数前进（口径零变更）

| 层 | 09-19 | 09-20 | Brier |
|---|---|---|---|
| L1 | 180 | 180 | 0.0000（不变） |
| L2 | 385 | 385 | 0.2392（不变） |
| L3 | 589 | **620** | 0.2378 → **0.2386** |
| L5 | 38 | **40** | 0.1354 → **0.1357** |
| L6 | 270 | 270 | 0.1755（不变） |

分域 **29 格／可出结论 9（不变）**——**frankfurter ECB 发布窗口 ~09-23 才走完**（本批 7 条继续正常 pending 自愈中）⇒ 第 4 期门（≥10）**差 1** 的打开时点顺延至 **~09-23（frankfurter）或 10-01（binance）**。vault-sync：updated=33 ⇒ after **diff 0／ok=true／predictions 零改动=true**。

## §5 稳定性自证（PASS）＋测试

- R1-A 改层仍 **0**（no-op 1495/downgrade 37）｜**L1×L6 ρ̂=0.011469（n=240）逐位同**｜**L2×L3 ρ̂≡1 判死不变**（n 974→1005）｜R1-B 保留 **8** 格。combo 队列 1499→**1532**。
- **测试**：数据标记带注更新两处（combo 1499→1532／厚格池 630→**653**＝今日 L3 openmeteo +23，ghcn 不入厚格域）＋ **truth-basis 活库前提修复**（最后一批未解 forecast 行今日清零 ⇒ 该段改条件式：为 0 时状态断言＋跳过逐行检查，谓词语义由构造行用例覆盖；新前瞻题入库后自动恢复）⇒ **541/541 pass / 0 fail**。

## §6 产物索引

裁决：`PREREG-厚格基建总票-v1.3-裁决补充-20260920.md`｜`negative-results-ledger-20260920.{json,md}`｜结算：`.scratch/p26/fp-before-0920.json`／`p1a-baseline-resolve-20260920.db`（留存）／`drill-run-0920.out.txt`／`prod-run-0920.out.txt`／`diff-baseline-vs-prod-0920.json`（drill 载体批后删）｜读数件：`stage4-run-five-layers-20260920.{json,out}`／`u8-columns-20260920.*`／`calibration-report-20260920.{json,md}`／`e2-combo-precheck-20260920.*`／`e2-r1-rules-20260920.*`｜本收据｜锚 p28。

（收据完 · 2026-09-20（二十八）批 · 对 1=C／Granger 封存 H11／v1.3 冻结 49a381db · 结算 33 条已解 1630 · 分域 9 不变 · 测试 541/541）

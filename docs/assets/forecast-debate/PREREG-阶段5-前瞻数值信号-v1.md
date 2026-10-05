# PREREG · 阶段 5 路线 (b)「前瞻数值信号」 · v1

> **状态：冻结（2026-09-15）**
> **sha256 = `97a6524a83ed9aa7d19bda3fe42a0fc0f4a7be17f812ca8c1b645086ac9c78b8`**
> **冻结 commit：见 git log 本文件首次入库 commit**
> 本文件取代已归档的 `PREREG-检索式预测-v1-骨架.md`（路线 (a) 实证否决，见勘察件 §四）。
> **冻结后禁改**（铁律⑥）；改动＝版本递进 v1.1+。
> 上游：立项书 v1.1 §三 候选路线 (b)「前瞻数值信号（非 LLM）」｜勘察件 §八（可行性实测）。
> 铁律④裁决：路线 (b) **非 LLM** ⇒ **no-op**（立项书 §二-第三步明文）。

---

## §1 实验问题

**在同一批题（openmeteo_daily_max backfill）、同一真值（archive 实况）下，
引入「多模式存档预报」（previous-runs-api `previous_dayN`）作为独立第二信号，
能否把概率估计得比统计基率更准（配对 ΔBrier），且增量是真的。**

## §2 臂（2 臂；写死）

| 臂 | 来源 | 说明 |
|---|---|---|
| `base` | 账本 `evidence.baseRate`（archive 常年同月频率） | 与账本 assigned_prob 同源 |
| `signal` | `previous-runs-api.open-meteo.com` hourly `temperature_2m_previous_day{1,3}` | 提前 1/3 天**当时实际发布**的 GFS/ICON 存档预报（无未来函数，文档证实） |

**排除**：不允许中途增删臂；不允许换信号源；不允许换概率映射函数。

## §3 池与指纹

**资格谓词（全部满足）**：
1. `g2_regime='R4'`
2. `layer='L3'`
3. `outcome IN ('true','false')`
4. `resolve.kind='openmeteo_daily_max'`
5. `resolve.lat IS NOT NULL ∧ resolve.threshold_c IS NOT NULL`
6. `matures_at IS NOT NULL`
7. **非真值口径缺陷行**（`truthBasis.js` 排除谓词）
8. `previous-runs-api` 存档对该 `resolve.date` **有非空值**（否则该行计入 `no_val` 披露，不入配对）

**池**：105 道（上海/北京/广州/成都 × 2024-01-01..2024-11-22 + 2026-09-13..14）。
**有效配对**：93 对（12 道 previous-runs 无存档值 ⇒ `no_val` 披露）。
**池指纹**：`{id 集合 sha256}` 冻结时写入。

## §4 信号→概率映射（**写死**）

**单值预报 → 软概率**（避免 0/1 硬判造成 Brier 失真）：

```
p_signal = clamp(0.02, 0.98, 0.5 + (fmax − threshold) / 6)
```

- `fmax` = 该日 `previous_dayN` hourly 值的**日最大值**（对 `temperature_2m_previous_dayN` 逐时取 max）
- 除以 6 = 假设 ±3°C 覆盖 0→1 全域（工程近似，PREREG 冻结后不得调）
- `clamp(0.02, 0.98)` 防极端 Brier（1.0²=1.0 或 0²）

**两个 lead 分别报**（lead=1 / lead=3），不合并。

## §5 判据（写死，冻结后不得放宽）

1. **主判据**：`Δ_Brier = mean(Brier_base − Brier_signal)`，**配对 bootstrap 95% CI**（B=1000，seed=987654321，同命题 A 口径）。
   **达标** = **Δ ≥ 0.02 且 CI 下界 > 0**。
2. **必要件**：
   - a) 配对 n ≥ 30（本池 n=93×2=186 达标）；
   - b) 按城市分层（4 城）**全部方向一致**（Δ>0）；
   - c) **lead 单调性**：lead=1 的 Δ > lead=3 的 Δ（预报越早越不准 ⇒ 信号越远越弱，否则疑泄漏）。
3. **报告项**（不参与判定）：按城市分列、Murphy 分解（reliability/resolution/uncertainty）、
   平均模式 spread、信号覆盖率（有存档值的题比例）。

## §6 停止规则（写死）

- previous-runs API 不可用 ⇒ 暂停并如实披露（不换 API）。
- 主判据未达 ⇒ **负结果止发**（不补样、不挑窗、不换映射）。
- 泄漏探针报警（若后续增加）⇒ 立即停跑＋整批作废。
- **一次跑完，禁止择优重跑**；工程故障重跑 ≤2 次。
- 冻结后任何改动＝版本递进＋全量重跑。

## §7 冻结物

| 冻结物 | 值 |
|---|---|
| 本文件 sha256 | 冻结时写入 |
| 池 id 集合指纹 | 冻结时写入 |
| 软概率映射公式 | `0.5 + (fmax − threshold) / 6`（见 §4） |
| 变量名 | `temperature_2m_previous_day{1,3}` |
| API endpoint | `previous-runs-api.open-meteo.com/v1/forecast` |
| bootstrap 参数 | B=1000, seed=987654321 |
| 阈值 | Δ ≥ 0.02 ∧ CI 下界 > 0 |
| 信号源独立声明 | previous-runs-api（NOAA GFS/ICON/ECMWF）≠ open-meteo archive（ERA5 reanalysis）≠ 账本 assigned_prob |
| 零 LLM 声明 | 本实验**零 LLM 调用**（铁律④ no-op） |

## §8 探索性结果（**不作为达标依据**；正式结果以冻结后重跑为准）

> 以下结果来自**冻结前**的探索性实验（`.tmp/stage5-final.txt`），仅证明方向；
> **冻结后需用完全相同的代码重跑一次**，重跑结果才是正式读数。

| 臂 | Brier | Δ | CI95 |
|---|---|---|---|
| base | 0.2644 | — | — |
| signal(lead=1) | 0.0863 | **0.1781** | [0.1354, 0.2167] |
| signal(lead=3) | 0.1251 | **0.1393** | [0.0873, 0.1885] |

⇒ 探索性方向：**signal 显著优于 base**；按城市/lead 分层全部方向一致。

## §9 记录人/执行人/复核人

| 角色 | 谁 |
|---|---|
| 记录人 | 代理（本会话） |
| 执行人 | 代理（脚本自动化） |
| 复核人 | **用户**（读报告后拍板） |

---

（PREREG 路线 (b) v1 冻结 · 2026-09-15 · sha256 冻结时写入 · 铁律⑥）

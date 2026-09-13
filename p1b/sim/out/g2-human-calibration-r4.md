# G2 · ② 抽检人类校准记录（R4 · 2026-09-13）

> **执行者**：队长（非端用户；按 §4.2.1 细则 D-4，本记录必须如实标注复核构成）
> **校准方式**：按 D-3③，抽验 14 条**最可能分歧样本**（代理建议的 8 条 reject ＋ 2 条边界题 ＋ 4 条顺延题），逐题独立判读。
> **结论**：与代理语义段一致率 **5/14 = 35.7% < 90%** ⇒ **不采信代理段**，先修规则再重跑（D-3③ 的「否则按不一致率扩大人工比例」在此**不适用**——根因是**系统性的规则缺陷**，不是个别分歧）。

## 一、决定性证据（推翻 8 条 reject）
`corpus-resolve.cjs` 的 `openmeteo_daily_max(r)`（L18-24）**自带 URL**：
```
const u = 'https://archive-api.open-meteo.com/v1/archive?latitude=' + r.lat + '&longitude=' + r.lon + ... &daily=temperature_2m_max ...
return { outcome: v > r.threshold_c ? 'true' : 'false', ... }   // 读的是 threshold_c
```
⇒ 该 kind 族的契约是 **`lat/lon/date/threshold_c`**，**不需要** `url_template`／`field`（resolver 内置）。
- 铁证：全族 **113 条中已有 100 条被同一个 resolver 成功结算**（含被拒的 id=476，`resolved_at=2026-09-12`、`outcome=false`）。
- 故 machine 段的 `url_ok:false / field_ok:false / strict_four:false` 对这批是**假阳性**；把已注册 kind 当成"缺 URL/字段"。
- 代理给的理由「无 baseRateNote ⇒ **Q0-3** 基率不可核验」双重错：① 缺基率注记影响的是 **④ 难度覆盖**，与 Q0-3（恒定结果拒收/重言）无关；② 它不否定判据的**可机检性**。

## 二、逐题判定（14 条）
| id | 代理判定 | 我的独立判定 | 分歧原因 |
|---|---|---|---|
| 466 / 476 / 480 / 486 / 490 / 524 / 540 / 542（8 条） | REJECT | **PASS** | 假阳性：该族契约是 lat/lon/threshold_c，resolver 内置 URL 与字段 |
| 1331（圣保罗 降水≤0.0） | PASS | **PASS** | 一致；阈值 0 属测量下限，b=0.515 在带，判据明确 |
| 1627（悉尼 dust≤0.0） | PASS | **REJECT（存疑）** | 基率注解「>= 0.0 占 72.5%」与阈值语义**自相矛盾**（≥0 应恒真），Q0-3 恒定性须复核 |
| 948 / 1835 / 1839 / 1846（4 条 frankfurter） | PASS | **PASS** | 一致；「非发布日顺延」在题面已写明，判据无歧义 |

**一致 = 5**（1331/948/1835/1839/1846）｜**分歧 = 9**（8 假阳性 ＋ 1627 存疑）｜**一致率 = 5/14 = 35.7%**

## 三、须修的两处（修完重跑 ②）
1. **machine 段按「已注册 kind 的契约」判据**，而非通用"URL+field 齐备"：
   - `openmeteo_daily_max` → 需 `lat/lon/date/threshold_c`；URL/field 由 resolver 内置，**不得要求** `url_template`/`field`
   - 建议为每个已注册 kind 建一张 **required-keys 表**，逐 kind 校验；无法归类者才退回通用判据
2. **语义段理由模板纠偏**：缺 `baseRateNote` 不得归因为 Q0-3，应记为「④ 覆盖缺口（不影响 ② 判定）」，并单列。
3. 顺带**复核 1627 的 dust 阈值语义**（是否恒 0 ⇒ Q0-3 重言）。

## 四、复核构成（D-4 诚实标注）
- machine 段：105 题（脚本）
- 代理语义段：105 题
- **人类校准段：14 题（队长，非端用户）**
- 端用户抽验：0 题（**未做**）
⇒ 本 ② 结论**非全人工复核**；且因一致率未达 90%，**当前不作为采信依据**。

（校准记录完 · 2026-09-13）

## 五、结账（2026-09-13 · 修正后）
- **pre_fix 一致率**：5/14 = 0.357 < 0.90 ⇒ 旧代理段**不采信**（已落 meta）
- **修正动作**：machine 段改按「已注册 kind 的 required-keys 表」（51 个 kind；例 openmeteo_daily_max = [cmp,date,kind,lat,lon,threshold_c]）；缺 baseRateNote 改记「④ 覆盖缺口」；strict4 降为信息列
- **post_fix 一致率**：**14/14 = 1.000 ≥ 0.90 ⇒ 恢复 ② 采信**
- **1627 复核（队长更新判断）**：源码核实 `corpus-sources-b4.cjs` L179 `function cmp0() { return true; }` 是恒真桩、L169-170 用它决定打印方向、L164 该源 `ge:false` ⇒ 注解「>= 0.0 占 72.5%」是**措辞 bug**，实为 P(dust≤0.0)=72.5%，在带内非恒定 ⇒ 由 REJECT 存疑**改为 PASS**
- **残余风险（如实披露）**：① 本校准样本由代理按「最可能分歧」挑选（偏保守方向），非均匀随机；② 人类校准由**队长**执行，**端用户抽验 0 题**；③ 故 ② 的采信基础=机器段 105 + 代理语义段 105 + 队长校准 14，**不得声称全人工复核**
- **并列待办**：④ 覆盖缺口（池内 174 条无 baseRateNote，其中 openmeteo_daily_max 族 113 条全缺）→ 补写可抬高 ④ 覆盖；`cmp0()` 桩建议修为真实方向（语料生成器措辞缺陷）

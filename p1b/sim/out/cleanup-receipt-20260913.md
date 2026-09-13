# 数据清理收据（2026-09-13 · 队长执行）

## 一、清理项（全部经只读预演后执行）
| 项 | 动作 | 依据 |
|---|---|---|
| corpus:usgs 空局（id=43） | **删除** game ＋ 其 1 条占位 players | 0 题／0 事件／0 其余子表 |
| corpus:dlt 空局（id=48） | **删除** game ＋ 其 1 条占位 players | 0 题（与 47/49 同名的第三个局） |
| corpus:ghrel 空局（id=72） | **删除** game ＋ 其 1 条占位 players | 0 题 |
| corpus:dlt id=47 | **改名** `corpus-dlt-26121-26123` | 与 49 **不是重复题**（题面交集 0；47 为期 26121–26123） |
| corpus:dlt id=49 | **改名** `corpus-dlt-26105-26120` | 同上；**不删数据** |
| 37 个 `corpus:*` 局的 `source` | `'real'` → `'corpus'` | 集装箱局被误标为真人局 |

## 二、修正一个被灌水的口径（重要）
- 原表述「games 72 / **real games 38（真人局）**」**失实**：其中 37 个是 `corpus:*` 集装箱局被误标 `source='real'`。
- 修正后：**`corpus 40 / real 11 / sim 31 = 82`** —— `source='real'` = **11**，与路线图记载的 **n_real 11**（真人局）**完全吻合**，可作该修正正确性的交叉验证。
- 影响：交接/总索引里引用「real 38」的地方均应按 11 读。

## 三、执行与验证
- 快照 1（清理前）：`.scratch/backup/p1a-pre-cleanup-20260913082048.db`（sha256 `bc9b1ea6…`）
- 快照 2（source 修正前）：`.scratch/backup/p1a-pre-sourcefix-20260913083339.db`（sha256 `76850c24…`）
- 事务内执行：删除 players=3／games=3；改名 2；source 更新 37
- 验证：`games 85 → 82`、`predictions 1923 不变`、`integrity_check = ok`、**孤儿 players=0／孤儿 predictions=0**、`source=real 且 game_type 含 corpus` 残留 = **0**

## 四、方法论更正（留痕）
- 我此前多次用「`p1a.db` mtime 未变」作为**零写证据**——该库为 **WAL 模式**，写入先落 `p1a.db-wal`，**主库 mtime 不随写入刷新**，故此证据为**弱证据**。
- 正确的零写核验应是**内容级**（对象/行数/新表是否存在，如「12 对象且无 intake_*」），本轮结论仍成立即因当时同时做了内容级检查。

（收据完 · 2026-09-13）

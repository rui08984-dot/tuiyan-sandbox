# p15-PROGRESS · 批次1-M1 · A1 三件套代码+backfill dry-run（施工棒 · 微步 M1）

日期：2026-09-12 ｜ 执行：施工棒（p15） ｜ 状态：**M1 完成，停等验收**（禁 apply/禁 M2）

## 改动清单（commit①=2d99a13 批次0.5；commit②=本文件所在提交，hash 见 git log -1）

| # | 文件 | 改动 |
|---|---|---|
| 1 | p1b/scripts/sim-titles.cjs | 写端修复：insertPrediction 补 evidence: t.evidence（一行级+注释注明 p13/p15 修复）——根因=L33-36 漏传致库中 evidence_json 空 90/90 |
| 2 | p1b/src/routes/verdicts.js | per-path 注入（B1(a) 信息差）：loadEvidence（evidence_json→events id+game_id 双条件查防跨局悬空，每条「事件 #id（day N/type）：raw_text」截 200 字，空/悬空→「（本条无证据引用，仅题面陈述）」；块头恒标「账本事件引用（全量账本记录，非结算前信息）」——R-A 读数口径）｜loadBaseline（同 game_type 同 layer 已 resolve true 占比，**LOO 排除本条**；n<10→rate=null 如实标「基率样本不足」；L1 重言层与未分类层一律返回 null 不注入）｜buildUserPrompt 分流：v1=题面+证据块、v2=纯题面、v3=题面+基率背景行「账本历史统计（同类局型 n=X，true 占比 Y），仅作背景参考」（禁更新指令措辞，Schoenegger）｜buildMockVerdict 同步：v1 含证据行、v3 含基率行、三路末行 P=0.xx 契约之上加「Range: A%-B%」（mock=P±0.10）｜OUTPUT_FORMAT_RULE 增区间行要求（角度词与温度配对不动）｜新增导出 loadEvidence/loadBaseline/formatBaselineLine/EVIDENCE_HEAD/NO_EVIDENCE_LINE |
| 3 | p1b/src/db/predictionsStore.js | additive 迁移：SCHEMA+AUDIT_COLUMNS 加 tautology INTEGER DEFAULT 0（照七列先例）；rowToPrediction 读回；导出 updateTautology(id, flag∈{0,1}，非法抛错，不存在→null)；头注释补语义。**本微步未 UPDATE 任何库数据（M2 做置位）** |
| 4 | p1b/scripts/backfill-evidence.cjs | 新脚本：按 sim-titles 同逻辑对 gid 8-37 重算三题 evidence；默认 dry-run 逐条打印 prediction_id/现值/新值；--apply 单事务仅 UPDATE 现值≠新值行（幂等可重放）；本微步只跑 dry-run |
| 5 | p1b/test/verdicts.test.cjs | 新增 5 用例（per-path 注入 ×5，见下） |
| 6 | p1b/test/predictions-audit.test.cjs | 新增 2 用例：tautology 默认 0/updateTautology 置 1 读回/非法值/不存在 id；旧库 DROP→ensure 补列旧行 tautology=0 |
| 7 | p1b/test/full-run.out | Tee-Object 全量落盘更新（156/156） |
| 8 | .scratch/forecast-debate/backfill-dryrun-20260912.out | dry-run 全量输出留档（93 行） |

## 测试收据（p1b 域 bare：node --test，与 p13 口径一致）

```tests 156  pass 156  fail 0  cancelled 0  skipped 0```（基线 149 → +7：per-path ×5 + tautology ×2，≥156 达标）

新用例名：①loadEvidence 命中/悬空/空三态+200 字截断+R-A 口径护栏 ②buildUserPrompt v1 证据/v2 纯题面/v3 基率行+禁更新指令 ③loadBaseline LOO 排除自身+n<10 样本不足+L1/未分类不注入 ④buildMockVerdict 三路 Range 行+v1 证据行+P= 末行契约不破坏 ⑤POST verdicts（MOCK）v1 落库含证据块+三路 Range+extracted 全真 ⑥⑦tautology 默认 0/置位读回+additive 迁移。

## backfill dry-run 收据（本微步只 dry-run，未 apply）

STATS={"games":30,"scanned":90,"changed":90,"unchanged":0,"missing":0} —— 预期 90 条精确命中。
零写入验证（dry-run 后只读复count）：rows=90 evidence_empty=90（库未动）。
前 20 行样本：

```
MODE=DRY-RUN
[DIFF] game=8 key=win prediction_id=1 现值=[] 新值=[38]
[DIFF] game=8 key=peace prediction_id=2 现值=[] 新值=[30]
[DIFF] game=8 key=votes prediction_id=3 现值=[] 新值=[37]
[DIFF] game=9 key=win prediction_id=4 现值=[] 新值=[48]
[DIFF] game=9 key=peace prediction_id=5 现值=[] 新值=[40]
[DIFF] game=9 key=votes prediction_id=6 现值=[] 新值=[47]
[DIFF] game=10 key=win prediction_id=7 现值=[] 新值=[58]
[DIFF] game=10 key=peace prediction_id=8 现值=[] 新值=[50]
[DIFF] game=10 key=votes prediction_id=9 现值=[] 新值=[57]
[DIFF] game=11 key=win prediction_id=10 现值=[] 新值=[68]
[DIFF] game=11 key=peace prediction_id=11 现值=[] 新值=[60]
[DIFF] game=11 key=votes prediction_id=12 现值=[] 新值=[67]
[DIFF] game=12 key=win prediction_id=13 现值=[] 新值=[78]
[DIFF] game=12 key=peace prediction_id=14 现值=[] 新值=[70]
[DIFF] game=12 key=votes prediction_id=15 现值=[] 新值=[77]
[DIFF] game=13 key=win prediction_id=16 现值=[] 新值=[88]
[DIFF] game=13 key=peace prediction_id=17 现值=[] 新值=[80]
[DIFF] game=13 key=votes prediction_id=18 现值=[] 新值=[87]
[DIFF] game=14 key=win prediction_id=19 现值=[] 新值=[98]
```

## 边界与移交

- **M1 禁区全遵守**：未 --apply、未 UPDATE 任何库数据（零写入已实证）、未跑 judge-runner、8787 零接触、未碰 p1b/web/**、meihua.js、p1a-terminal/src、p1b/src/botc/、sim-templates-v2*（6108f49c 在写）。
- **幂等 unchanged 路径未实证**：apply 属 M2，本微步只能实证「changed=90→UPDATE 逻辑在位」与代码级幂等（仅现值≠新值才 UPDATE）；unchanged=0 因库中现值全空，无既有同值样本。
- **R-A 口径护栏已写死**：证据块头恒标「非结算前信息」；v3 措辞恒「仅作背景参考」无更新指令；L1 与未分类层不注入基率；LOO 排除自身。
- 临时探针（_probe-m1.cjs/_fix-line.cjs/_check.err/_run.tmp.out）已清理；dry-run 全量输出留档 .scratch/forecast-debate/backfill-dryrun-20260912.out。
- 施工期插曲（如实记录）：SCHEMA 加列踩「JS 数组逗号 vs SQL 列逗号」两层结构坑 3 次（read 工具行尾显示与实际字节不一致加重了误判），最终用 AUDIT_COLUMNS 先例逐字符对齐修复；测试断言正则手误 1 次经程序化替换修复。根因均为笔误非环境。
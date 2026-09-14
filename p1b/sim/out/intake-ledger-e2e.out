# 接题闭环 D-8.1/D-8.2 端到端收据（design §8，2026-09-13）

- 执行：p1b/scripts/intake-ledger-e2e.cjs（app.inject 零监听端口；P1B_LLM_MOCK=1 零网络）
- 临时库：C:\Users\crx\AppData\Local\Temp\p1b-intake-ledger-e2e-23708-1789366576114.db
- PASS 生产库零写（临时库 ≠ 默认库） — default=E:\music player\p1a-terminal\data\p1a.db

## 1. D-8.2：classify 通过 → intake_questions 记账
- 返回：{"rejected":false,"layer":"L3","engine":"stat_baseline","gate":"descriptive","intake_question_id":1}
- PASS 通过且落 intake_questions
- PASS layer=L3 / engine=stat_baseline
## 2. D-8.1：unknown 落 intake_questions，predictions 零行
- 返回：{"layer":"unknown","secondary":"L4","intake_question_id":2}
- PASS unknown 落 intake_questions
- PASS unknown 未进 predictions（layer CHECK 未放开） — predictions rows=0
## 3. D-8.1：只读归一视图 predictions_r4
- 列形状（21 列）：origin,id,game_id,statement,resolve_spec,layer,secondary_layer,gate,checklist_hash,engine,source_type,assigned_prob,evidence_json,g2_regime,matures_at,tautology,created_at,resolved_at,outcome,resolve_note,intake_reject_id
- origin 计数：[{"origin":"intake_questions","n":2}]
- 接题侧分层：[{"layer":"L3","n":1},{"layer":"unknown","n":1}]
- PASS 视图列形状 21 列统一
- PASS 接题侧含 unknown 行
## 4. D-8.1 护栏：g2-report 默认 / --include-intake 主读数一致
- 默认：include_intake=false，gate=FAIL，intake_layer=null
- 开关：include_intake=true，gate=FAIL，视图 intake 行=2
- PASS 默认关（不读视图）
- PASS 开关不改变门总判定 — FAIL vs FAIL
- PASS 开关不改变 Q1-Q5 verdicts
- PASS 开关文本含显著标注「非 G2 口径」
- PASS 默认文本无接题披露节
- PASS 开关开时视图被读到（intake 行 2）
## 5. 落盘直读（关服后新只读连接）
- intake_questions 行=2 ｜ 视图 intake 行=2 ｜ 视图存在=1
- PASS intake_questions 已落盘（2 行） — rows=2
- PASS 视图已落盘且可读

## 结论
- 断言：PASS 15 / FAIL 0
- F13 = 半闭环：接题层已闭环（unknown 落 intake_questions）；入账层（放开 predictions.layer CHECK 的表重建）待与 F4 真值分库合并为同一次计划内账本迁移（design §8 D-8.1）。
- 仍待定义：外部题 resolve 后并入统一账本（predictions）的域容器规则；本轮不做自动落 predictions，禁沿用隐式 corpus:* 模式。
- 生产库 E:\music player\p1a-terminal\data\p1a.db 零写：全程只用临时库 C:\Users\crx\AppData\Local\Temp\p1b-intake-ledger-e2e-23708-1789366576114.db。

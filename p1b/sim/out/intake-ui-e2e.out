# 接题页端到端收据（隔离端口 8791，阶段 3 出口件界面面，2026-09-13）

- 服务：http://127.0.0.1:8791（app.listen；零碰 8787）
- 临时库：C:\Users\crx\AppData\Local\Temp\p1b-intake-ui-e2e-2780-1789366576829.db
- PASS 生产库零写（临时库 ≠ 默认库） — default=E:\music player\p1a-terminal\data\p1a.db

## ① 静态前端 dist（后端已挂载）
- GET / → 200；index.html 引用 bundle：index-CY83Hug0.js
- PASS dist 已挂载（GET / 200 且 index.html 存在）
- PASS 新 bundle 已引用 — bundle=index-CY83Hug0.js
- PASS bundle 可取（200） — bytes=294480
- PASS bundle 含接题页（接题 + /intake）
- PASS bundle 无「预测」字样（UI 铁律）

## ② 真实提交 POST /api/intake/classify（结构照接题页表单）
- 提交题面：2026-09-12 上海最高气温 > 35°C（cutoff=2026-09-11 20:00，真值锚=气象台官方日最高气温）
- 返回 JSON：
~~~json
{
 "ok": true,
 "rejected": false,
 "layer": "L3",
 "computed_layer": "L3",
 "secondary": null,
 "decided_by": "auto",
 "checklist_hash": "v3",
 "engine": "stat_baseline",
 "engine_plan": {
  "layer": "L3",
  "engine": "stat_baseline",
  "calibrator": "aci",
  "posture": "classify_only",
  "built": false,
  "predicts": false,
  "gate": "descriptive"
 },
 "gate": "descriptive",
 "gate_reason": "layer_not_authorized",
 "resolve_spec": {
  "kind": "official_stat",
  "field": "daily_high_temp",
  "threshold": 35,
  "cmp": "gt",
  "date": "2026-09-12"
 },
 "statement": "2026-09-12 上海最高气温 > 35°C（cutoff=2026-09-11 20:00，真值锚=气象台官方日最高气温）",
 "prob": null,
 "prob_ci": null,
 "engine_note": "layer=L3 无引擎位（classify-only，只记账不出数）；gate=descriptive",
 "engine_result": null,
 "intake_question_id": 1,
 "intake_ledger": "intake_questions"
}
~~~
- PASS 提交 200 — status=200
- PASS 通过且归属 L3
- PASS gate/engine 如实透出
- PASS 拒收样例 reason=leak — reason=leak

## ③ 拒收原因分布 GET /api/intake/rejects
- 返回：{"ok":true,"total":1,"by_reason":[{"reason":"no_anchor","n":0},{"reason":"leak","n":1},{"reason":"tautology","n":0},{"reason":"other","n":0}]}
- PASS 分布枚举全列（含 0 计数）
- PASS leak 计数 >=1

## ④ 接题库只读列表 GET /api/intake/questions
- 返回：{"ok":true,"total":1,"first":{"id":1,"layer":"L3","gate":"descriptive","prob":null}}
- PASS 列表 200 且含刚提交行
- PASS 行含 id/statement/layer/gate/prob/created_at
- PASS 列表 note 无「预测」字样

## 结论
- 断言：PASS 15 / FAIL 0
- 新 bundle 文件名：index-CY83Hug0.js
- 用户刷新后操作：顶部导航点「接题」→ #/intake；填题面 + 按固定个数勾选六层问答 → 提交分类 → 右侧出分类结果 / 拒收分布 / 接题库。
- 未做：接题库的 resolve 写路径与并入统一账本的域容器规则（后续片）；本页只接题分类，不做结算。

# p17-PROGRESS · 判词修复 2.0 + R-C 实验 M1（施工棒）

日期：2026-09-13 ｜ 执行：施工棒（p17） ｜ 状态：**M1 完成停等验收**（禁 live 禁清表；M2 待 PREREG-RC 冻结后另发令）

前置：R-B 负结果（判词≈题型常数基率，合并条款未达成）；归因诊断 rb-attribution-诊断-20260913.md 实锤「C2 证据有信号（5/12 型机械特征超噪声带）、管道缺口=claims 未注入+200 字截断、T7 精确规则丢失首因在证据呈现」。

## M1-1 loadEvidence 2.0（p1b/src/routes/verdicts.js）

- **三段结构化注入**（替换单段 events 截 200）：
  - a) 事件流：raw_text 截 **120** 字/条（200→120 防挤占；诊断 §4：发言中位 178 字、16% 被截）；头行改「账本证据引用（截至 cutoff 的公开记录，非结算信息）」——R-C 题证据=cutoff 前，R-A 读数口径标注退役。
  - b) **账本声称记录**（新）：claims 表按声称席位聚合（`席位 N 共声称 K 条：谓词→对象；…`，单条截 80）——claims.seat/subject_seat=座位号（A0 差异表 L82 口径，与 events.actor_seat=players.id 不同，无 p14 坑）。
  - c) **账本机械统计（截至 cutoff，纯代码计算零 LLM）**（新）：发言条数/发言总字数/声称总数/身份声称数/指认总数（is_wolf 指认他人，自指不计）/被指认席位数/单席最高被指认/夜死席位——特征定义=诊断 §2。
- **零结算信息保证**：三段全部由 evidence_json 事件集+其挂载 claims 计算（claims JOIN event_id IN evidence ids）；夜死席位从天亮公告文本正则「N 号死亡」提取（规避 actor_seat=players.id 坑）；计票/终局/roles 不触达（单测无泄漏断言）。
- 实测（pred#91 T1 题）：三段齐全——b 段「席位 2 共声称 2 条：is_wolf→狼人；is_good→好人」等 5 席；c 段「发言条数：5；发言总字数：858；声称总数：13（身份 12）；指认 5；夜死席位：3 号」；结算事件文本 0 出现。
- 插曲（如实）：a 段 SELECT 曾漏 phase 列致夜死席位=无，单验证抓出即修。

## M1-2 题源复核（proc_calc 组单列规格）

- **proc_calc 组=L1/proc_calc 题型 5 型×30 局=150 条：T3/T4/T5/T7/T9b**（checklist_hash=v2）——R-C 计分单列（引擎直算正确率单独报告，**不进 LLM 判词对比与合并条款计数**）；T7 精确规则（idclaims≥10）诊断已证机械复算 30/30 一致=Brier 0.0000 上限参照。
- L6 主判据组=7 型×30=210 条（T1/T2/T6/T8/T9a/T9/T10）；T4（27/30 true）与 T9b（29/30 true）近恒基率照 PREREG-RB 惯例记账不外推。
- 实现落点=R-C 计分脚本（M2 执行时按 engine 列分组；M1 仅冻结规格）。

## M1-3 测试（verdicts.test.cjs +1 用例，断言同步）

- 新用例「loadEvidence 2.0（R-C）：三段注入——事件流+claims 按席位聚合+机械特征卡，零结算泄漏」：mini 局构造（4 cutoff 前事件+2 结算事件+3 claims）——三段存在性/席位聚合/特征值/夜死席位正则/无泄漏断言（dusk 计票与 system 终局原文+事件 id 双重断言不出现）。
- 旧断言同步：块头「账本事件引用」→「账本证据引用」、「非结算前信息」→「非结算信息」、截断 200→120（API 落库用例同步）。
- 全量 node --test **159/159 全绿**（158+1；full-run.out 已刷新）。

## M1-4 PREREG-RC v1 草案（.scratch/forecast-debate/PREREG-RC-v1-待确认.md，不冻结）

- 主判据结构同 R-B（L6 分题型 b(1−b)+±0.06+合并条款 ≥3 题型+TOST+L1 carve-out=0.5）；**新增配对对照锚**=R-B 同题型同路实测 Brier（单变量=证据呈现方式；配对 ΔBrier bootstrap CI 上界<0 且跨 ≥3 题型→「证据呈现修复有效」）。
- 禁混宣称条款：R-C vs R-B 差=修复归因；超基率=信息价值——两者分开判分。
- proc_calc 单列表规格写入 §三；impute 同 R-B（L1 carve-out=0.5）；四要素追平（archive-rc-pre/--runid 通道/stop-rule≤2/版本递进）。
- **状态=待确认草案，不冻结**——M2（烟测+360×3 live+计分）待队长批准冻结后另发令。

## 纪律与边界

- 禁 live 禁清表 ✓；R-A/R-B 产 verdicts 行（268+1078）零触碰 ✓；8787 零接触 ✓；predictionsStore.js l0Gate/PREREG 两冻结件未动 ✓
- 临时验证脚本 _rc-verify.cjs 已删；commit hash 见 git log「批次2-RC M1：loadEvidence 2.0 三段注入+proc_calc 单列规格+PREREG-RC 草案」
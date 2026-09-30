

<!-- dsh-openwolf:start -->
# Code Map
Generated 2026-09-09T00:20:21.128Z · 1679 files · 109703 lines · 1.39s

## ./
- `AI音乐电台账号调研与执行方案.md` — 135 lines · > 调研日期：2026-09-02 ｜ 产能设定：本地引擎（ACE-Step 1.5 / HOT-Step）日产 1–2 首 ｜ 目标平台：B站（主站）+ 抖音（切片分发）
- `botc_acl2026.pdf` — 0 lines · [file too large]
- `电台执行手册-整理版.md` — 66 lines · > 原始调研：`AI音乐电台账号调研与执行方案.md`（DSH 产出，2026-09-02）

## _session_extract
- `_session_extract/_analyze_session.cjs` — 77 lines · fs, path, args, src, out, grepIdx · const fs = require("fs");
- `_session_extract/_analyze_subagents.cjs` — 64 lines · fs, path, dir, out, outLines, p · const fs = require("fs");
- `_session_extract/_auto_lines.txt` — 4 lines · RAW L20654: {"type":"user/message","seq":162202,"time":1788377379065,"data":{"content":[{"type":"text","text":"AgentTeams message from membe…
- `_session_extract/_ep4-helper.cjs` — 39 lines · fs, fp, raw, bodyLines, t, paras · const fs = require("fs");
- `_session_extract/_extract_chunks.cjs` — 37 lines · fs, src, start, end, out, mode · const fs = require("fs");
- `_session_extract/_extract_lastmsg.cjs` — 37 lines · fs, out, files, outLines, p, extractText · const fs = require("fs");
- `_session_extract/_extract_structured.cjs` — 33 lines · fs, out, files, outLines, p, lines · const fs = require("fs");
- `_session_extract/_goal_lines.txt` — 1 lines · RAW L27915: {"type":"user/message","seq":215512,"time":1788385924016,"data":{"content":[{"type":"text","text":"<goal_round>\nObjective: \"完成…
- `_session_extract/_inspect_zip.ps1` — 12 lines · param()
- `_session_extract/_lastturn.txt` — 148 lines · RAW L30643: {"type":"user/message","seq":235839,"time":1788422423895,"data":{"id":"7ffde728-5f78-454d-99ee-ed5e8c3a6f34","role":"user","cont…
- `_session_extract/_lastturn_rebuilt.txt` — 37 lines · === REASONING (4266 chars) ===
- `_session_extract/_oral_ep2.txt` — 2 lines · === episode-002-正式版.md (chars=2658)
- `_session_extract/_oral_ep2b.txt` — 2 lines · === episode-002-正式版.md (chars=2930)
- `_session_extract/_oral_ep2c.txt` — 2 lines · === episode-002-正式版.md (chars=2940)
- `_session_extract/_oral_final.txt` — 2 lines · === episode-001-正式版.md (chars=4291)
- `_session_extract/_oral_texture.txt` — 14 lines · === 稗官野史_42min_文稿.txt (chars=14993)
- `_session_extract/_report_main.txt` — 8 lines · SRC: E:\music player\_session_extract\session.jsonl
- `_session_extract/_research_outputs.txt` — 277 lines · === session.jsonl
- `_session_extract/_session_transcript.cjs` — 95 lines · fs, path, src, out, li, linePick · const fs = require("fs");
- `_session_extract/_struct_baseline.txt` — 35 lines · === 稗官野史_42min_文稿.txt
- `_session_extract/_struct_compare.txt` — 11 lines · === episode-001-家庭群里的第三个妈妈.md
- `_session_extract/_struct_ep2.txt` — 5 lines · === episode-002-正式版.md
- `_session_extract/_struct_ep2b.txt` — 5 lines · === episode-002-正式版.md
- `_session_extract/_struct_ep2c.txt` — 5 lines · === episode-002-正式版.md
- `_session_extract/_struct_final.txt` — 5 lines · === episode-001-正式版.md
- `_session_extract/_struct_production.txt` — 5 lines · === episode-001-正式版.md
- `_session_extract/_subagents_report.txt` — 145 lines · SUBAGENT SESSIONS: 36
- `_session_extract/_tail.txt` — 0 lines · [file too large]
- `_session_extract/_tail2.txt` — 83 lines · RAW L428: L24064 USER  1788383515851 :: AgentTeams message from member shudist: 【t7 审判报告·技法与短语层完整性】（审判岗 shudist，attempt 53a88850） ## 审判对象与方法…
- `_session_extract/_transcript_main.txt` — 0 lines · [file too large]
- `_session_extract/session.jsonl` — 0 lines · [file too large]
- `_session_extract/自动对话分析报告.md` — 61 lines · > 数据源：`dsh-session-session-3cb79de3-626b-460f-8c55-505fdcb73df5.zip`（44 MB，主会话 30791 行 + 36 个子代理会话）

## _session_extract/subagents/00bd3574-7f33-4e19-a20c-e046ae635497
- `_session_extract/subagents/00bd3574-7f33-4e19-a20c-e046ae635497/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/02b61ffb-eb1c-492f-b753-054227b0abec
- `_session_extract/subagents/02b61ffb-eb1c-492f-b753-054227b0abec/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/0e38f354-5a42-424e-b7ed-7507aac6cf90
- `_session_extract/subagents/0e38f354-5a42-424e-b7ed-7507aac6cf90/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/0fdd339c-6977-402d-9096-fab1828ed392
- `_session_extract/subagents/0fdd339c-6977-402d-9096-fab1828ed392/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/194d9e0f-f078-4844-a494-766da9961577
- `_session_extract/subagents/194d9e0f-f078-4844-a494-766da9961577/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/1b6dbbe2-aa01-41b1-8c55-5769e478e252
- `_session_extract/subagents/1b6dbbe2-aa01-41b1-8c55-5769e478e252/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/1cf3af7a-b16f-42bf-bf92-07692532dad8
- `_session_extract/subagents/1cf3af7a-b16f-42bf-bf92-07692532dad8/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/27df1472-3b86-453f-b3f7-98988a4b0a9d
- `_session_extract/subagents/27df1472-3b86-453f-b3f7-98988a4b0a9d/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/2e324c49-ddd8-42b9-b928-b55509dd5125
- `_session_extract/subagents/2e324c49-ddd8-42b9-b928-b55509dd5125/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/30234200-662d-43e2-b259-131f12a52fc1
- `_session_extract/subagents/30234200-662d-43e2-b259-131f12a52fc1/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/32cd4e94-a3a1-4bf8-bc2e-4992672ef644
- `_session_extract/subagents/32cd4e94-a3a1-4bf8-bc2e-4992672ef644/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/42edab79-53be-42cf-9cfe-d59d55321eb6
- `_session_extract/subagents/42edab79-53be-42cf-9cfe-d59d55321eb6/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/4bf0bbce-fe09-441f-a01a-5f434e112db2
- `_session_extract/subagents/4bf0bbce-fe09-441f-a01a-5f434e112db2/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/4fbd6239-c10f-4c16-b4d4-abc5dcadf89c
- `_session_extract/subagents/4fbd6239-c10f-4c16-b4d4-abc5dcadf89c/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/51657aa9-afb1-4cd0-a7cf-19d8a14e2c58
- `_session_extract/subagents/51657aa9-afb1-4cd0-a7cf-19d8a14e2c58/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/52f1bfeb-94dc-4e61-bd4d-f35b5bc016c7
- `_session_extract/subagents/52f1bfeb-94dc-4e61-bd4d-f35b5bc016c7/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/61b8cfa2-d870-4072-9f1d-67df5c330ac4
- `_session_extract/subagents/61b8cfa2-d870-4072-9f1d-67df5c330ac4/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/6373c55a-bf19-425e-8299-c4c402931197
- `_session_extract/subagents/6373c55a-bf19-425e-8299-c4c402931197/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/6fd96e2e-5624-4e59-b493-00fd5c6e20f3
- `_session_extract/subagents/6fd96e2e-5624-4e59-b493-00fd5c6e20f3/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/794efef0-2378-423c-bfbd-32828d7cf8f5
- `_session_extract/subagents/794efef0-2378-423c-bfbd-32828d7cf8f5/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/7a07a437-b5c3-42a1-80ae-01d3433a366a
- `_session_extract/subagents/7a07a437-b5c3-42a1-80ae-01d3433a366a/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/818fc1da-6eb7-43ce-95f2-0d1a3009025f
- `_session_extract/subagents/818fc1da-6eb7-43ce-95f2-0d1a3009025f/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/8a56d659-5e85-404a-b784-ad25b0351a40
- `_session_extract/subagents/8a56d659-5e85-404a-b784-ad25b0351a40/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/94bb2bf6-f651-40ed-86ac-c5308f0bab69
- `_session_extract/subagents/94bb2bf6-f651-40ed-86ac-c5308f0bab69/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/9640aef8-3e9a-46fc-b256-2623b2d62237
- `_session_extract/subagents/9640aef8-3e9a-46fc-b256-2623b2d62237/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/96eec34c-69aa-4991-9fd4-001f2b01a6ac
- `_session_extract/subagents/96eec34c-69aa-4991-9fd4-001f2b01a6ac/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/a6116348-c819-4e74-a262-026b84d281a3
- `_session_extract/subagents/a6116348-c819-4e74-a262-026b84d281a3/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/af0aef2b-6472-4074-9ffb-3c9f18a6d52b
- `_session_extract/subagents/af0aef2b-6472-4074-9ffb-3c9f18a6d52b/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/b9e81113-6fbb-42f4-b353-d85046cb2183
- `_session_extract/subagents/b9e81113-6fbb-42f4-b353-d85046cb2183/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/c0c2797f-00ee-4dd6-874d-98b932fc7127
- `_session_extract/subagents/c0c2797f-00ee-4dd6-874d-98b932fc7127/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/cfd9b512-ed73-4032-89d2-2f70d368a36b
- `_session_extract/subagents/cfd9b512-ed73-4032-89d2-2f70d368a36b/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/cfec7db4-8a45-4c16-8cc4-12e4cfdac11e
- `_session_extract/subagents/cfec7db4-8a45-4c16-8cc4-12e4cfdac11e/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/d5a35951-7f0f-4361-bcf2-924c443f5edb
- `_session_extract/subagents/d5a35951-7f0f-4361-bcf2-924c443f5edb/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/ec927761-27a6-43e6-a9f8-4e1619776d67
- `_session_extract/subagents/ec927761-27a6-43e6-a9f8-4e1619776d67/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/ee375f8e-d59e-48f9-858c-4b0f8af087f4
- `_session_extract/subagents/ee375f8e-d59e-48f9-858c-4b0f8af087f4/session.jsonl` — 0 lines · [file too large]

## _session_extract/subagents/fb633201-7660-4c2c-ad15-62cf859fe8c4
- `_session_extract/subagents/fb633201-7660-4c2c-ad15-62cf859fe8c4/session.jsonl` — 0 lines · [file too large]

## assets
- `assets/ref2.json` — 0 lines · {"code":-400,"message":"请求错误","ttl":1}
- `assets/sample_ep01.ass` — 18 lines · [Script Info]

## assets/bg_video
- `assets/bg_video/video_01_18757430.mp4` — 0 lines · [file too large]
- `assets/bg_video/video_02_31042229.mp4` — 0 lines · [file too large]
- `assets/bg_video/video_03_34977302.mp4` — 0 lines · [file too large]

… 121 more directories not shown
<!-- dsh-openwolf:end -->
---

## 机器规则：本机 Python 调用

**必须使用全路径调用解释器：**

```
C:/Users/crx/AppData/Local/Programs/Python/Python313/python.exe
```

已装库（已验证可导入，**无需安装任何东西**）：`openpyxl 3.1.5`、`xlsxwriter 3.2.9`。

### 陷阱：PATH 上的 python 是假的

`python.exe` / `python3.exe` 解析到 `C:\Users\crx\AppData\Local\Microsoft\WindowsApps\`，
那是 **Microsoft Store 占位程序（stub）**，不是解释器。执行它不报错也不输出，`python -V` 无返回、
`import` 无结果。因此**以下探测方式得出的「Python 不可用」结论一律是错的**：

- `Get-Command python`（只看得到 WindowsApps 路径）
- `python -V` / `python -c "import ..."`（静默失败）

判断 Python 是否可用，一律直接用全路径执行。

### PowerShell 调用写法

```powershell
& 'C:/Users/crx/AppData/Local/Programs/Python/Python313/python.exe' 'E:/music player/script.py'
```

两点注意：
1. 用**正斜杠** `/` 而非反斜杠 `\`，可避免嵌套工具调用中的转义问题。
2. 路径含空格（`music player`）必须加引号；中文路径建议写在脚本内部常量里，不要放命令行参数。

<!-- dsh-python:rule -->
### 陷阱：嵌套工具调用的 `description` 也是必填

在 `run_code` 内部调用 `tools.pwsh` 等嵌套工具时，其 schema 里的 `description` 是**必填**字段。
漏掉它会在外层参数校验就失败，报错文本是：

```
ToolCallError: invalid arguments: missing required property "description"
```

**注意：外层 `run_code` 的 `description` 与内层 `tools.pwsh` 的 `description` 是两个独立字段，都要写。**

```js
// 错：内层漏了 description
const r = await tools.pwsh({ command: "echo ok" });

// 对
const r = await tools.pwsh({ command: "echo ok", description: "连通性测试" });
```

该报错具有迷惑性：它看起来像 harness 层工具失效，实际上只是本次调用的参数缺失。
遇到"某个工具突然全挂了"时，先用同一段 `run_code` 程序同时调一个已知可用的工具（如 `tools.write`）做对照，
若其它工具正常，即可判定是该工具的调用参数问题，而非环境故障。

<!-- dsh-nested-tool:rule -->

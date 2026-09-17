'use strict';
// 一次性维护脚本：交接件原位更新（追加 §19 ＋ 同步 §1 指针 / §0 全局行 / 尾行）
const fs = require('fs');
const P = 'E:/music player/.scratch/handoff/推演沙盘-交接-20260917-终态.md';
const S = 'E:/music player/.scratch/forecast-debate/decouple9/_snippet-handoff19.md';
let cur = fs.readFileSync(P, 'utf8');
const before = cur;
const checks = [];

// ① 追加 §19（尾行之前）
const tailLine = '（交接完 · 2026-09-17 · 终态 ＋（八）…（十八）十一批原位更新 · 测试 486/486 · 账本 1992/1483/4766 · vault ok · E2 已结案）';
if (cur.indexOf(tailLine) < 0) throw new Error('尾行未找到');
const snip = fs.readFileSync(S, 'utf8').trimEnd();
cur = cur.replace(tailLine, '\n---\n' + snip + '\n\n' + tailLine);
checks.push('§19 追加: ' + (cur.indexOf('## 19. 更新记录 · 2026-09-17（十九）批') > 0));

// ② §1 指针：当前态以 §18 为准 → §19
const oldPtr = '> ★**本节为 09-17 早段快照；当前态以 §18 为准**（本件各期更新节按编号递增）。**§18 末的在跑/待办**：无跑批；**首选非用户侧下一棒＝9 臂跑批**（前置已就绪：附录 B 已回读＋MLE 已实现并验证；见 §18 ④）；另：**09-18 起 C 线 37 题到期**（例行通道：结算 → `vault-sync` → 刷读数件）。';
if (cur.indexOf(oldPtr) < 0) throw new Error('§1 指针行未按预期存在');
cur = cur.replace(oldPtr, '> ★**本节为 09-17 早段快照；当前态以 §19 为准**（本件各期更新节按编号递增）。**§19 末的在跑/待办**：无跑批；**9 臂跑批已执行完毕**（出口 ③-b 交裁决；见 §19 ③）；**首选非用户侧下一棒＝（a）等时间项：09-18 起 C 线 37 题到期**（例行通道：结算 → `vault-sync` → 刷读数件）或 **（b）v3 退化臂/L6 选行口径的处置**（须拍板）。');
checks.push('§1 指针更新: ' + (cur.indexOf('当前态以 §19 为准') > 0));

// ③ §0 全局行
const oldTest = '| 测试 | **486/486 pass / 0 fail**（**§18 末实测**；原 §0 值 448／§17 末 477） | `cd p1b && node --test` |';
if (cur.indexOf(oldTest) < 0) throw new Error('§0 测试行未按预期存在');
cur = cur.replace(oldTest, '| 测试 | **497/497 pass / 0 fail**（**§19 末实测**；原 §0 值 448／§17 末 477／§18 末 486） | `cd p1b && node --test` |');
const oldScript = '| 脚本 | 在役 **106**／归档 69（**§18 末实测**；原值 101→105→106） | `p1b/scripts/README.md`（`scripts-index.cjs` 生成） |';
if (cur.indexOf(oldScript) < 0) throw new Error('§0 脚本行未按预期存在');
cur = cur.replace(oldScript, '| 脚本 | 在役 **108**／归档 69（**§19 末实测**；原值 101→105→106→108） | `p1b/scripts/README.md`（`scripts-index.cjs` 生成） |');
checks.push('§0 测试/脚本行: ' + (cur.indexOf('**497/497 pass / 0 fail**') > 0 && cur.indexOf('在役 **108**') > 0));

// ④ 尾行同步
cur = cur.replace(tailLine, '（交接完 · 2026-09-17 · 终态 ＋（八）…（十九）十二批原位更新 · 测试 497/497 · 账本 1992/1483/4766（本批零写）· vault ok · E2 已结案 · 9 臂出口 ③-b 待裁）');
checks.push('尾行同步: ' + (cur.indexOf('十二批原位更新') > 0));

fs.writeFileSync(P, cur, 'utf8');
const after = fs.readFileSync(P, 'utf8');
console.log(checks.join('\n'));
console.log('行数 ' + before.split('\n').length + ' → ' + after.split('\n').length);
console.log('§19 存在=' + (after.indexOf('## 19. 更新记录') > 0) + '｜§18 仍在=' + (after.indexOf('## 18. 更新记录') > 0) + '｜标题唯一=' + ((after.match(/## 19\. 更新记录/g) || []).length === 1));

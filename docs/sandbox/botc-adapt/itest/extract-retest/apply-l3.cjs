'use strict';
// apply-l3.cjs — 对 B7 复测 raw 事后执行 L3 出卡还原（与 routes/events.js 同款 mapBotcCarriersBack）
// 纯机械变换零 LLM 调用；输出 raw-b7/all-results-b7-l3.json 供 eval-stats-b7 使用
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const { mapBotcCarriersBack } = require('E:/music player/p1b/src/botc/extractPrompt.js');
const all = JSON.parse(fs.readFileSync(path.join(HERE, 'raw-b7', 'all-results-b7.json'), 'utf8'));
for (const r of all.results) {
  const mapped = mapBotcCarriersBack((r.out && r.out.claims) || []);
  r.out.l3_claims = mapped.claims;
  r.out.l3_warnings = mapped.warnings;
}
all.note = 'l3_claims = routes/events.js extract 出卡形态（事后机械还原，与生产同构）';
fs.writeFileSync(path.join(HERE, 'raw-b7', 'all-results-b7-l3.json'), JSON.stringify(all, null, 2));
console.log('L3 applied to ' + all.results.length + ' rows');
for (const r of all.results) {
  console.log(r.id + ' -> ' + r.out.l3_claims.map(c => c.subject_seat + ':' + c.predicate).join(' | '));
}
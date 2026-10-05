/** 变异注入：逐支拆掉三态里的任一支，看现有断言会不会红。改完必须还原。 */
const fs = require('fs');
const S = 'E:/music player/p1b/src/db/verdictsStore.js';
const V = 'E:/music player/p1b/src/db/verdictsViews.js';
const R = 'E:/music player/p1b/src/routes/verdicts.js';
const orig = { s: fs.readFileSync(S, 'utf8'), v: fs.readFileSync(V, 'utf8'), r: fs.readFileSync(R, 'utf8') };
let s = orig.s, v = orig.v, r = orig.r, desc = '';
const which = process.argv[2];
if (which === 'kill-post') { desc = '拆掉 post_settlement 支（store 恒写）'; s = s.replace("if (gate.state === 'post_settlement') {", "if (false) {"); }
else if (which === 'kill-clean') { desc = '拆掉 clean 支（早于结算也判成结算后）'; s = s.replace("if (String(now) <= ra) {", "if (false) {"); }
else if (which === 'kill-legacy') { desc = '拆掉 legacy 支（豁免口失效）'; s = s.replace("if (x.exempt === true) {", "if (false) {"); }
else if (which === 'kill-view') { desc = '拆掉视图过滤（verdicts_clean 收全表）'; v = v.replace("WHERE v.leak_state = 'clean';", "WHERE 1=1;"); }
else if (which === 'kill-both-gates') { desc = '拆掉两道闸（store 拒写 + 路由前置查）'; s = s.replace("if (gate.state === 'post_settlement') {", "if (false) {"); r = r.replace("if (gate.state === 'post_settlement') {", "if (false) {"); }
else { console.error('未知变异'); process.exit(2); }
if (s === orig.s && v === orig.v && r === orig.r) { console.error('!! 变异未命中，字符串没对上'); process.exit(2); }
fs.writeFileSync(S, s, 'utf8'); fs.writeFileSync(V, v, 'utf8'); fs.writeFileSync(R, r, 'utf8');
console.log('已注入：' + desc);

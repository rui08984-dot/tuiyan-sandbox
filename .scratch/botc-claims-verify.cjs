const db = require("E:/music player/p1a-terminal/src/db.js");
const c = require("E:/music player/p1b/src/botc/claims.js");
db.init(":memory:");
const conn = db.getConnection();
const before = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name);
c.ensureBotcTables(conn);
const after = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name);
console.log("新增表:", JSON.stringify(after.filter(n=>!before.includes(n))));
console.log("既有表未变:", JSON.stringify(before) === JSON.stringify(after.filter(n=>!n.startsWith("botc_"))));
const g = db.createGame("BOTC验证局", "botc", 7);
c.setGameScript(g.id, "tb");
console.log("getGameScript:", c.getGameScript(g.id));
// 切分归一化
const split = c.splitBotcClaims("tb", [
  {seat:1, subject_seat:1, predicate:"claims_role", object:"洗衣妇"},
  {seat:2, subject_seat:5, predicate:"is_demon", object:""},
  {seat:1, subject_seat:3, predicate:"said", object:"x"},
  {seat:4, subject_seat:4, predicate:"is_role", object:"小恶魔"},
]);
console.log("main 行数:", split.main.length, "| botc 行数:", split.botc.length);
console.log("角色归一:", split.main[0].object, "|", split.main[1].object);
console.log("botc 谓词:", split.botc[0].predicate);
// 越剧本 → 400
try { c.splitBotcClaims("tb", [{seat:1,subject_seat:1,predicate:"claims_role",object:"赌徒"}]); console.log("越剧本: 未拦截(BUG)"); }
catch (e) { console.log("越剧本拦截:", e.statusCode, e.message.slice(0, 40)); }
// 未知角色
try { c.splitBotcClaims("tb", [{seat:1,subject_seat:1,predicate:"claims_role",object:"天外飞仙"}]); console.log("未知: 未拦截(BUG)"); }
catch (e) { console.log("未知拦截:", e.statusCode); }
// CRUD
const ev = db.addEvent({game_id: g.id, day: 1, phase: "day", type: "claim", actor_seat: 2, raw_text: "2号指认5号是恶魔"});
const r1 = c.addBotcClaim({game_id: g.id, event_id: ev.id, seat: 2, subject_seat: 5, predicate: "is_demon", object: "", extracted_by: "user", confirmed_by_user: 1});
console.log("addBotcClaim id:", r1.lastInsertRowid !== undefined ? r1.lastInsertRowid : JSON.stringify(r1));
const list = c.listBotcClaims(g.id);
console.log("list:", list.length, list[0] && list[0].predicate, list[0] && list[0].day);
const row = c.getBotcClaim(Number(r1.lastInsertRowid));
console.log("get:", row && row.game_id === g.id, row && row.predicate);
console.log("retract:", c.retractBotcClaim(Number(r1.lastInsertRowid)), "→ list:", c.listBotcClaims(g.id).length);
console.log("retract 幂等不存在:", c.retractBotcClaim(99999));
// 非法 script
try { c.setGameScript(g.id, "xyz"); console.log("非法 script: 未拦截(BUG)"); } catch (e) { console.log("非法 script 拦截:", e.statusCode); }

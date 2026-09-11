const m = require("E:/music player/p1b/src/botc/contradictions.js");
const claims = [
  {id:11, event_id:1, day:1, seat:2, subject_seat:2, predicate:"claims_role", object:"washerwoman"},
  {id:12, event_id:1, day:1, seat:3, subject_seat:3, predicate:"claims_role", object:"washerwoman"},
  {id:13, event_id:2, day:1, seat:4, subject_seat:4, predicate:"claims_role", object:"gunslinger"},
  {id:14, event_id:2, day:1, seat:5, subject_seat:5, predicate:"claims_role", object:"gunslinger"},
  {id:15, event_id:3, day:1, seat:6, subject_seat:6, predicate:"claims_role", object:"imp"},
  {id:16, event_id:3, day:1, seat:1, subject_seat:6, predicate:"is_good", object:"好人"},
  {id:17, event_id:4, day:2, seat:2, subject_seat:2, predicate:"claims_role", object:"小恶魔"},
];
const botcClaims = [
  {id:101, event_id:5, day:1, seat:1, subject_seat:6, predicate:"is_demon", object:""},
  {id:102, event_id:5, day:1, seat:7, subject_seat:5, predicate:"is_demon", object:""},
  {id:103, event_id:6, day:2, seat:1, subject_seat:6, predicate:"is_minion", object:""},
  {id:104, event_id:7, day:1, seat:2, subject_seat:8, predicate:"status_drunk", object:""},
  {id:105, event_id:7, day:1, seat:2, subject_seat:8, predicate:"status_poisoned", object:""},
  {id:106, event_id:8, day:2, seat:3, subject_seat:9, predicate:"status_drunk", object:""},
];
const pairs = m.findBotcContradictions({script:"tb", claims, botcClaims, events:[{id:1,day:1},{id:2,day:1},{id:3,day:1},{id:4,day:2},{id:5,day:1},{id:6,day:2},{id:7,day:1},{id:8,day:2}]});
const tag = (p) => p.pair_id + (p.botc_refs && p.botc_refs.length ? " botc" : "");
console.log("冲突对总数:", pairs.length);
for (const p of pairs) console.log("-", tag(p), "|", p.conflict_desc.slice(0, 58));
const has = (frag) => pairs.some(p => p.conflict_desc.includes(frag));
console.log("RB1 对跳命中:", has("[对跳]"));
console.log("RB1 旅行者枪手不对跳:", !pairs.some(p => p.conflict_desc.includes("枪手")));
console.log("RB2 改跳命中:", has("[自相矛盾]"));
console.log("RB3 demon×is_good 命中:", pairs.some(p=>p.pair_id==="c16:b101"));
console.log("RB3 imp(自认)×is_demon 不报:", !pairs.some(p=>p.pair_id==="c15:b101"));
console.log("RB3 imp×is_minion 命中:", pairs.some(p=>p.pair_id==="c15:b103"));
console.log("RB3 demon×is_minion 命中:", pairs.some(p=>p.pair_id==="c16:b103"));
console.log("RB4 多恶魔命中:", pairs.some(p=>p.pair_id==="b101:b102"));
console.log("RB5 状态矛盾命中:", pairs.some(p=>p.pair_id==="b104:b105"));
console.log("RB5 day2 单 drunk 不报:", !pairs.some(p=>p.pair_id.includes("b106")));
console.log("全部对跳对 claim 引用为整数主表 id:", pairs.filter(p=>p.conflict_desc.includes("[对跳]")).every(p=>Number.isInteger(p.claim_a)));
console.log("botc_only 对不含主表引用:", pairs.filter(p=>p.botc_refs.length>0 && !Number.isInteger(p.claim_a)).every(p=>p.claim_a===null));

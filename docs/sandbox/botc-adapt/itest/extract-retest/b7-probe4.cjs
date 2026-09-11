'use strict';
const m = require('E:/music player/p1b/src/botc/extractPrompt.js');
// 往返测试：translate(编码) -> parse -> mapBack(还原)
const carrierJson = m.translateContentToCarriers(JSON.stringify({claims:[
  {subject_seat:14, predicate:'is_demon', object:'14号是恶魔'},
  {subject_seat:2,  predicate:'status_drunk', object:''},
  {subject_seat:5,  predicate:'status_poisoned', object:'自称被投毒'},
  {subject_seat:14, predicate:'is_role', object:'恶魔'},
  {subject_seat:1,  predicate:'claims_role', object:'洗衣妇'},
]}));
const carriers = JSON.parse(carrierJson).claims;
console.log('STEP1 carriers=' + JSON.stringify(carriers.map(c=>c.predicate+':'+c.object)));
const back = m.mapBotcCarriersBack(carriers);
console.log('STEP2 back=' + JSON.stringify(back.claims.map(c=>c.predicate+':'+c.object)));
console.log('STEP2 warnings=' + back.warnings.length);
const expect = ['is_demon:14号是恶魔','status_drunk:','status_poisoned:自称被投毒','is_demon:恶魔','claims_role:洗衣妇'];
const got = back.claims.map(c=>c.predicate+':'+c.object);
console.log('ROUNDTRIP=' + (JSON.stringify(got)===JSON.stringify(expect) ? 'PASS' : 'FAIL'));
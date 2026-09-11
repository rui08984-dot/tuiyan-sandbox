'use strict';
const m = require('E:/music player/p1b/src/botc/extractPrompt.js');
const bt = String.fromCharCode(96).repeat(3);
const fenced = bt + 'json\\n' + JSON.stringify({claims:[{subject_seat:14,predicate:'is_demon',object:'14号是恶魔'},{subject_seat:2,predicate:'said',object:'醉了'}]}) + '\\n' + bt;
console.log('FENCED=>' + m.translateContentToCarriers(fenced));
const plain = JSON.stringify({claims:[{subject_seat:2,predicate:'said',object:'醉了'}]});
console.log('NOMUTATE=>' + m.translateContentToCarriers(plain));
const back = m.mapBotcCarriersBack([
  {subject_seat:14, predicate:'said', object:'⟦BOTC:is_demon⟧14号是恶魔'},
  {subject_seat:14, predicate:'is_role', object:'恶魔'},
  {subject_seat:5, predicate:'is_wolf', object:'爪牙'},
  {subject_seat:1, predicate:'claims_role', object:'洗衣妇'},
]);
console.log('BACK=>' + JSON.stringify(back));
const ctx = m.buildBotcExtractContext('tb');
console.log('CTX mark=>' + ctx.includes(m.BOTC_EXTRACT_MARK) + ' roles=>' + ctx.includes('小恶魔（恶魔）') + ' preds=>' + ['is_demon','is_minion','status_drunk','status_poisoned'].every(p=>ctx.includes(p)));
console.log('CTX invalid=>' + JSON.stringify(m.buildBotcExtractContext('abc')));
'use strict';
// p8-anchor-probe.cjs —— W1 起卦锚点探测（一次性脚本，产物留档 itest/）
const { deriveCasting, fnv1a } = require('E:/music player/p1b/src/lib/oracle.js');
const g1 = { id: 1, game_type: 'werewolf', created_at: '2026-09-10 12:00:00', player_count: 6 };
const g2 = { id: 2, game_type: 'botc', created_at: '2026-09-11 21:30:00', player_count: 9 };
const g3 = { id: 3, game_type: 'werewolf', created_at: '2026-09-10 12:00:00', player_count: 6 };
function pick(c) {
  return {
    a: c.numbers.a, b: c.numbers.b,
    ben: c.benGua.fullName, hu: c.huGua.fullName, bian: c.bianGua.fullName,
    dong: c.dongYao,
    ti: c.ti.trigram + '/' + c.ti.wuXing, yong: c.yong.trigram + '/' + c.yong.wuXing,
    rel: c.tiYongRelation,
  };
}
console.log('fnv1a("")=', fnv1a(''), 'expect 2166136261');
console.log('fnv1a("a")=', fnv1a('a'), 'expect 3826002220');
console.log('G1=' + JSON.stringify(pick(deriveCasting(g1))));
console.log('G2=' + JSON.stringify(pick(deriveCasting(g2))));
console.log('G3(diff id) numbers=', JSON.stringify(deriveCasting(g3).numbers));
console.log('IDEMPOTENT g1==g1:', JSON.stringify(deriveCasting(g1)) === JSON.stringify(deriveCasting(g1)));
console.log('ALIAS type==game_type:', deriveCasting({ id: 1, type: 'werewolf', created_at: '2026-09-10 12:00:00', player_count: 6 }).numbers.a === deriveCasting(g1).numbers.a);

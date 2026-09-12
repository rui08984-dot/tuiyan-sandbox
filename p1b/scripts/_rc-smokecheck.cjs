'use strict';
// 烟测实证判读（临时）：pred#91-101 各行 run_id/Range/P 原始字节
const { db } = require('../src/deps');
db.init();
const conn = db.getConnection();
const rows = conn.prepare('SELECT v.id, v.prediction_id, v.prompt_variant, v.implied_prob, v.run_id, v.verdict_text FROM verdicts v JOIN predictions p ON p.id=v.prediction_id WHERE p.checklist_hash=\'v2\' AND v.run_id=\'f4f760aa50e1\' ORDER BY v.id').all();
for (const r of rows) {
  const t = r.verdict_text;
  console.log('v#' + r.id + ' pid=' + r.prediction_id + ' ' + r.prompt_variant + ' P=' + r.implied_prob + ' run_id=' + r.run_id);
  console.log('   尾40字=' + JSON.stringify(t.slice(-40)));
  console.log('   含Range字面=' + (t.indexOf('Range:') !== -1) + ' 含三段头=' + (t.indexOf('账本证据引用') !== -1) + '/' + (t.indexOf('账本声称记录') !== -1) + '/' + (t.indexOf('账本机械统计') !== -1));
}
db.closeCurrent();

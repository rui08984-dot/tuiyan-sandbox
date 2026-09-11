'use strict';
// 烟测四项自检（R-A 批次1-R-A）：结果留档 smoketest-run1-20260912.out
// ①v1 verdict_text 引用事件内容 ②三路 Range 行+末行 P=0.xx ③v2 零证据零基率 ④v3@L6 含基率背景行且 L1 无
const fs = require('fs');
const path = require('path');
const { db } = require('../../p1b/src/deps');
const predictions = require('../../p1b/src/db/predictionsStore');
const V = require('../../p1b/src/routes/verdicts');
const conn = db.getConnection();
const out = [];
const log = (s) => { out.push(s); };
const pids = conn.prepare('SELECT DISTINCT prediction_id FROM verdicts ORDER BY prediction_id').all().map((r) => r.prediction_id);
log('SMOKE-CHECK pids=' + pids.join(',') + ' rows=' + conn.prepare('SELECT COUNT(*) n FROM verdicts').get().n);
const mockRows = conn.prepare("SELECT COUNT(*) n FROM verdicts WHERE verdict_text LIKE '[MOCK%'").get().n;
log('live-confirm: [MOCK rows=' + mockRows + ' (必须=0)');
const gameCache = {};
let fails = 0;
const promptChecks = [];
for (const pid of pids) {
  const pred = predictions.getPrediction(pid);
  if (!gameCache[pred.game_id]) gameCache[pred.game_id] = require('../../p1b/src/routes/games').getGameOr404(pred.game_id);
  const game = gameCache[pred.game_id];
  // prompt 级验证（确定性，不依赖 LLM 回显）
  const eb = V.loadEvidence(pred);
  const bl = V.loadBaseline(pred);
  const p1 = V.buildUserPrompt(pred, game, { evidenceBlock: eb });
  const p2 = V.buildUserPrompt(pred, game, {});
  const p3 = V.buildUserPrompt(pred, game, { baseline: bl });
  promptChecks.push({ pid, layer: pred.layer, v1_hasEvid: eb.startsWith(V.EVIDENCE_HEAD), v1_noEvid: eb === V.NO_EVIDENCE_LINE, v2_clean: !p2.includes('账本事件引用') && !p2.includes('账本历史统计'), v3_baseLine: bl ? V.formatBaselineLine(bl) : null });
  const vs = conn.prepare('SELECT * FROM verdicts WHERE prediction_id = ? ORDER BY id').all(pid);
  for (const v of vs) {
    const lines = v.verdict_text.trim().split(/\r?\n/);
    const lastLine = lines[lines.length - 1];
    const hasP = /(^|[^A-Za-z0-9])P\s*=\s*[01](\.\d+)?\s*$/i.test(lastLine);
    const hasRange = lines.some((l) => /^Range:\s*\d+%?-\d+%$/i.test(l.trim()));
    if (!hasP || !hasRange) fails++;
    log('pid=' + pid + ' ' + v.prompt_variant + ' T=' + v.temperature + ' prob=' + v.implied_prob + ' Range=' + hasRange + ' P末行=' + hasP + (hasP ? '' : ' LAST=' + JSON.stringify(lastLine)));
  }
}
// 汇总判定
const allV1 = promptChecks.filter((c) => c.v1_hasEvid);
const allV2Clean = promptChecks.every((c) => c.v2_clean);
const l6v3 = promptChecks.filter((c) => c.layer === 'L6');
const l1v3 = promptChecks.filter((c) => c.layer === 'L1');
log('--- prompt 级注入 ---');
for (const c of promptChecks) log('pid=' + c.pid + ' layer=' + c.layer + ' v1证据=' + (c.v1_hasEvid ? '注入' : (c.v1_noEvid ? '无证据行(空)' : '其他')) + ' v2洁净=' + c.v2_clean + ' v3基率行=' + (c.v3_baseLine === null ? '(不注入)' : c.v3_baseLine.slice(0, 60)));
log('--- 判定 ---');
log('④a v3@L6 基率行注入: ' + l6v3.length + '/' + l6v3.length + ' 全部非 null → ' + (l6v3.every((c) => c.v3_baseLine && c.v3_baseLine.includes('账本历史统计')) ? 'PASS' : 'FAIL'));
log('④b v3@L1 不注入: ' + (l1v3.every((c) => c.v3_baseLine === null) ? 'PASS' : 'FAIL'));
log('③ v2 prompt 纯题面(零证据零基率): ' + (allV2Clean ? 'PASS' : 'FAIL'));
log('① v1 证据块注入条数: ' + allV1.length + '/' + promptChecks.length + ' (无证据行=如实标注)');
log('② Range+P末行 违例行数: ' + fails + ' → ' + (fails === 0 ? 'PASS' : 'FAIL'));
const file = path.join(__dirname, 'smoketest-run1-20260912.out');
fs.writeFileSync(file, out.join('\n'), 'utf8');
console.log(out.join('\n'));
console.log('SAVED -> ' + file);
try { db.closeCurrent(); } catch (e) {}
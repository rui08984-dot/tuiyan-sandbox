'use strict';
/* run-retest-b7.cjs — B7 修复后复测采集（真实 API，≤12 条子集）
 * 链路与生产同构：providers options → withBotcExtractContext(options, script, speakerSeat)
 * → llm.extract（p1a llm.js）。对比对象 = B5 全量 raw/all-results.json。
 * 输出: raw-b7/<id>.json + raw-b7/all-results-b7.json（增量合并）
 */
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..', '..', '..', '..');
const llm = require(path.join(ROOT, 'p1a-terminal', 'src', 'llm.js'));
const { withBotcExtractContext } = require(path.join(ROOT, 'p1b', 'src', 'botc', 'extractPrompt.js'));
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'p1a-terminal', 'config', 'providers.json'), 'utf8'));
const prov = cfg.providers[cfg.active];
const options0 = { apiKey: prov.api_key, baseUrl: prov.base_url, model: (prov.extraction && prov.extraction.model) || 'glm-5.3-flash' };
const samplesJson = JSON.parse(fs.readFileSync(path.join(HERE, 'samples.json'), 'utf8'));
const IDS = ['tb-03', 'tb-04', 'bmr-03', 'snv-03', 'snv-04', 'snv-02', 'tb-02', 'bmr-02', 'tb-01', 'bmr-07', 'snv-07'];
const RAW = path.join(HERE, 'raw-b7');
fs.mkdirSync(RAW, { recursive: true });
const ALL = path.join(RAW, 'all-results-b7.json');
const LOG = path.join(HERE, 'run-b7-log.txt');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function log(line) { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + line + '\n'); console.log(line); }
(async () => {
  let results = fs.existsSync(ALL) ? JSON.parse(fs.readFileSync(ALL, 'utf8')).results : [];
  const done = {}; for (const r of results) { if (!r.error) done[r.id] = true; }
  const t0All = Date.now();
  log('=== B7 retest start model=' + options0.model + ' subset=' + IDS.join(','));
  for (const id of IDS) {
    if (done[id]) { log('[' + id + '] skip (done)'); continue; }
    const s = samplesJson.samples.find(x => x.id === id);
    const row = { id: s.id, edition: s.edition, cat: s.cat, day: s.day, phase: s.phase,
      speakerSeat: s.speakerSeat, text: s.text, expected: s.expected, ms: null, attempts_external: 0, error: null, out: null };
    const t0 = performance.now();
    for (let ext = 0; ext <= 2; ext++) {
      row.attempts_external = ext;
      try {
        // 生产同构：botc 局挂剧本 → withBotcExtractContext 包装（L1 请求注入 + L2 响应载体化）
        const wrapped = withBotcExtractContext(options0, s.edition, s.speakerSeat);
        const r = await llm.extract({ text: s.text, players: samplesJson.players, day: s.day, phase: s.phase,
          speakerSeat: s.speakerSeat, options: wrapped });
        row.ms = Math.round((performance.now() - t0) * 1000) / 1000;
        row.out = { event: r.event, claims: r.claims, action: r.action, warnings: r.warnings, meta: r.meta, actor_seat: r.event.actor_seat };
        row.error = null;
        break;
      } catch (e) {
        row.ms = Math.round((performance.now() - t0) * 1000) / 1000;
        row.error = String((e && e.message) || e);
        log('[' + s.id + '] attempt ' + (ext + 1) + ' FAILED: ' + row.error.slice(0, 200));
        if (ext < 2) await sleep(1100);
      }
    }
    results = results.filter(r => r.id !== s.id).concat([row]);
    fs.writeFileSync(ALL, JSON.stringify({ startedAt: new Date(t0All).toISOString(), endpoint: { baseUrl: options0.baseUrl, model: options0.model, note: 'B7 retest; api_key 仅内存' }, players: samplesJson.players, results }, null, 2));
    fs.writeFileSync(path.join(RAW, s.id + '.json'), JSON.stringify(row, null, 2));
    const att = row.out && row.out.meta ? row.out.meta.attempts : '-';
    log('[' + s.id + '] ' + s.cat + ' ' + row.ms + 'ms ext=' + row.attempts_external + ' internal=' + att + (row.error ? ' ERROR' : ' ok claims=' + (row.out.claims || []).length));
    await sleep(1100);
  }
  log('=== B7 DONE total=' + Math.round((Date.now() - t0All) / 1000) + 's');
})().catch(e => { log('FATAL ' + String((e && e.stack) || e)); process.exit(1); });
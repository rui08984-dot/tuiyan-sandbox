'use strict';
/* run-retest.cjs — B5 三本口播 LIVE 抽取重测采集（真实 API，tokenrhythm/glm-5.3-flash）
 * 复用 docs/sandbox/p1a/extract-live-runner.cjs 成熟模式：直接 require
 * p1a-terminal/src/llm.js 组装 options 真调 API，不起服务器。
 * 用法:
 *   node run-retest.cjs                # 全量 27 条（跳过已成功的）
 *   node run-retest.cjs --only=tb-01   # 冒烟单条
 * 输出: raw/<id>.json（逐条）+ raw/all-results.json（增量合并，崩溃不丢）
 * 限速: 每请求间隔 >=1.1s；外部重试 <=2 次（如实记录 attempts_external）
 */
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..', '..', '..', '..');
const llm = require(path.join(ROOT, 'p1a-terminal', 'src', 'llm.js'));
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'p1a-terminal', 'config', 'providers.json'), 'utf8'));
const prov = cfg.providers[cfg.active];
const options = {
  apiKey: prov.api_key,
  baseUrl: prov.base_url,
  model: (prov.extraction && prov.extraction.model) || 'glm-5.3-flash'
};
const samples = JSON.parse(fs.readFileSync(path.join(HERE, 'samples.json'), 'utf8'));
const RAW = path.join(HERE, 'raw');
fs.mkdirSync(RAW, { recursive: true });
const ALL = path.join(RAW, 'all-results.json');
const LOG = path.join(HERE, 'run-log.txt');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function log(line) {
  fs.appendFileSync(LOG, new Date().toISOString() + ' ' + line + '\n');
  console.log(line);
}
let done = {};
if (fs.existsSync(ALL)) {
  try { for (const r of JSON.parse(fs.readFileSync(ALL, 'utf8')).results) { if (!r.error) done[r.id] = true; } } catch (e) { /* 坏档则全量重跑 */ }
}
(async () => {
  const only = process.argv.find(a => a.startsWith('--only='));
  let results = fs.existsSync(ALL) ? JSON.parse(fs.readFileSync(ALL, 'utf8')).results : [];
  const t0All = Date.now();
  let apiCalls = 0;
  log('=== run start model=' + options.model + ' base=' + options.baseUrl + ' only=' + (only || 'ALL') + ' alreadyDone=' + Object.keys(done).length);
  for (const s of samples.samples) {
    if (only && s.id !== only.slice(7)) continue;
    if (done[s.id]) { log('[' + s.id + '] skip (done)'); continue; }
    const row = {
      id: s.id, edition: s.edition, cat: s.cat, day: s.day, phase: s.phase,
      speakerSeat: s.speakerSeat, text: s.text, expected: s.expected,
      ms: null, attempts_external: 0, error: null, out: null
    };
    const t0 = performance.now();
    for (let ext = 0; ext <= 2; ext++) {           // 外部重试 <=2（llm.js 内部另有 JSON/传输重试 <=2）
      row.attempts_external = ext;
      try {
        const r = await llm.extract({
          text: s.text, players: samples.players, day: s.day, phase: s.phase,
          speakerSeat: s.speakerSeat, options
        });
        apiCalls++;
        row.ms = Math.round((performance.now() - t0) * 1000) / 1000;
        row.out = {
          event: r.event, claims: r.claims, action: r.action,
          warnings: r.warnings, meta: r.meta, actor_seat: r.event.actor_seat
        };
        row.error = null;
        break;
      } catch (e) {
        apiCalls++;
        row.ms = Math.round((performance.now() - t0) * 1000) / 1000;
        row.error = String((e && e.message) || e);
        log('[' + s.id + '] attempt ' + (ext + 1) + ' FAILED: ' + row.error.slice(0, 200));
        if (ext < 2) await sleep(1100);
      }
    }
    results = results.filter(r => r.id !== s.id).concat([row]);
    fs.writeFileSync(ALL, JSON.stringify({
      startedAt: new Date(t0All).toISOString(),
      endpoint: { baseUrl: options.baseUrl, model: options.model, note: 'api_key 仅内存，不落盘' },
      players: samples.players, results
    }, null, 2));
    fs.writeFileSync(path.join(RAW, s.id + '.json'), JSON.stringify(row, null, 2));
    const att = row.out && row.out.meta ? row.out.meta.attempts : '-';
    log('[' + s.id + '] ' + s.cat + ' ' + row.ms + 'ms ext=' + row.attempts_external + ' internal=' + att
      + (row.error ? ' ERROR(external retries exhausted)' : ' ok claims=' + (row.out.claims || []).length));
    await sleep(1100);                              // 限速 >=1s/请求
  }
  log('=== ALL DONE total=' + Math.round((Date.now() - t0All) / 1000) + 's apiCalls(approx)=' + apiCalls);
})().catch(e => { log('FATAL ' + String((e && e.stack) || e)); process.exit(1); });
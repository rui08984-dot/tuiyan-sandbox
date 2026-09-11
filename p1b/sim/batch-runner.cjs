'use strict';
/** p1b/sim/batch-runner.cjs —— M1 批量 30 局顺序执行器。
 * 规程：prereg-batch.json 冻结清单（同五元组 30 seed）；每局 stage1→stage2；
 * batch-progress.json 每局落盘（续跑锚，已完成局不重跑）；哨兵每 10 局一次；
 * 熔断：累计 token>60 万 或 llm-fail 率>10%（calls>=30 起）即停。 */
const fs = require('fs');
const path = require('path');
const dbApi = require('../../p1a-terminal/src/db.js');
const { main } = require('./sim-loop.cjs');
const { runSentinel } = require('./sentinel.cjs');
const NL = String.fromCharCode(10);
const SIM = __dirname;
const OUT = path.join(SIM, 'out', 'batch');
const PROG = path.join(OUT, 'batch-progress.json');
const BATCH = JSON.parse(fs.readFileSync(path.join(SIM, 'prereg-batch.json'), 'utf8'));
const DB = path.join(SIM, '..', '..', 'p1a-terminal', 'data', 'p1a.db');
const PREREG = path.join(SIM, 'prereg.json');

function loadProg() {
  try { return JSON.parse(fs.readFileSync(PROG, 'utf8')); }
  catch (e) { return { games: BATCH.seeds.map(s => ({ seed: s, name: 'sim-ww-' + s, status: 'pending' })), tokens: 0, calls: 0, llmFails: 0, done: 0 }; }
}
function saveProg(p) { p.updated_at = new Date().toISOString(); fs.writeFileSync(PROG, JSON.stringify(p, null, 2)); }

async function runOne(prog, g, i) {
  const stepLog = msg => fs.appendFileSync(path.join(OUT, 'batch.log'), new Date().toISOString() + ' ' + msg + NL);
  const argvBase = ['node', 'sim-loop', '--prereg', PREREG, '--db', DB, '--out', OUT, '--name', g.name, '--seed', String(g.seed)];
  if (g.status !== 'stage1') {
    stepLog((i + 1) + '/30 stage1 ' + g.name);
    await main(argvBase.concat(['--stage', '1']));
    g.status = 'stage1'; saveProg(prog);
  }
  stepLog((i + 1) + '/30 stage2 ' + g.name);
  await main(argvBase.concat(['--stage', '2']));
  const sum = JSON.parse(fs.readFileSync(path.join(OUT, g.name + '.summary.json'), 'utf8'));
  g.status = 'done'; g.gid = sum.game_id; g.result = sum.result;
  g.tokens = sum.usage.prompt_tokens + sum.usage.completion_tokens;
  g.calls = sum.usage.calls; g.parse_fallback = sum.usage.parse_fallback;
  prog.tokens += g.tokens; prog.calls += g.calls; prog.done += 1;
  dbApi.init(DB);
  const c = dbApi.getConnection();
  const fails = c.prepare("SELECT COUNT(*) n FROM actions WHERE event_id IN (SELECT id FROM events WHERE game_id=?) AND action='abstain' AND result LIKE 'llm-fail%'").get(g.gid).n;
  g.llmFails = fails + (g.parse_fallback || 0);
  prog.llmFails += g.llmFails;
  stepLog('done ' + g.name + ' result=' + g.result + ' tokens=' + g.tokens + ' calls=' + g.calls + ' llmFails=' + g.llmFails + ' cumTokens=' + prog.tokens);
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const prog = loadProg();
  const stepLog = msg => fs.appendFileSync(path.join(OUT, 'batch.log'), new Date().toISOString() + ' ' + msg + NL);
  stepLog('batch start done=' + prog.done);
  for (let pass = 0; pass < 2; pass++) { // pass0 正序；pass1 对 error 局单次重试
    for (let i = 0; i < prog.games.length; i++) {
      const g = prog.games[i];
      if (g.status === 'done' || (pass === 0 && g.status === 'error') || (pass === 1 && g.status !== 'error')) continue;
      try { await runOne(prog, g, i); }
      catch (e) { g.status = 'error'; g.error = String(e && e.message).slice(0, 200); stepLog('ERROR ' + g.name + ': ' + g.error); }
      if (prog.tokens > BATCH.budget_guards.max_total_tokens) { stepLog('STOP: token budget ' + prog.tokens); saveProg(prog); return; }
      if (prog.calls >= 30 && prog.llmFails / prog.calls > BATCH.budget_guards.max_llm_fail_rate) { stepLog('STOP: llm-fail rate ' + (prog.llmFails / prog.calls).toFixed(3)); saveProg(prog); return; }
      const doneCount = prog.games.filter(x => x.status === 'done').length;
      if (doneCount > 0 && doneCount % 10 === 0 && !prog['sentinel' + doneCount]) {
        const files = prog.games.filter(x => x.status === 'done').map(x => path.join(OUT, x.name + '.replay.md'));
        const repPath = path.join(OUT, 'm1-sentinel-' + doneCount + '.txt');
        runSentinel(files, repPath);
        prog['sentinel' + doneCount] = true;
        // 批次2-M1 哨兵熔断（S1 A4 修法）：报告读回，WARN 命中→sentinelWarns+1 否则清零；
        // 连续≥2 → STOP（与 token/llm-fail 熔断同级同形态），人工复核门后人工清 prog.sentinelWarns 才续跑。
        let repText = '';
        try { repText = fs.readFileSync(repPath, 'utf8'); } catch (e) { repText = ''; }
        if (/WARN/.test(repText)) {
          prog.sentinelWarns = (prog.sentinelWarns || 0) + 1;
          stepLog('sentinel-' + doneCount + ' WARN ×' + prog.sentinelWarns);
          if (prog.sentinelWarns >= 2) {
            stepLog('STOP: sentinel WARN ×2 — 人工复核门');
            saveProg(prog);
            return;
          }
        } else {
          prog.sentinelWarns = 0;
          stepLog('sentinel-' + doneCount + ' written');
        }
      }
      if ((i + 1) % 5 === 0) stepLog('batch checkpoint ' + (i + 1) + '/30 (done=' + doneCount + ')');
      saveProg(prog);
    }
    if (pass === 0) stepLog('pass0 done=' + prog.done + ' errors=' + prog.games.filter(x => x.status === 'error').length);
  }
  stepLog('batch complete done=' + prog.done + '/30 tokens=' + prog.tokens + ' llmFails=' + prog.llmFails);
}

run().then(() => process.exit(0)).catch(e => { try { fs.appendFileSync(path.join(OUT, 'batch.log'), 'FATAL ' + String(e && e.stack || e) + NL); } catch (_) {} process.exit(1); });

'use strict';
const fs = require('fs');
const dir = 'E:/music player/.scratch/forecast-debate/';
const names = ['acr-phase2-llm-results-A.json','acr-phase2-llm-results-A-full.json','acr-phase2-llm-results-B.json','acr-phase2-llm-results-C.json'];
const out = [];
for (const f of names) {
  let j; try { j = JSON.parse(fs.readFileSync(dir + f, 'utf8')); } catch (e) { out.push(f + ' LOADFAIL ' + e.message); continue; }
  out.push('===== ' + f + ' | ' + j.generated_at);
  out.push('corpus: ' + j.corpus + ' | calls_used: ' + j.calls_used + ' | cost: ' + JSON.stringify(j.cost));
  out.push('params: ' + JSON.stringify(j.params));
  for (const wn of Object.keys(j.windows)) {
    const w = j.windows[wn];
    out.push('  [' + wn + '] n=' + w.n_games_paired + ' mean(win=' + w.main_reading_mean.tv_win + ',vote=' + w.main_reading_mean.tv_vote + ',max=' + w.main_reading_mean.max + ') medMax=' + w.main_reading_median.max + ' pgMeanMax=' + w.per_game_max_mean + ' p90=' + w.per_game_max_p90);
    out.push('    noiseMax=' + w.noise_floor_self.max + ' pass(mean/med/pg)=' + w.pass_mean + '/' + w.pass_median + '/' + w.pass_pergame_mean + ' pw ' + w.p_win_mean_base + '->' + w.p_win_mean_poll + ' shift=' + w.p_win_signed_shift);
    out.push('    per_game: ' + (w.per_game || []).map(p => p.gid + ':m' + (p.max == null ? 'null' : p.max.toFixed(3))).join(' '));
    const pe = (w.polluted_per_game || []).filter(r => r.error).map(r => r.gid + ':' + String(r.error).slice(0, 100));
    const be = (w.baseline_per_game || []).filter(r => r.error).map(r => r.gid + ':' + String(r.error).slice(0, 100));
    if (pe.length) out.push('    poll_err: ' + pe.join(' | '));
    if (be.length) out.push('    base_err: ' + be.join(' | '));
  }
}
fs.writeFileSync(dir + '_acr2-summary.txt', out.join('\n'), 'utf8');
console.log('WROTE lines=' + out.length);

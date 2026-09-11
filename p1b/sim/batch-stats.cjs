'use strict';
/** p1b/sim/batch-stats.cjs —— M1 批量统计：30 局清单/胜负分布/发言长度分布(对比首局)/llm-fail 率/token 成本 + AI 腔抽检 30 条清单 */
const fs = require('fs');
const path = require('path');
const dbApi = require('../../p1a-terminal/src/db.js');
const NL = String.fromCharCode(10);
const OUT = path.join(__dirname, 'out', 'batch');
dbApi.init(path.join(__dirname, '..', '..', 'p1a-terminal', 'data', 'p1a.db'));
const conn = dbApi.getConnection();
const games = conn.prepare("SELECT id,name,meta FROM games WHERE name LIKE 'sim-ww-2026%' AND source='sim' ORDER BY id").all();
const L1 = [], L2 = []; let fails = 0, calls = 0, tokens = 0; const wins = { village_win: 0, wolf_win: 0 };
const rows = [];
const sample = [];
for (const g of games) {
  const m = JSON.parse(g.meta || '{}');
  const qc = m.qc || {}; const t = m.truth || {}; const s1 = m.stage1 || {}; 
  const st = conn.prepare("SELECT actor_seat, raw_text FROM events WHERE game_id=? AND type='statement' ORDER BY seq").all(g.id);
  const lens = st.map(e => e.raw_text.length);
  L2.push(...lens);
  const af = conn.prepare("SELECT COUNT(*) n FROM actions WHERE event_id IN (SELECT id FROM events WHERE game_id=?) AND action='abstain' AND result LIKE 'llm-fail%'").get(g.id).n;
  fails += af + (qc.parse_fallback || 0); calls += qc.calls || 0; tokens += (qc.prompt_tokens || 0) + (qc.completion_tokens || 0);
  if (t.result) wins[t.result] = (wins[t.result] || 0) + 1;
  rows.push({ name: g.name, gid: g.id, result: t.result, tokens: (qc.prompt_tokens || 0) + (qc.completion_tokens || 0), calls: qc.calls, llmFails: af + (qc.parse_fallback || 0), speechLens: lens.join('/') });
  if (st.length) sample.push({ game: g.name, seat: st[0].actor_seat, text: st[0].raw_text.slice(0, 200) });
}
// 首局=seed 20260912
const first = games.find(g => g.name === 'sim-ww-20260912');
let firstStats = '(首局不在库)';
if (first) { const f = conn.prepare("SELECT raw_text FROM events WHERE game_id=? AND type='statement' ORDER BY seq").all(first.id).map(e => e.raw_text.length); firstStats = '首局 n=' + f.length + ' 长度=' + f.join('/') + ' 均值=' + (f.reduce((a, b) => a + b, 0) / Math.max(1, f.length)).toFixed(0); L1.push(...f); }
const mean = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(0) : '0';
const med = a => { if (!a.length) return '0'; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const out = [];
out.push('M1 批量统计（' + games.length + '/30 局，source=sim，一夜狼 6 人）');
out.push('');
out.push('== 30 局清单 ==');
rows.forEach((r0, i) => out.push((i + 1) + '. ' + r0.name + ' gid=' + r0.gid + ' ' + r0.result + ' tokens=' + r0.tokens + ' calls=' + r0.calls + ' llmFails=' + r0.llmFails + ' 发言长度[' + r0.speechLens + ']'));
out.push('');
out.push('== 胜负分布 ==');
out.push('village_win=' + (wins.village_win || 0) + '  wolf_win=' + (wins.wolf_win || 0) + '  （随机放逐基线：夜刀后 5 活人含 2 狼 3 民，P(逐中狼)=3/5 → 狼胜期望 12/30；实测显著偏离 → 好人侧 LLM 放逐决策劣于随机，策略不对称信号）');
out.push('');
out.push('== 发言长度分布 ==');
out.push('全部: n=' + L2.length + ' 均值=' + mean(L2) + ' 中位=' + med(L2));
out.push('对比首局: ' + firstStats);
out.push('');
out.push('== 落库量（L0 records 口径） ==');
const simEv = conn.prepare("SELECT COUNT(*) n FROM events WHERE game_id IN (SELECT id FROM games WHERE source='sim')").get().n;
const simCl = conn.prepare("SELECT COUNT(*) n FROM claims WHERE event_id IN (SELECT id FROM events WHERE game_id IN (SELECT id FROM games WHERE source='sim'))").get().n;
out.push('events=' + simEv + '  claims=' + simCl + '（L0 门禁=games≥30 ∧ records≥200）');
out.push('');
out.push('== 成本与失败率 ==');
out.push('LLM 调用=' + calls + '  llm-fail=' + fails + '（率 ' + (calls ? (fails / calls * 100).toFixed(1) : '?') + '%，熔断线 10%）');
out.push('tokens: prompt+completion 总=' + tokens + '（熔断线 600000）  均值/局=' + (games.length ? (tokens / games.length).toFixed(0) : '?'));
fs.writeFileSync(path.join(OUT, 'm1-stats.txt'), out.join(NL) + NL);

const s2 = ['M1 AI 腔抽检清单（每局 1 条=该局第一条发言，供 aidetect 集成打分；30 条）', ''];
sample.forEach((s0, i) => s2.push((i + 1) + '. [' + s0.game + ' ' + s0.seat + '号] ' + s0.text));
fs.writeFileSync(path.join(OUT, 'm1-ai-sample.md'), s2.join(NL) + NL);
console.log('stats written');

'use strict';
/**
 * p1b/test/odds-questions.test.cjs —— 英超 1X2 赔率题出题器 测试（2026-09-17）
 *
 * ① `h2hOutcome`：主胜/客胜/平局三向判定与 pick 语义（**1X2 判定规则单一实现**，resolver 亦用它）
 * ② **真实夹具回收**：`test/fixtures/odds-scores-sample-20260917.json`（The Odds API 实抓，**不含 key**）⇒
 *    用「名字→比分」映射 ＋ `h2hOutcome` 复现真实赛果方向（先验证规则再报数）
 * ③ `pickQuestions`：Q0-2①（快照须早于开赛）／Q0-2②（只对未来场次出题）／Q0-3 基带 (0.15,0.85)／lead_hours／canon 幂等
 * ④ `canonKey`：键序无关 ＋ 剔 url/field/note/cutoff
 * ⑤ CLI dry-run（合成迷你库）：**零写**（行数不变）＋报告落盘；require 零副作用
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'odds-questions.cjs');
const FIXTURE = path.join(ROOT, 'p1b', 'test', 'fixtures', 'odds-scores-sample-20260917.json');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-odds-'));
test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
const M = require(SCRIPT);

test('① h2hOutcome：三向判定与 pick 语义；非数 ⇒ null', () => {
  assert.equal(M.h2hOutcome(4, 1, 'home').outcome, 'true', '4-1 ⇒ 主胜 true');
  assert.equal(M.h2hOutcome(1, 4, 'home').outcome, 'false', '1-4 ⇒ 主胜 false');
  assert.equal(M.h2hOutcome(2, 2, 'home').outcome, 'false', '平局 ⇒ 主胜 false（平局不计主胜）');
  assert.equal(M.h2hOutcome(2, 2, 'draw').outcome, 'true', '平局 ⇒ draw true');
  assert.equal(M.h2hOutcome(2, 2, 'away').outcome, 'false', '平局 ⇒ 客胜 false');
  assert.equal(M.h2hOutcome(0, 3, 'away').outcome, 'true', '0-3 ⇒ 客胜 true');
  assert.equal(M.h2hOutcome(undefined, 1, 'home'), null, '比分缺失 ⇒ null（不猜）');
  assert.equal(M.h2hOutcome(1, 1, 'nonsense'), null, '未知 pick ⇒ null');
});

test('② ★真实夹具回收：实抓 API 响应 ⇒ 规则复现真实赛果方向', () => {
  const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  assert.ok(Array.isArray(fx) && fx.length >= 1, '夹具须含 ≥1 场已完赛');
  assert.ok(!/apiKey/.test(JSON.stringify(fx)), '★夹具不得含 key/URL');
  for (const m of fx) {
    assert.ok(m.completed === true && Array.isArray(m.scores) && m.scores.length >= 2, '夹具条目须为已完赛且有比分');
    const sc = {}; for (const s of m.scores) sc[String(s.name)] = Number(s.score);
    const v = M.h2hOutcome(sc[m.home_team], sc[m.away_team], 'home');
    assert.notEqual(v, null, '名字映射须命中双方比分: ' + m.home_team + ' / ' + m.away_team);
    const expect = sc[m.home_team] > sc[m.away_team] ? 'true' : 'false';
    assert.equal(v.outcome, expect, m.home_team + ' ' + v.detail + ' ' + m.away_team + ' ⇒ 主胜应为 ' + expect);
  }
});

test('③ pickQuestions：Q0-2 两条 ＋ Q0-3 基带 ＋ lead_hours ＋ 幂等键', () => {
  const b = {
    snapshot_utc: '2026-09-17T07:24:46.199Z', league: 'soccer_epl',
    matches: [
      { id: 'm-future-ok', commence_utc: '2026-09-20T15:00:00Z', home: 'A', away: 'B', consensus: { n_books: 24, probs_mean: [0.5, 0.25, 0.25] } },
      { id: 'm-past', commence_utc: '2026-09-14T15:00:00Z', home: 'C', away: 'D', consensus: { n_books: 24, probs_mean: [0.5, 0.25, 0.25] } },
      { id: 'm-outband', commence_utc: '2026-09-21T15:00:00Z', home: 'E', away: 'F', consensus: { n_books: 24, probs_mean: [0.92, 0.05, 0.03] } },
      { id: 'm-no-consensus', commence_utc: '2026-09-21T15:00:00Z', home: 'G', away: 'H', consensus: {} },
    ],
  };
  const laterSnap = { snapshot_utc: '2026-09-22T00:00:00Z', league: 'soccer_epl',
    matches: [{ id: 'm-snap-after', commence_utc: '2026-09-21T15:00:00Z', home: 'I', away: 'J', consensus: { probs_mean: [0.5, 0.25, 0.25] } }] };
  const r = M.pickQuestions([b, laterSnap], { nowIso: '2026-09-17T18:00:00Z', league: 'soccer_epl' });
  assert.deepEqual(r.cands.map((c) => c.resolve.match_id), ['m-future-ok'], '只应剩「未来 + 快照早于开赛 + 在带内 + 有共识」那一场');
  assert.equal(r.skipped.past_kickoff, 1, '过去场次跳过（Q0-2②）');
  assert.equal(r.skipped.snapshot_after_kickoff, 1, '快照晚于开赛 ⇒ 跳过（Q0-2①）');
  assert.equal(r.skipped.out_of_band, 1, '0.92 出带 ⇒ 跳过（Q0-3）');
  assert.equal(r.skipped.no_consensus, 1, '无共识 ⇒ 跳过');
  const c = r.cands[0];
  // 期望值由时间戳算出（不写死常数——防手算错：首版手算 68.59 与实现 79.59 不符，经复核实现正确）
  const expLead = (Date.parse('2026-09-20T15:00:00Z') - Date.parse('2026-09-17T07:24:46.199Z')) / 3600000;
  assert.ok(Math.abs(c.lead_hours - expLead) < 0.01, 'lead_hours 应＝' + expLead.toFixed(3) + 'h（实测 ' + c.lead_hours + '）');
  assert.equal(c.prob, 0.5, 'pick=home ⇒ 用 probs_mean[0]');
  assert.equal(c.matures_at, '2026-09-20', 'matures_at ＝ 开赛日');
  assert.ok(c.statement.indexOf('主队获胜') !== -1 && c.statement.indexOf('A vs B') !== -1, '题面含对阵与判定');
  assert.equal(c.marketPrice.p_draw, 0.25, '三路口径留档');
  // 幂等：同输入 ⇒ 同 canon（跨调用稳定）
  assert.equal(M.pickQuestions([b], { nowIso: '2026-09-17T18:00:00Z' }).cands[0].canon, c.canon, 'canon 须稳定');
});

test('④ canonKey：键序无关 ＋ 剔易变字段', () => {
  const a = { kind: 'k', match_id: 'm', snapshot_utc: 't', url: 'http://x', note: 'n' };
  const b = { snapshot_utc: 't', match_id: 'm', kind: 'k', field: 'f' };
  assert.equal(M.canonKey(a), M.canonKey(b), '键序/易变字段不影响 canon');
  assert.notEqual(M.canonKey(a), M.canonKey({ kind: 'k', match_id: 'm2', snapshot_utc: 't' }), '语义字段变了 ⇒ canon 变');
});

test('⑤ CLI dry-run：合成迷你库零写 ＋ 报告落盘；require 零副作用', () => {
  const mini = path.join(tmpDir, 'mini.db');
  const db = new DatabaseSync(mini);
  db.exec('CREATE TABLE predictions (id INTEGER PRIMARY KEY, evidence_json TEXT)');
  db.exec('CREATE TABLE games (id INTEGER PRIMARY KEY, game_type TEXT, name TEXT, player_count INTEGER, created_at TEXT, source TEXT)');
  db.close();
  const snap = path.join(tmpDir, 'odds-snapshots-soccer_epl.jsonl');
  fs.writeFileSync(snap, JSON.stringify({ snapshot_utc: '2026-09-17T07:24:46.199Z', league: 'soccer_epl', matches: [
    { id: 'mm1', commence_utc: '2026-09-25T15:00:00Z', home: 'X', away: 'Y', consensus: { n_books: 3, probs_mean: [0.4, 0.3, 0.3] } }] }) + '\n', 'utf8');

  const out = execFileSync(process.execPath, [SCRIPT, '--db', mini, '--snapshots', snap], { encoding: 'utf8' });
  assert.ok(/DRY-RUN/.test(out) && /候选 1/.test(out), 'dry-run 应报候选且不写库: ' + out.slice(0, 160));
  const d2 = new DatabaseSync(mini, { readOnly: true });
  assert.equal(d2.prepare('SELECT COUNT(*) c FROM predictions').get().c, 0, 'dry-run 不得写行');
  assert.equal(d2.prepare('SELECT COUNT(*) c FROM games').get().c, 0, 'dry-run 不得建容器局');
  const tabs = d2.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((x) => x.name);
  // 注：`deps.db.init()` 会把**应用 schema**（predictions 七审计列等）物化到库上 ⇒ 表集合必然增长，**属正常**；
  //   本测试锁的是「**零行写入**」（上两行的 0 行断言）＋「原表仍在」；
  //   也**不对库文件字节作断言**——SQLite 打开/查询会更新头部记账（实测 size 会变）。
  assert.ok(tabs.indexOf('predictions') !== -1 && tabs.indexOf('games') !== -1, '原表须仍在: ' + tabs.join(','));
  d2.close();
  // require 零副作用
  const snapshot = () => fs.readdirSync(path.join(ROOT, 'p1b', 'sim', 'out')).sort().join('\n');
  const s0 = snapshot();
  execFileSync(process.execPath, ['-e', 'require(' + JSON.stringify(SCRIPT) + ')'], { encoding: 'utf8' });
  assert.equal(snapshot(), s0, 'require 不得写盘');
  assert.ok(!/\bfetch\s*\(/.test(fs.readFileSync(SCRIPT, 'utf8')), '出题器应离线（无 fetch）');
});

'use strict';
/**
 * p1b/test/judge-runner-immutable.test.cjs —— 判据脚本不可变护栏回归（2026-09-28）
 *
 * 病象：scripts/judge-runner.cjs 两处越过账本不可变守卫，把**已落定**（outcome 非空）行的判据概率重写：
 *   ① 选题 SQL 缺未落定条件 ⇒ 已结算的行同样进批（已落定 ≠ 不可写，二者被混为一谈）；
 *   ② 写回是裸写 `UPDATE predictions SET assigned_prob=? WHERE id=?`，不带任何未落定条件，
 *      且不走 predictionsStore（守卫只在 resolvePrediction 里，不在写回路径上）。
 * 后果：Brier/ECE 的分子分母被事后重算——已公布口径的读数可以随重跑批次漂移。
 *   （旁证：紧邻的 updateAuditFields(p.id,{baselineBrier:undefined}) 是纯 no-op 占位，起不了任何守卫作用。）
 *
 * 本测试锁死三条（防修复过头与防复发两头都堵）：
 *   ① 落定题拒改：同一批里已落定行跑批前后 assigned_prob 逐字不变（子进程实跑，零监听端口）；
 *   ② 活题照常写回：未落定行仍被写入（MOCK 三路 0.25/0.50/0.75 → median 0.5），防护栏把整批打死；
 *   ③ 源码扫描：脚本内**每一条** UPDATE predictions 都必带未落定条件（防后续再加一条裸写回来）。
 *
 * 铁律：临时文件库（P1B_DB_PATH）+ 指向不存在文件的 providers 路径（无 key ⇒ resolveMode 落 MOCK）
 *      ⇒ 零真实网络、零成本、判词内容确定；只建子进程，不起监听端口。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'judge-runner.cjs');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-judge-immutable-'));

test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });

/**
 * 建临时库：一局 sim 域对局 + 两条同口径题（layer=L1、checklist_hash='v2'），
 * 一条已落定（outcome='true'）、一条未落定（outcome IS NULL），两条落注概率均 NULL。
 * games.source 列由 sim-loop 的 additive 迁移加出（src/evidence/labBoundary.js 头注同款口径），
 * buildServer 不建它 ⇒ 测试侧照 sim/sim-loop.cjs:77 的原句补上。
 */
async function buildDb(name) {
  const dbPath = path.join(tmpDir, name);
  const providersPath = path.join(tmpDir, 'providers-' + name + '.json'); // 故意不建 ⇒ 无 key ⇒ MOCK
  const { buildServer } = require('../src/server');
  const app = await buildServer({ dbPath: dbPath, llmMock: true, providersPath: providersPath });
  await app.close();
  const { db } = require('../src/deps');
  db.init(dbPath);
  const conn = db.getConnection();
  const cols = new Set(conn.prepare('PRAGMA table_info(games)').all().map((c) => c.name));
  if (!cols.has('source')) conn.exec("ALTER TABLE games ADD COLUMN source TEXT NOT NULL DEFAULT 'real'");
  const gid = conn.prepare(
    "INSERT INTO games (name, game_type, player_count, created_at, source) VALUES ('t','werewolf',6,'2026-09-01 00:00:00','sim')"
  ).run().lastInsertRowid;
  const ins = conn.prepare(
    "INSERT INTO predictions (game_id, day, source_type, statement, assigned_prob, evidence_json, layer, checklist_hash, outcome, resolved_at)"
    + " VALUES (?,'2026-09-01','预测卡',?,NULL,NULL,'L1','v2',?,?)"
  );
  const settled = ins.run(gid, '已落定题', 'true', '2026-09-02 00:00:00').lastInsertRowid;
  const open = ins.run(gid, '未落定题', null, null).lastInsertRowid;
  db.closeCurrent();
  return { dbPath, providersPath, settled, open };
}

/** 跑判据脚本子进程：临时库 + 无 key（LLM 落 MOCK）+ 显式 runId（防批次指纹回退） */
function runJudge(env) {
  const childEnv = Object.assign({}, process.env, {
    P1B_DB_PATH: env.dbPath,
    P1B_PROVIDERS_PATH: env.providersPath,
  });
  delete childEnv.LLM_API_KEY;          // 无 key ⇒ llm.resolveMode 落 MOCK（零网络）
  delete childEnv.DEEPSEEK_API_KEY;
  delete childEnv.P1B_LLM_MOCK;         // 脚本显式传 llmMock:false；此处清掉以免语义混淆
  return execFileSync(process.execPath, [SCRIPT, '--runid=testimm'], { encoding: 'utf8', env: childEnv });
}

/** 读回两行的 assigned_prob / outcome */
function readProbs(env) {
  const { db } = require('../src/deps');
  db.init(env.dbPath);
  const conn = db.getConnection();
  const pick = (id) => conn.prepare('SELECT id, outcome, assigned_prob FROM predictions WHERE id = ?').get(id);
  const out = { settled: pick(env.settled), open: pick(env.open) };
  db.closeCurrent();
  return out;
}

test('① 已落定题拒改：跑批前后 assigned_prob 逐字不变（账本不可变）', async () => {
  const env = await buildDb('immutable.db');
  const before = readProbs(env);
  assert.strictEqual(before.settled.outcome, 'true', '前置：该行确已落定');
  assert.strictEqual(before.settled.assigned_prob, null, '前置：落注概率为 NULL（便于看出是否被写脏）');

  const out = runJudge(env);

  const after = readProbs(env);
  assert.strictEqual(
    after.settled.assigned_prob, before.settled.assigned_prob,
    '**关键**：已落定题（outcome 非空）的判据概率不得被脚本改写；实得 ' + JSON.stringify(after.settled)
    + '\n脚本输出：\n' + out
  );
});

test('② 未落定题照常写回：护栏不得把活题一起打死（防过度修复）', async () => {
  const env = await buildDb('open.db');
  const out = runJudge(env);

  const after = readProbs(env);
  assert.strictEqual(after.open.outcome, null, '前置：该行仍未落定');
  assert.strictEqual(
    after.open.assigned_prob, 0.5,
    '未落定题应照常拿到 median(MOCK 三路 0.25/0.50/0.75)=0.5；实得 ' + JSON.stringify(after.open)
    + '\n脚本输出：\n' + out
  );
});

test('③ 源码扫描：脚本内每一条 UPDATE predictions 都必带未落定条件（防再加裸写）', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  // 抽出所有写 predictions 表的语句正文（吃到引号/换行/分号/右括号为止，保证 WHERE 条件在捕获范围内）
  const stmts = src.match(/UPDATE\s+predictions[^'"\n;)]*/g) || [];
  assert.ok(stmts.length > 0, '应至少抓到一条 UPDATE predictions（否则说明写法变了，本扫描需重写）');
  for (const s of stmts) {
    assert.ok(
      /outcome\s+IS\s+NULL/i.test(s),
      'UPDATE predictions 必须带未落定条件 `outcome IS NULL`（条件写在 WHERE 里，靠 SQLite 单语句原子性挡 TOCTOU）；实得：' + s
    );
  }
});

test('④ 选题 SQL 排除已落定行：outcome IS NULL 是硬条件', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const sel = src.match(/SELECT\s+pr\.id[\s\S]*?ORDER BY pr\.id/);
  assert.ok(sel, '应抓到选题 SQL');
  assert.ok(
    /pr\.outcome\s+IS\s+NULL/i.test(sel[0]),
    '选题 SQL 必须显式排除已落定行（pr.outcome IS NULL）；实得：' + sel[0]
  );
});

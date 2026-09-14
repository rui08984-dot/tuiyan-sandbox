'use strict';
/**
 * p1b/test/corpus-resolve-guard.test.cjs —— bug-28 护栏回归（2026-09-14）
 *
 * 病象：v1 写入器 `corpus-forward.cjs` 把 kind 硬编码为 `cwl_ssq_red_contains`，
 *   「蓝球为奇数」题（combo=blueodd）被写成 red_contains + ball=null；
 *   解析器 `cwl_ssq_red_contains` 在 ball=null 时 `indexOf(null)` 恒 -1 ⇒ **恒判 false**
 *   ⇒ 上游跑批即把**错误真值**写进账本（不可逆污染）。
 *
 * 本测试锁死两条：
 *   ① 护栏：kind 与参数不匹配时**拒判**（输出 REJECT，绝不产出 outcome）——用临时库子进程跑。
 *   ② 计数：summary 出现 rejected= 字段（可观测，防静默）。
 *
 * 铁律：临时文件库（--db 显式传）；零真实网络（护栏在 fetch 之前返回，不触发取数）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'corpus-resolve.cjs');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-resolve-guard-'));
const { buildServer } = require('../src/server');
const { db } = require('../src/deps');

test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });

/** 建临时库：用 buildServer 触发全量迁移（含 source/g2_regime 等），再落一行指定 resolve 形态的题 */
async function buildDb(name, resolveSpec) {
  const dbPath = path.join(tmpDir, name);
  const app = await buildServer({ dbPath: dbPath, llmMock: true, providersPath: path.join(tmpDir, 'p-' + name) });
  await app.close();                       // 建完 schema 即关写连接，供子进程只读打开
  db.init(dbPath);
  const conn = db.getConnection();
  // games 无 source 列（该口径在 game_type 上：'corpus%'）；predictions.g2_regime 由迁移补列
  const gid = conn.prepare("INSERT INTO games (name, game_type, player_count, created_at) VALUES ('t','corpus:t',6,'2026-09-01 00:00:00')").run().lastInsertRowid;
  const ev = JSON.stringify([{ resolve: resolveSpec, kind: 'forward_batch' }]);
  conn.prepare("INSERT INTO predictions (game_id, source_type, statement, evidence_json, g2_regime, outcome) VALUES (?,'预测卡','测试题',?,'R4',NULL)").run(gid, ev);
  db.closeCurrent();
  return dbPath;
}

test('bug-28 护栏：cwl_ssq_red_contains 缺 ball ⇒ 拒判（REJECT，不产出 outcome）', async () => {
  const dbPath = await buildDb('t1.db', { kind: 'cwl_ssq_red_contains', issue: '2026106', ball: null, blue_odd: true });
  const out = execFileSync(process.execPath, [SCRIPT, '--db', dbPath, '--dry-run'], { encoding: 'utf8' });
  assert.ok(/REJECT/.test(out), '应输出 REJECT（拒判），实得：\n' + out);
  assert.ok(/缺 ball 参数/.test(out), '拒判原因应点名缺 ball');
  assert.ok(/rejected=1/.test(out), 'summary 应含 rejected=1（可观测计数）');
  assert.ok(!/would resolve/.test(out), '**关键**：不得产出 would resolve（即不得判 false）');
});

test('bug-28 护栏：正确 kind（cwl_ssq_blue_odd）不受影响——不在拒判范围', async () => {
  const dbPath = await buildDb('t2.db', { kind: 'cwl_ssq_blue_odd', issue: '2026106' });
  const out = execFileSync(process.execPath, [SCRIPT, '--db', dbPath, '--dry-run'], { encoding: 'utf8' });
  assert.ok(!/REJECT/.test(out), '正确 kind 不应被拒判，实得：\n' + out);
  assert.ok(!/缺 ball 参数/.test(out), '不应触发缺 ball 护栏');
});



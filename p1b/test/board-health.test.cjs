'use strict';
/**
 * p1b/test/board-health.test.cjs —— 看板与体检脚本冒烟（任务 6 批次 2 · 2026-09-14）
 *
 * 锁两点：
 *   ① `board.cjs` 只读运行并输出关键段（G2 门 / 五层 / 账本），且**不修改任何既有读数件**；
 *   ② `exp-health.cjs` 只读运行并输出三件套判读（进程/增长/队列），且**不写任何文件**（除显式 --json）。
 * 零网络（不传 --ping）；子进程运行；用临时输出文件。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const BOARD = path.join(ROOT, 'p1b', 'scripts', 'board.cjs');
const HEALTH = path.join(ROOT, 'p1b', 'scripts', 'exp-health.cjs');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-board-'));
test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });

test('board.cjs：输出四段（G2 门/五层/账本）＋ json 落盘；既有读数件零改动', () => {
  const s4 = path.join(ROOT, 'p1b', 'sim', 'out', 'stage4-run-five-layers-20260914.json');
  const before = fs.existsSync(s4) ? fs.readFileSync(s4, 'utf8') : null;
  const out = path.join(tmpDir, 'board.json');
  const txt = execFileSync(process.execPath, [BOARD, '--json', out], { encoding: 'utf8' });
  assert.match(txt, /一页看板/);
  assert.match(txt, /G2 五门/);
  assert.match(txt, /五层读数/);
  assert.match(txt, /账本/);
  const j = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(j.ledger && j.ledger.integrity === 'ok', 'integrity ok');
  assert.ok(typeof j.ledger.predictions === 'number' && j.ledger.predictions > 0, '账本题数');
  assert.ok(j.layers && Object.keys(j.layers).length >= 4, '至少四层读数透出');
  if (before !== null) assert.equal(fs.readFileSync(s4, 'utf8'), before, '既有读数件零改动');
});

test('exp-health.cjs：输出三件套判读 ＋ 零写盘（除显式 --json）', () => {
  const out = path.join(tmpDir, 'health.json');
  const txt = execFileSync(process.execPath, [HEALTH, '--json', out], { encoding: 'utf8' });
  assert.match(txt, /跑批体检/);
  assert.match(txt, /① 进程/);
  assert.match(txt, /② DB 增长/);
  assert.match(txt, /③ 队列/);
  assert.match(txt, /零增长 ≠ 卡死/, '判读口径写死在输出里');
  const j = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(j.growth && typeof j.growth.total === 'number', 'DB 增长读数');
  assert.ok(j.queue !== null, '队列陈旧度读数');
});

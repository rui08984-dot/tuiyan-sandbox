'use strict';
/**
 * p1b/test/g2-user-spotcheck.test.cjs —— ② 端用户抽验通道（2026-09-14 新增）
 *
 * 背景：② 采信链第③件「端用户抽验 ≥10 题」是必要条件（design §4.2.3 R4.2 D-3③），
 *   但此前**无任何 CLI 能把端用户裁决写回** ⇒ 用户无法完成抽验、② 恒停 pending_user。
 * 本测试锁死新通道的两端：--emit（出人可读表）与 --record（记账并重算 acceptance）。
 *
 * 铁律：零网络；只写临时 JSON（不碰生产库/8787/真实 audit 文件）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'g2-user-spotcheck.cjs');
const REAL_AUDIT = path.join(ROOT, 'p1b', 'sim', 'out', 'g2-audit-r4.json');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-spotcheck-'));

test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });

test('--emit：生成人可读抽验表（含题面/判据/机器段/代理段/裁定栏 + tsv 填写区）', () => {
  const out = path.join(tmpDir, 'table.md');
  execFileSync(process.execPath, [SCRIPT, '--emit', '--n', '10', '--out', out], { stdio: 'ignore' });
  const txt = fs.readFileSync(out, 'utf8');
  assert.ok(/端用户抽验表/.test(txt), '标题含端用户抽验表');
  assert.ok(/裁定: ____/.test(txt), '每题留裁定栏');
  assert.ok(/--record/.test(txt), '提示如何记账');
  assert.ok(/id\tverdict\tnote/.test(txt), 'tsv 填写区表头存在');
  assert.ok(/代理不能代替/.test(txt), '显式声明代理不得代替');
});

test('--record：一致率计算 + acceptance 重算（真实 audit 副本，不碰原文件）', () => {
  const src = fs.readFileSync(REAL_AUDIT, 'utf8');
  const before = JSON.parse(src);
  const ids = (before.items || []).slice(0, 10).map((i) => i.id);
  assert.ok(ids.length >= 10, 'audit 至少有 10 题');
  const copy = path.join(tmpDir, 'audit.json');
  fs.writeFileSync(copy, src); // 全程操作副本
  // 构造「与 ② 综合结论一致」的填写（应得 100%）
  const lines = ['# id\tverdict\tnote'];
  for (const id of ids) {
    const it = before.items.find((x) => x.id === id);
    lines.push(id + '\t' + (it.pass ? 'PASS' : 'REJECT') + '\ttest');
  }
  const tsv = path.join(tmpDir, 'filled.tsv');
  fs.writeFileSync(tsv, lines.join('\n') + '\n');
  const outJson = path.join(tmpDir, 'recorded.json');
  execFileSync(process.execPath, [SCRIPT, '--record', tsv, '--audit', copy, '--out', outJson], { stdio: 'ignore' });
  const a = JSON.parse(fs.readFileSync(outJson, 'utf8'));
  assert.equal(a.human_calibration.user_spot_check, 10, '端用户抽验计数=10');
  assert.equal(a.human_calibration.user_spot_check_required, 10, '必要条件=10');
  assert.equal(a.human_calibration.user_spot_check_agreed, 10, '一致数=10');
  assert.equal(a.human_calibration.user_spot_check_rate, 1, '一致率=1');
  assert.ok(a.human_calibration.user_spot_check_at, '记账时间戳');
  assert.ok(Array.isArray(a.human_calibration.user_spot_check_detail), '逐题明细');
  assert.ok(['accepted', 'pending_recheck', 'pending_user', 'fail'].indexOf(a.human_calibration.acceptance_status) !== -1, 'acceptance 合法枚举');
  // 真实 audit 文件未被本测试改动
  assert.equal(fs.readFileSync(REAL_AUDIT, 'utf8'), src, '真实 audit 零改动');
});

test('--record：不足 10 题 → 仍 pending_user（必要条件不达标不得采信）', () => {
  const src = fs.readFileSync(REAL_AUDIT, 'utf8');
  const before = JSON.parse(src);
  const copy = path.join(tmpDir, 'audit2.json');
  fs.writeFileSync(copy, src);
  const ids = (before.items || []).slice(0, 3).map((i) => i.id);
  const lines = ['# id\tverdict\tnote'];
  for (const id of ids) { const it = before.items.find((x) => x.id === id); lines.push(id + '\t' + (it.pass ? 'PASS' : 'REJECT') + '\t'); }
  const tsv = path.join(tmpDir, 'few.tsv');
  fs.writeFileSync(tsv, lines.join('\n') + '\n');
  const outJson = path.join(tmpDir, 'recorded2.json');
  execFileSync(process.execPath, [SCRIPT, '--record', tsv, '--audit', copy, '--out', outJson], { stdio: 'ignore' });
  const a = JSON.parse(fs.readFileSync(outJson, 'utf8'));
  assert.equal(a.human_calibration.user_spot_check, 3, '只记 3 题');
  assert.equal(a.human_calibration.acceptance_status, 'pending_user', '不足 10 题 ⇒ pending_user');
  assert.equal(a.human_calibration.accepted, false, '不得采信');
});

// ── provenance 护栏（2026-09-14）：代理预核 ≠ 端用户独立核验，结构性不可冒充 ──
test('--by agent：代理预核写回但 effective=0 ⇒ 状态 pending_user_agent_surrogate，绝不成 accepted', () => {
  const src = fs.readFileSync(REAL_AUDIT, 'utf8');
  const before = JSON.parse(src);
  const copy = path.join(tmpDir, 'audit-agent.json');
  fs.writeFileSync(copy, src);
  const ids = (before.items || []).slice(0, 10).map((i) => i.id);
  const lines = ['# id\tverdict\tnote'];
  for (const id of ids) { const it = before.items.find((x) => x.id === id); lines.push(id + '\t' + (it.pass ? 'PASS' : 'REJECT') + '\tagent'); }
  const tsv = path.join(tmpDir, 'agent.tsv');
  fs.writeFileSync(tsv, lines.join('\n') + '\n');
  const outJson = path.join(tmpDir, 'recorded-agent.json');
  execFileSync(process.execPath, [SCRIPT, '--record', tsv, '--audit', copy, '--by', 'agent', '--out', outJson], { stdio: 'ignore' });
  const a = JSON.parse(fs.readFileSync(outJson, 'utf8'));
  const hc = a.human_calibration;
  assert.equal(hc.user_spot_check_by, 'agent', 'provenance=agent');
  assert.equal(hc.user_spot_check, 10, '写回 10 题（可追踪）');
  assert.equal(hc.user_spot_check_effective, 0, '有效题数=0（不满足必要条件）');
  assert.equal(hc.acceptance_status, 'pending_user_agent_surrogate', '状态恒待端用户');
  assert.equal(hc.accepted, false, '绝不 accepted');
  assert.ok(/代理预核/.test(hc.user_spot_check_note), 'note 显式披露代理预核');
  // 复核构成：end_user 必须为 0（防"独立性"口径污染）
  assert.equal(a.meta.review_composition.end_user, 0, 'end_user=0');
  assert.equal(a.meta.review_composition.agent_surrogate_spot_check, 10, '代理预核单独计数');
  // 对照：--by user（默认）同样 10 题 → effective=10（证明差异来自 provenance 本身）
  const outJson2 = path.join(tmpDir, 'recorded-user.json');
  execFileSync(process.execPath, [SCRIPT, '--record', tsv, '--audit', copy, '--by', 'user', '--out', outJson2], { stdio: 'ignore' });
  const b = JSON.parse(fs.readFileSync(outJson2, 'utf8'));
  assert.equal(b.human_calibration.user_spot_check_effective, 10, 'user 核验 ⇒ effective=10');
  assert.notEqual(b.human_calibration.acceptance_status, 'pending_user_agent_surrogate', 'user 路径不落 surrogate 状态');
});


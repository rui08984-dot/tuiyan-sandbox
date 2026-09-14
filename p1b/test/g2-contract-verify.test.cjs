'use strict';
/**
 * p1b/test/g2-contract-verify.test.cjs —— ② 契约表「源码派生」复现检查器回归（2026-09-14 新增）
 *
 * 锁两件事：
 *   ① --strict 退出码 0：**无 missing_fn、无 frozen_not_read**——即「冻结表要求的键，源码都在真实读取」，
 *      这是红队 #6a「禁观测键交集反推契约」的**可复现判据**（若谁把观测键塞进契约，本测试红）；
 *   ② 输出可解析且覆盖全部冻结契约（contracts 数一致）。
 * 铁律：只读（脚本本身只读源码与冻结表）；零网络；子进程运行。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'g2-contract-verify.cjs');
const FROZEN = path.join(ROOT, 'p1b', 'sim', 'out', 'g2-contract-frozen-r4.json');

test('契约表源码派生复现检查：--strict 退出码 0（0 幽灵 / 0 观测反推痕迹）', () => {
  let status = 0, out = '';
  try {
    out = execFileSync(process.execPath, [SCRIPT, '--strict'], { encoding: 'utf8' });
  } catch (e) {
    status = e.status;
    out = String(e.stdout || '');
  }
  assert.equal(status, 0, 'strict 必须通过（有 missing_fn/frozen_not_read 即 fail）\n' + out.split('\n').slice(-6).join('\n'));
  assert.match(out, /汇总: missing_fn=0/);
  assert.match(out, /frozen_not_read=0/);
});

test('契约表源码派生复现检查：覆盖全部冻结契约条目', () => {
  const frozen = JSON.parse(fs.readFileSync(FROZEN, 'utf8'));
  const nContracts = Object.keys(frozen.contracts || {}).length;
  const out = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  const checked = (out.match(/^\[(OK|DIFF|missing_fn)\]/gm) || []).length;
  assert.equal(checked, nContracts, '每条冻结契约都要有检查行');
  assert.ok(nContracts >= 30, '契约数（当前 34）');
});

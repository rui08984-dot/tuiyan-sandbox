'use strict';
/**
 * kind-table.test.cjs —— 任务 6 · 批次 3 / B1-2：kind 目录表生成器。
 * ① 临时库 + 临时契约：覆盖「有账本行的 kind / 仅契约 kind / 别名 kind / 下划线 helper」四类；
 *    断言取数源（账本 URL 主机）、必需参数、层分布、题数/已解、备注与生成器自述齐全且无 undefined/NaN。
 * ② 在库产物一致性：`docs/specs/kind-目录表.md` 与 `p1b/sim/out/kind-table-latest.json` 的 contract_sha256
 *    必须等于**当前**契约表文件的 sha256（防「契约换版、目录表没重生成」）。
 * 铁律：只读生产库（临时库自建）；零网络；生成器对生产库只读。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'kind-table.cjs');
const Database = require(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3'));

function tmp(name) { return path.join(os.tmpdir(), 'p1b-ktt-' + process.pid + '-' + Date.now() + '-' + name); }

test('生成器：临时库 + 临时契约 → 四类 kind 全覆盖，取数源/参数/层/计数/备注齐', () => {
  const dbPath = tmp('t.db');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE predictions (id INTEGER PRIMARY KEY, layer TEXT, outcome TEXT, evidence_json TEXT)');
  const ev = (kind, url) => JSON.stringify([{ resolve: Object.assign({ kind: kind }, url ? { url: url } : {}), baseRateNote: '占 40.0%（共 100 个值）' }]);
  db.prepare("INSERT INTO predictions (id,layer,outcome,evidence_json) VALUES (1,'L2','true',?)").run(ev('kind_with_url', 'https://api.example.org/v1/data?x=1'));
  db.prepare("INSERT INTO predictions (id,layer,outcome,evidence_json) VALUES (2,'L2',NULL,?)").run(ev('kind_with_url', 'https://api.example.org/v1/data?x=2'));
  db.prepare("INSERT INTO predictions (id,layer,outcome,evidence_json) VALUES (3,'L3','false',?)").run(ev('kind_no_url'));
  db.close();
  const contractPath = tmp('c.json');
  fs.writeFileSync(contractPath, JSON.stringify({
    meta: { basis: 'test' },
    contracts: {
      kind_with_url: { src: 'L10-20', required: ['date', 'threshold'], one_of: [['url', 'url_template']] },
      kind_no_url: { src: 'L30-40', required: ['lat', 'lon'], one_of: [] },
      kind_contract_only: { src: 'L50-60', required: ['issue'], one_of: [] },
      _sharedHelper: { src: 'L70-80', required: ['x'], one_of: [] },
    },
    aliases: { kind_with_url: '_sharedHelper' },
    date_derivations: { kind_no_url: { rule: 'x' } },
  }), 'utf8');
  const out = tmp('kind.md');
  const jsonOut = tmp('kind.json');
  const stdout = execFileSync(process.execPath, [SCRIPT, '--db', dbPath, '--contract', contractPath, '--out', out, '--json', jsonOut], { encoding: 'utf8' });
  assert.match(stdout, /kinds=3 rows_with_ledger=2/, '三个题源 kind 收录（含仅契约者）；下划线 helper 单列');
  const md = fs.readFileSync(out, 'utf8');
  assert.ok(!/undefined|NaN/.test(md), '无 undefined/NaN');
  assert.match(md, /\| `kind_with_url` \| api\.example\.org \|/, '取数源＝账本 URL 主机');
  assert.match(md, /date、threshold/, '必需参数列出');
  assert.match(md, /url 或 url_template/, 'one_of 组以「或」呈现（竖线会破坏 markdown 表格）');
  assert.match(md, /\| `kind_with_url` \|[^|]*\|[^|]*\|[^|]*\| L2:2 \|/, 'kind_with_url 层分布 L2:2');
  assert.match(md, /\| `kind_no_url` \|[^|]*\|[^|]*\|[^|]*\| L3:1 \|/, 'kind_no_url 层分布 L3:1');
  assert.match(md, /别名 → `_sharedHelper`/, '别名备注');
  assert.match(md, /有 date 派生规则/, 'date 派生备注');
  assert.match(md, /`kind_contract_only`.*\*\*无账本行\*\*/, '仅契约 kind 如实标注');
  assert.ok(md.split('| `kind_contract_only`')[0].indexOf('| `_sharedHelper` |') === -1, '下划线 helper 不进主表');
  assert.match(md, /共享 helper 契约[\s\S]*`_sharedHelper`/, 'helper 契约单列说明');
  const side = JSON.parse(fs.readFileSync(jsonOut, 'utf8'));
  assert.equal(side.meta.kinds_total, 3, 'helper 不进主表');
  assert.equal(side.meta.kinds_with_ledger_rows, 2);
  assert.equal(side.meta.ledger_rows_covered, 3);
  assert.equal(side.meta.ledger_resolved_covered, 2);
  const row = side.rows.filter((r) => r.kind === 'kind_with_url')[0];
  assert.deepEqual(row.required, ['date', 'threshold']);
  assert.equal(row.n_rows, 2);
  assert.equal(row.n_resolved, 1);
  try { fs.unlinkSync(dbPath); } catch (e) { /* ignore */ }
});

test('在库产物：目录表与其 JSON 的契约 sha256 == 当前契约表（防契约换版未重生成）', () => {
  const contractPath = path.join(ROOT, 'p1b', 'sim', 'out', 'g2-contract-frozen-r4.json');
  const want = crypto.createHash('sha256').update(fs.readFileSync(contractPath)).digest('hex');
  const side = JSON.parse(fs.readFileSync(path.join(ROOT, 'p1b', 'sim', 'out', 'kind-table-latest.json'), 'utf8'));
  assert.equal(side.meta.contract_sha256, want, 'JSON 侧车的契约 sha 与现契约一致');
  const md = fs.readFileSync(path.join(ROOT, 'docs', 'specs', 'kind-目录表.md'), 'utf8');
  assert.match(md, /自动生成，勿手改/, '目录表标注自动生成');
  assert.ok(side.rows.length >= 30, 'kind 行数（实际 ' + side.rows.length + '）');
  assert.ok(side.rows.every((r) => typeof r.engine === 'string' && r.engine.length > 0), '每行都有引擎列');
});

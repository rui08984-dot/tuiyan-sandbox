'use strict';
/*
 * kind-table.cjs —— `resolve.kind` 目录表生成器（任务 6 · 批次 3 / B1-2）
 *
 * 目的：让使用者**不读代码**就知道「系统认识哪些题」——一行一个 kind：
 *   取数源（账本实际 URL 主机；回退到 resolver 源码内联域名）/ 契约必需参数 / one_of 组 /
 *   账本层与题数 / 已解 / **引擎**（该 kind 落到哪一层、有无引擎） / 契约源码位。
 *
 * 来源（全部只读、可复现）：
 *   · 冻结契约表 `p1b/sim/out/g2-contract-frozen-r4.json`（required/one_of/src 行位；由 g2-contract-verify.cjs 保证与源码一致）
 *   · 账本 `p1a-terminal/data/p1a.db`（题数、已解、层分布、resolve.url 主机；readonly 打开）
 *   · resolver 源码 `p1b/scripts/corpus-resolve.cjs`（契约 src 行位内联域名，仅作回退）
 *
 * 用法：node p1b/scripts/kind-table.cjs [--db <f>] [--contract <f>] [--src <f>]
 *        [--out docs/specs/kind-目录表.md] [--json p1b/sim/out/kind-table-latest.json]
 * 只读：不写库、不改任何既有文件（输出件本身除外）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');
const Database = require(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3'));

function arg(n, d) {
  const eq = process.argv.find((a) => a.startsWith('--' + n + '='));
  if (eq) return eq.slice(n.length + 3);
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d;
}
const DB_PATH = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
const CONTRACT = arg('contract', path.join(ROOT, 'p1b', 'sim', 'out', 'g2-contract-frozen-r4.json'));
const SRC = arg('src', path.join(ROOT, 'p1b', 'scripts', 'corpus-resolve.cjs'));
const OUT = arg('out', path.join(ROOT, 'docs', 'specs', 'kind-目录表.md'));
const JSON_OUT = arg('json', path.join(ROOT, 'p1b', 'sim', 'out', 'kind-table-latest.json'));

const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const contractText = fs.readFileSync(CONTRACT, 'utf8');
const contract = JSON.parse(contractText);
const srcText = fs.readFileSync(SRC, 'utf8');
const srcLines = srcText.split(/\r?\n/);
const { matchRule, L5_CERTIFIED_RULES } = require(path.join(ROOT, 'p1b', 'src', 'engines', 'l5_sources'));

/** 契约 src 行位（如 "L18-25"）→ 该段源码文本。 */
function srcSegment(ref) {
  const m = /^L(\d+)(?:-(\d+))?$/.exec(String(ref || ''));
  if (!m) return '';
  const a = Number(m[1]), b = Number(m[2] || m[1]);
  return srcLines.slice(a - 1, b).join('\n');
}
/** 从文本里抓域名（首个 http(s) 字面量；找不到 ⇒ null）。 */
function hostOf(text) {
  const m = /https?:\/\/([A-Za-z0-9.\-]+)/.exec(String(text || ''));
  return m ? m[1] : null;
}
const hostOfUrl = (u) => (u ? hostOf(u) : null);

/** 抽取「首参为 r」的函数体（简化版，同 g2-contract-verify.cjs 口径：花括号配对、跳字符串/注释）→ {name:{body,line}}。 */
function extractBodies(text) {
  const out = {};
  const re = /(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    if (!/^\s*r\s*(,|$)/.test(m[2])) continue;
    const bodyStart = re.lastIndex - 1;
    let depth = 0, i = bodyStart, inStr = null, inLine = false, inBlock = false;
    for (; i < text.length; i++) {
      const ch = text[i], nx = text[i + 1];
      if (inLine) { if (ch === '\n') inLine = false; continue; }
      if (inBlock) { if (ch === '*' && nx === '/') { inBlock = false; i++; } continue; }
      if (inStr) { if (ch === '\\') { i++; continue; } if (ch === inStr) inStr = null; continue; }
      if (ch === '/' && nx === '/') { inLine = true; i++; continue; }
      if (ch === '/' && nx === '*') { inBlock = true; i++; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) break; }
    }
    const body = text.slice(bodyStart, i + 1);
    const line = text.slice(0, bodyStart).split('\n').length;
    out[name] = { name: name, body: body, line: line, endLine: line + body.split('\n').length - 1 };
  }
  return out;
}
const bodies = extractBodies(srcText);

/** 域名（含一层间接：本体 → 别名目标 → 体内提到的函数）。 */
function hostsOfKind(kind) {
  const seen = [];
  const chain = [kind];
  if (aliases[kind]) chain.push(aliases[kind]);
  for (const nm of chain) if (bodies[nm]) {
    const h = hostOf(bodies[nm].body);
    if (h && seen.indexOf(h) === -1) seen.push(h);
  }
  if (!seen.length) {
    const refs = new Set();
    for (const nm of chain) if (bodies[nm]) {
      const re = /([A-Za-z_$][\w$]*)\s*\(/g; let mm;
      while ((mm = re.exec(bodies[nm].body)) !== null) refs.add(mm[1]);
    }
    for (const nm of refs) if (bodies[nm]) { const h = hostOf(bodies[nm].body); if (h && seen.indexOf(h) === -1) seen.push(h); }
  }
  return seen;
}
/** 现源码位（抽取器给的当前行号；找不到 ⇒ null）——契约表 src 行位是冻结时的旧位，故以现位为准并标注。 */
function srcRefOf(kind) {
  const b = bodies[kind] || (aliases[kind] ? bodies[aliases[kind]] : null);
  return b ? 'L' + b.line + '-' + b.endLine + (aliases[kind] ? '（→' + aliases[kind] + '）' : '') : null;
}

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
const ledgerKinds = db.prepare(
  "SELECT DISTINCT json_extract(e.value,'$.resolve.kind') AS k FROM predictions p, json_each(p.evidence_json) e "
  + "WHERE json_extract(e.value,'$.resolve.kind') IS NOT NULL ORDER BY 1").all().map((r) => r.k);
const statStmt = db.prepare(
  'SELECT COUNT(*) n, SUM(CASE WHEN p.outcome IN (\'true\',\'false\') THEN 1 ELSE 0 END) resolved '
  + "FROM predictions p, json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.kind')=?");
const layerStmt = db.prepare(
  "SELECT p.layer, COUNT(*) n FROM predictions p, json_each(p.evidence_json) e "
  + "WHERE json_extract(e.value,'$.resolve.kind')=? GROUP BY p.layer ORDER BY n DESC");
const sampleStmt = db.prepare(
  "SELECT json_extract(e.value,'$.resolve') rj, json_extract(e.value,'$.resolve.url') u, "
  + "json_extract(e.value,'$.resolve.url_template') ut "
  + "FROM predictions p, json_each(p.evidence_json) e "
  + "WHERE json_extract(e.value,'$.resolve.kind')=? AND json_extract(e.value,'$.resolve') IS NOT NULL LIMIT 1");
const hostsStmt = db.prepare(
  "SELECT DISTINCT json_extract(e.value,'$.resolve.url') u FROM predictions p, json_each(p.evidence_json) e "
  + "WHERE json_extract(e.value,'$.resolve.kind')=? AND json_extract(e.value,'$.resolve.url') IS NOT NULL LIMIT 40");
const hostsTmplStmt = db.prepare(
  "SELECT DISTINCT json_extract(e.value,'$.resolve.url_template') u FROM predictions p, json_each(p.evidence_json) e "
  + "WHERE json_extract(e.value,'$.resolve.kind')=? AND json_extract(e.value,'$.resolve.url_template') IS NOT NULL LIMIT 40");

/** 引擎列：该 kind 落到哪些层、引擎是否覆盖（读侧事实，不宣称能力）。 */
function engineOf(kind, layers, sampleResolve) {
  const out = [];
  if (layers.some((l) => l.layer === 'L2')) out.push('L2 基率引擎（Wilson，n≥30 且注记可解析）');
  if (layers.some((l) => l.layer === 'L3')) out.push('L3 基率+ACI（同上准入）');
  if (layers.some((l) => l.layer === 'L5')) {
    const nRules = L5_CERTIFIED_RULES.filter((r) => r.kind === kind).length;
    const m = matchRule(sampleResolve);
    out.push(m.ok ? 'L5 认证源注册表（' + nRules + ' 变体；样本命中：' + m.rule.name + '）'
      : 'L5 未注册/无匹配 ⇒ 如实 unsupported（' + m.reason + '）');
  }
  if (layers.some((l) => l.layer === 'L1')) out.push('L1 程序复算（6 规则族）');
  if (layers.some((l) => l.layer === 'L6')) out.push('L6 判词聚合');
  return out.length ? out.join('＋') : '—（无账本行 / 无引擎位）';
}

const contracts = contract.contracts || {};
const aliases = contract.aliases || {};
const kinds = [];
for (const k of Object.keys(contracts)) {
  if (k.charAt(0) === '_') continue;              // 下划线 = 共享 helper 契约（非题源 kind），单列说明
  kinds.push(k);
}
for (const k of ledgerKinds) if (kinds.indexOf(k) === -1) kinds.push(k);
for (const k of Object.keys(aliases)) if (kinds.indexOf(k) === -1) kinds.push(k);

const rows = [];
for (const kind of kinds) {
  const c = contracts[kind] || (aliases[kind] ? contracts[aliases[kind]] : null) || null;
  const helper = aliases[kind] || (contracts[kind] ? null : null);
  const st = statStmt.get(kind);
  const layers = layerStmt.all(kind);
  const sample = sampleStmt.get(kind);
  let sampleResolve = null;
  try { sampleResolve = sample && sample.rj ? JSON.parse(sample.rj) : null; } catch (e) { sampleResolve = null; }
  const hosts = [];
  for (const r of hostsStmt.all(kind)) { const h = hostOfUrl(r.u); if (h && hosts.indexOf(h) === -1) hosts.push(h); }
  for (const r of hostsTmplStmt.all(kind)) { const h = hostOfUrl(r.u); if (h && hosts.indexOf(h) === -1) hosts.push(h); }
  if (!hosts.length) { const hs = hostsOfKind(kind); for (const h of hs) hosts.push(h); }
  const req = c ? (c.required || []).slice() : [];
  const oneOf = c ? (c.one_of || []).map((g) => g.join(' 或 ')) : []; // 若用 '|' 会破坏 markdown 表格单元格
  rows.push({
    kind: kind,
    helper: helper || (contracts[kind] ? null : null),
    contract_src: c ? c.src : null,
    src_now: srcRefOf(kind),
    required: req,
    one_of: oneOf,
    hosts: hosts.slice(0, 3),
    n_rows: st ? st.n : 0,
    n_resolved: st ? (st.resolved || 0) : 0,
    layers: layers.map((l) => (l.layer || 'null') + ':' + l.n),
    engine: engineOf(kind, layers, sampleResolve),
    has_date_derivation: !!(contract.date_derivations && contract.date_derivations[kind]),
    in_ledger: ledgerKinds.indexOf(kind) !== -1,
  });
}
db.close();
rows.sort((a, b) => (b.n_rows - a.n_rows) || (a.kind < b.kind ? -1 : 1));

const totalRows = rows.reduce((s, r) => s + r.n_rows, 0);
const totalResolved = rows.reduce((s, r) => s + r.n_resolved, 0);
const helpers = Object.keys(contracts).filter((k) => k.charAt(0) === '_');
const withRows = rows.filter((r) => r.n_rows > 0).length;
const gen = { generated_at: new Date().toISOString(), db: path.relative(ROOT, DB_PATH).replace(/\\/g, '/'),
  contract: path.relative(ROOT, CONTRACT).replace(/\\/g, '/'), contract_sha256: sha256(CONTRACT),
  src: path.relative(ROOT, SRC).replace(/\\/g, '/'), src_sha256: sha256(SRC),
  kinds_total: rows.length, kinds_with_ledger_rows: withRows, kinds_contract_only: rows.length - withRows,
  ledger_rows_covered: totalRows, ledger_resolved_covered: totalResolved, helper_contracts: helpers };

const md = [];
md.push('# kind 目录表（系统认识哪些题）');
md.push('');
md.push('> **自动生成，勿手改**——`node p1b/scripts/kind-table.cjs`（任务 6 批次 3 / B1-2）。');
md.push('> 来源：冻结契约表 `' + gen.contract + '`（sha256 `' + gen.contract_sha256.slice(0, 12) + '…`，'
  + '由 `g2-contract-verify.cjs` 保证与源码一致）＋ 账本 `' + gen.db + '`（只读）＋ resolver 源码 `' + gen.src + '`。');
md.push('> 生成时点：' + gen.generated_at + '｜kind 共 **' + gen.kinds_total + '** 个（有账本行 ' + gen.kinds_with_ledger_rows
  + '／仅契约 ' + gen.kinds_contract_only + '）｜覆盖账本题 **' + gen.ledger_rows_covered + '**（已解 ' + gen.ledger_resolved_covered + '）。');
md.push('');
md.push('**怎么读这一页**：');
md.push('- **取数源**＝账本实际出现的 URL 主机（回退：resolver 源码内联域名）。');
md.push('- **必需参数 / 组**＝契约（`g2-contract-frozen-r4.json`）对该 kind 的 resolve 参数要求；组内为「至少一个」。');
md.push('- **真值锚**＝该 kind 的 `resolve.kind` 指向本表 resolver，结算按**同源**重取 → 真值（与必需参数同一契约；日期型 kind 另有 `date_derivations` 派生规则）。');
md.push('- **引擎**＝该 kind 在账本里落到的层与**读侧**引擎（引擎缺陷如实标注「未注册/需注记可解析」，不宣称能力）。');
md.push('- **层:题数**＝账本层分布；**已解**＝`outcome ∈ {true,false}`。');
md.push('- **源码位**＝resolver 在 `corpus-resolve.cjs` 的**当前**行位（契约表里的 `src` 是冻结时的旧行位，文件增长后会漂移，故只作对照）。');
md.push('');
md.push('| kind | 取数源 | 必需参数 | 组（至少一） | 层:题数 | 引擎 | 题数 | 已解 | 源码位（现/契约冻结） | 备注 |');
md.push('|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const notes = [];
  if (r.helper) notes.push('别名 → `' + r.helper + '`（共享实现）');
  if (r.has_date_derivation) notes.push('有 date 派生规则');
  if (!r.in_ledger) notes.push('**无账本行**（在库契约/实现，未出题）');
  md.push('| `' + r.kind + '` | ' + (r.hosts.join('、') || '—') + ' | ' + (r.required.join('、') || '—')
    + ' | ' + (r.one_of.join('；') || '—') + ' | ' + (r.layers.join('、') || '—') + ' | ' + r.engine
    + ' | ' + r.n_rows + ' | ' + r.n_resolved + ' | ' + (r.src_now ? '`' + r.src_now + '`' : (r.contract_src ? '契约 `' + r.contract_src + '`' : '—')) + ' | ' + (notes.join('；') || '') + ' |');
}
md.push('');
md.push('**共享 helper 契约**（下划线开头，非独立题源 kind，被上面若干 kind 复用）：'
  + (helpers.length ? helpers.map((h) => '`' + h + '`（' + (contracts[h].src || '—') + '）').join('、') : '—'));
md.push('');
md.push('（本表由脚本生成 · 与 `docs/specs/参数表-人话版-v1.md`、`p1b/scripts/board.cjs` 同属「使用者友好面」 · 一切判据以契约表与 design 为准）');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, md.join('\n') + '\n', 'utf8');
if (JSON_OUT) {
  fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
  fs.writeFileSync(JSON_OUT, JSON.stringify({ meta: gen, rows: rows }, null, 1), 'utf8');
}
console.log('[kind-table] kinds=' + rows.length + ' rows_with_ledger=' + withRows + ' ledger_covered=' + totalRows
  + ' resolved=' + totalResolved + ' -> ' + path.relative(ROOT, OUT) + (JSON_OUT ? ' (+json)' : ''));

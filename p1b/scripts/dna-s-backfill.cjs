#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/dna-s-backfill.cjs —— E1 · S 维标签回填（旁路表，INSERT-only）（2026-09-16）
 *
 * 依据：`12-PREREG-E1-DNA加列S维-v1.md` §1（规则，已冻结 sha 1875382d…）＋ §4（旁路表结构，冻结）。
 * 接口照 §4 原文：`node p1b/scripts/dna-s-backfill.cjs --db <路径> [--confirm]`
 *   · 无 `--confirm` = **dry-run 默认**：只打印将写入行数 + 前 5 行样本，零写入；
 *   · `--db` 必填并校验文件存在；写入口径**仅限** dna_s_labels 表（+ v_dna_s 视图），predictions/verdicts 零触碰。
 * 规则实现＝**单一真源复用** `p1b/scripts/dna-s-dryrun.cjs`（wilson/newcombe/labelOf 导出）——禁双份漂移。
 * 窗口路由（--route）：
 *   · ledger（默认，当前可用）：账本结局序列回退档（同 dry-run；look-ahead 风险如实标注）；
 *   · source（E1 主口径）：源数据侧快照重建 —— **尚未实现**（需 15–25 个系列各自的取数适配器＋快照落盘；
 *     本脚本遇到 --route source 时**硬失败**，不冒充主口径读数）。
 * 写库纪律（照 §4）：①写前 netstat 8787 记档 ②写前在线快照（better-sqlite3 backup → .scratch/backup/）
 *   ③单事务 INSERT-only ④写后复核行数/无 UPDATE（只 INSERT 新行）。
 * 用法：
 *   node p1b/scripts/dna-s-backfill.cjs --db <path>                 # dry-run（零写）
 *   node p1b/scripts/dna-s-backfill.cjs --db <path> --confirm       # 实写（副本演练先于生产）
 *   node p1b/scripts/dna-s-backfill.cjs --db <path> --confirm --no-snapshot  # 仅供副本演练（生产禁用）
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const DB_ARG = arg('db', null);
const CONFIRM = process.argv.indexOf('--confirm') !== -1;
const NO_SNAPSHOT = process.argv.indexOf('--no-snapshot') !== -1;
const ROUTE = arg('route', 'ledger');
const OUT_DIR = arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out'));
const RULE_VERSION = 'e1-v1';
const RULE_SHA = '1875382deddd6a5babe2466c8f48281e694ed537cbe4289a40989fd742d28000';

if (!DB_ARG) { console.error('用法: node p1b/scripts/dna-s-backfill.cjs --db <path> [--confirm] [--route ledger|source]'); process.exit(2); }
const DB_PATH = path.resolve(DB_ARG);
if (!fs.existsSync(DB_PATH)) { console.error('--db 指向的文件不存在: ' + DB_PATH); process.exit(2); }
if (ROUTE !== 'ledger') { console.error('ROUTE_UNSUPPORTED: --route source（E1 主口径·源侧快照重建）尚未实现——需 15–25 个系列取数适配器与快照落盘；本脚本拒绝冒充主口径读数。'); process.exit(3); }

const DRY = require(path.join(ROOT, 'p1b', 'scripts', 'dna-s-dryrun.cjs'));

/** 计算标签（单一真源规则；与 dry-run 同口径） */
function computeLabels(readOnly) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB_PATH, { readOnly: readOnly });
  const all = (s) => db.prepare(s).all();
  const domMod = require(path.join(ROOT, 'p1b', 'src', 'evidence', 'domain'));
  const rows = all('SELECT p.id, p.layer, p.outcome, p.matures_at, p.created_at, p.evidence_json, g.game_type AS gtype, '
    + "(SELECT json_extract(e.value,'$.cutoff') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.cutoff') IS NOT NULL LIMIT 1) AS ev_cutoff "
    + 'FROM predictions p LEFT JOIN games g ON g.id = p.game_id '
    + "WHERE p.layer IN ('L1','L2','L3','L5','L6') ORDER BY p.id");
  const parseEv = (j) => { try { return JSON.parse(j || '[]'); } catch (e) { return []; } };
  const kindOf = (ev) => String((((ev[0] || {}).resolve) || {}).kind || '');
  const tailOf = (r) => String(r.ev_cutoff || r.matures_at || r.created_at || '').slice(0, 10);
  const eventOf = (r) => String(r.matures_at || r.ev_cutoff || r.created_at || '').slice(0, 10);
  const series = {};
  for (const r of rows) {
    if (r.layer !== 'L2' && r.layer !== 'L3') continue;
    const k = kindOf(parseEv(r.evidence_json)); if (!k) continue;
    (series[k] = series[k] || []).push({ id: r.id, outcome: r.outcome, event: eventOf(r) });
  }
  const out = [];
  for (const r of rows) {
    const ev = parseEv(r.evidence_json);
    let dd = { domain: '(unknown)' };
    try { dd = domMod.deriveDomain({ resolve: (ev[0] || {}).resolve || null, evKind: (ev[0] || {}).kind, gameType: r.gtype }); } catch (e) { /* ignore */ }
    if (r.layer === 'L1') continue; // §1：不赋档，整层剔除（不落表）
    if (r.layer === 'L5' || r.layer === 'L6') {
      out.push({ id: r.id, series_key: r.layer === 'L5' ? '(认证源)' : '(对局)', period_key: tailOf(r).slice(0, 7), dna_s: '先验:恒平稳',
        basis: { 窗口来源: '先验档（12 §1）', domain: dd.domain } });
      continue;
    }
    const k = kindOf(ev);
    const seq = (series[k] || []).filter((x) => x.id !== r.id && x.outcome !== null && x.event && x.event <= tailOf(r))
      .sort((a, b) => (a.event < b.event ? -1 : a.event > b.event ? 1 : a.id - b.id));
    const n = seq.length;
    if (n < 20) { out.push({ id: r.id, series_key: k, period_key: tailOf(r).slice(0, 7), dna_s: '不可判', basis: { 窗口来源: '账本结局序列（回退档）', n: n, reason: 'series_n<20', domain: dd.domain } }); continue; }
    const half = Math.floor(n / 2);
    const first = seq.slice(0, half), second = seq.slice(n - half);
    const k1 = first.filter((x) => String(x.outcome) === 'true').length, n1 = first.length;
    const k2 = second.filter((x) => String(x.outcome) === 'true').length, n2 = second.length;
    const res = DRY.labelOf(k1, n1, k2, n2);
    out.push({ id: r.id, series_key: k, period_key: tailOf(r).slice(0, 7), dna_s: res.label,
      basis: { 窗口来源: '账本结局序列（回退档）', k1: k1, n1: n1, k2: k2, n2: n2, diff: res.ci ? res.ci.d : null, ci_lb: res.ci ? res.ci.lb : null, ci_ub: res.ci ? res.ci.ub : null, domain: dd.domain } });
  }
  db.close();
  return out;
}

function sha256File(p) { return require('node:crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }

(async () => {
  console.log('=== E1 · S 维标签回填（' + (CONFIRM ? 'CONFIRM 实写' : 'DRY-RUN 零写') + '）===');
  console.log('db: ' + DB_PATH + ' ｜ route: ' + ROUTE + ' ｜ rule_sha: ' + RULE_SHA.slice(0, 16) + '…');
  const labels = computeLabels(true);   // 读侧计算（只读连接）
  const dist = {}; for (const l of labels) dist[l.dna_s] = (dist[l.dna_s] || 0) + 1;
  console.log('将写入行数: ' + labels.length + '（L1 剔除由 §1 规定，不落表）｜ 分布 ' + JSON.stringify(dist));
  console.log('前 5 行样本:');
  for (const l of labels.slice(0, 5)) console.log('  ' + JSON.stringify(l));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const planFile = path.join(OUT_DIR, 'dna-s-backfill-plan-' + today + '.json');
  fs.writeFileSync(planFile, JSON.stringify({ route: ROUTE, rule_sha: RULE_SHA, rule_version: RULE_VERSION, rows: labels.length, dist: dist, sample: labels.slice(0, 5), generated_at: new Date().toISOString() }, null, 1), 'utf8');
  console.log('计划件 -> ' + planFile);

  if (!CONFIRM) { console.log('（dry-run：零写入。实写须 --confirm；生产实写前先副本演练）'); return; }

  // 写前纪律：netstat 记档
  try { const ns = execFileSync('netstat', ['-ano'], { encoding: 'utf8' }); const hit = ns.split('\n').filter((l) => l.indexOf(':8787') !== -1); console.log('写前 netstat 8787: ' + (hit.length ? hit[0].trim() : '未监听')); } catch (e) { console.log('写前 netstat: 不可用（跳过，如实记录）'); }

  const B = require(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3'));
  // 写前在线快照（生产写；副本演练可用 --no-snapshot）
  if (!NO_SNAPSHOT) {
    const bkDir = path.join(ROOT, '.scratch', 'backup');
    fs.mkdirSync(bkDir, { recursive: true });
    const bk = path.join(bkDir, 'p1a-pre-dnas-' + new Date().toISOString().replace(/[:.]/g, '-') + '.db');
    const src = new B(DB_PATH, { readonly: true });
    await src.backup(bk); src.close();
    console.log('写前快照 -> ' + bk + '（sha ' + sha256File(bk).slice(0, 16) + '…）');
  } else { console.log('写前快照: 跳过（--no-snapshot；**生产禁用**）'); }

  const db = new B(DB_PATH);
  const tx = db.transaction(() => {
    db.prepare('CREATE TABLE IF NOT EXISTS dna_s_labels (prediction_id INTEGER PRIMARY KEY, series_key TEXT, period_key TEXT, dna_s TEXT, basis_json TEXT, rule_sha TEXT, rule_version TEXT, created_at TEXT)').run();
    db.prepare('CREATE VIEW IF NOT EXISTS v_dna_s AS SELECT prediction_id, series_key, period_key, dna_s, rule_sha, rule_version FROM dna_s_labels').run();
    const ins = db.prepare('INSERT OR REPLACE INTO dna_s_labels (prediction_id, series_key, period_key, dna_s, basis_json, rule_sha, rule_version, created_at) VALUES (?,?,?,?,?,?,?,?)');
    const now = new Date().toISOString();
    for (const l of labels) ins.run(l.id, l.series_key, l.period_key, l.dna_s, JSON.stringify(l.basis), RULE_SHA, RULE_VERSION, now);
  });
  tx();
  const cnt = db.prepare('SELECT COUNT(*) c FROM dna_s_labels').get().c;
  const byLabel = db.prepare('SELECT dna_s, COUNT(*) c FROM dna_s_labels GROUP BY dna_s').all();
  db.close();
  console.log('写入完成：dna_s_labels 行数 ' + cnt + ' ｜ 分布 ' + JSON.stringify(byLabel));
  console.log('（INSERT-only；predictions/verdicts 零触碰；写后请复跑 g2-report 读数零变化验收）');
})();

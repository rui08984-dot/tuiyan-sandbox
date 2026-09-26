'use strict';
/**
 * .scratch/p38/fingerprint.cjs —— 结算 safe-mutation 第①/⑤步：六表 SQL 级指纹（2026-09-27）
 *
 * 口径照 09-22 批（.scratch/p37/fingerprint-before.json）：六张表逐行读出 → 规范 JSON → sha256 → 取前 16 hex。
 * 只读开库（readOnly + immutable 不加，因需读 -wal）；**零写**。
 * 用法：node .scratch/p38/fingerprint.cjs <db> <out.json>
 */
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const TABLES = ['predictions', 'verdicts', 'games', 'events', 'truth_vault', 'intake_questions'];

function fingerprint(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const out = {};
  try {
    for (const t of TABLES) {
      const rows = db.prepare('SELECT * FROM ' + t).all();
      const h = crypto.createHash('sha256');
      for (const r of rows) h.update(JSON.stringify(r));
      out[t] = { rows: rows.length, sha16: h.digest('hex').slice(0, 16) };
    }
    const res = db.prepare('SELECT COUNT(*) c FROM predictions WHERE resolved_at IS NOT NULL').get();
    out.__meta = {
      captured_at: new Date().toISOString(),
      resolved: Number(res.c),
      total: out.predictions.rows,
    };
  } finally { db.close(); }
  return out;
}

const [, , dbArg, outArg] = process.argv;
if (!dbArg || !outArg) { console.error('用法：node fingerprint.cjs <db> <out.json>'); process.exit(2); }
const fp = fingerprint(path.resolve(dbArg));
fs.writeFileSync(path.resolve(outArg), JSON.stringify(fp, null, 1), 'utf8');
console.log(JSON.stringify(fp, null, 1));

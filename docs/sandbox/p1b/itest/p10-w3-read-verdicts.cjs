'use strict';
/**
 * p10-w3-read-verdicts.cjs —— W3 集成收口证据脚本：直查临时库 verdicts 表全行。
 * 走 p1b/src/deps 链（better-sqlite3 在 p1a 依赖树，node -e 从 p1b 解析不到——坑已验）。
 * 用法：node p10-w3-read-verdicts.cjs <dbPath>
 * 只读语义：init 仅 additive 幂等建表（表已存在 no-op），SELECT 后立即 close。
 */
const { db } = require('../../../../p1b/src/deps');

const dbPath = process.argv[2];
if (!dbPath) { console.error('用法: node p10-w3-read-verdicts.cjs <dbPath>'); process.exit(1); }
db.init(dbPath);
const conn = db.getConnection();
const rows = conn.prepare('SELECT prediction_id, prompt_variant, temperature, implied_prob, verdict_text FROM verdicts ORDER BY id').all();
console.log('verdicts rows=' + rows.length);
const nonNull = rows.filter(function (r) { return r.implied_prob !== null && r.implied_prob !== undefined; }).length;
console.log('implied_prob non-NULL rows=' + nonNull);
console.log(JSON.stringify(rows, null, 1));
db.closeCurrent();

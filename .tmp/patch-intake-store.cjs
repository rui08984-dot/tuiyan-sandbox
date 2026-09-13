'use strict';
// .tmp/patch-intake-store.cjs —— intakeStore.js additive 列补丁
// 纪律：读原字节（CRLF 保形）→ 精确替换（每处恰 1 次）→ 回写 → node --check → 复核 CRLF 计数与 sha256
const fs = require('fs');
const crypto = require('crypto');
const P = 'p1b/src/db/intakeStore.js';
const raw = fs.readFileSync(P, 'utf8');
const sha0 = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
const crlf0 = (raw.match(/\r\n/g) || []).length;
const bare0 = (raw.match(/(?<!\r)\n/g) || []).length;
let s = raw;
function rep(needle, repl, tag) {
  const n = s.split(needle).length - 1;
  if (n !== 1) throw new Error('[' + tag + '] 命中 ' + n + ' 次（要求恰 1 次）');
  s = s.replace(needle, repl);
}
// R1：建表定义加三列（新库随建表即有）
rep("  '  engine TEXT,',\r\n",
  "  '  engine TEXT,',\r\n  '  prob REAL CHECK(prob IS NULL OR (prob >= 0 AND prob <= 1)),',\r\n  '  prob_ci TEXT,',\r\n  '  engine_note TEXT,',\r\n", 'R1');
// R2：additive 迁移列定义表
rep('const SCHEMA_INTAKE_REJECTS = [',
  "// 阶段 4（2026-09-13）additive 迁移：L2/L5 引擎产出列（旧库 ALTER；新库随建表即有）\r\n"
  + "const INTAKE_QUESTION_COLUMNS = [\r\n"
  + "  'prob REAL CHECK(prob IS NULL OR (prob >= 0 AND prob <= 1))',\r\n"
  + "  'prob_ci TEXT',\r\n"
  + "  'engine_note TEXT',\r\n"
  + "];\r\n\r\nconst SCHEMA_INTAKE_REJECTS = [", 'R2');
// R3：ensure 内执行 additive 迁移（PRAGMA 检测缺列 → 事务内 ALTER）
rep('  conn.exec(SCHEMA_INTAKE_QUESTIONS);\r\n',
  "  conn.exec(SCHEMA_INTAKE_QUESTIONS);\r\n"
  + "  const qcols = new Set(conn.prepare('PRAGMA table_info(intake_questions)').all().map((c) => c.name));\r\n"
  + "  const qMissing = INTAKE_QUESTION_COLUMNS.filter((def) => !qcols.has(def.split(' ')[0]));\r\n"
  + "  if (qMissing.length) {\r\n"
  + "    const migrate = conn.transaction(() => {\r\n"
  + "      for (const def of qMissing) conn.exec('ALTER TABLE intake_questions ADD COLUMN ' + def);\r\n"
  + "    });\r\n"
  + "    migrate();\r\n"
  + "  }\r\n", 'R3');
// R4：读模型加三列
rep('    engine: row.engine === undefined ? null : row.engine,\r\n',
  "    engine: row.engine === undefined ? null : row.engine,\r\n"
  + "    prob: row.prob === undefined ? null : row.prob,\r\n"
  + "    prob_ci: (function () {\r\n"
  + "      if (row.prob_ci === undefined || row.prob_ci === null || row.prob_ci === '') return null;\r\n"
  + "      try { return JSON.parse(row.prob_ci); } catch (e) { return row.prob_ci; }\r\n"
  + "    })(),\r\n"
  + "    engine_note: row.engine_note === undefined ? null : row.engine_note,\r\n", 'R4');
// R5：INSERT 加三列（既有列位序不变，新列追加在后）
rep("  const info = conn.prepare('INSERT INTO intake_questions (statement, resolve_spec, layer, secondary_layer, gate, checklist_hash, engine, evidence, intake_reject_id)'\r\n"
  + "    + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')\r\n"
  + "    .run(p.statement.trim(), toJsonText(p.resolveSpec), p.layer === undefined ? null : p.layer,\r\n"
  + "      p.secondaryLayer === undefined ? null : p.secondaryLayer, p.gate === undefined ? null : p.gate,\r\n"
  + "      p.checklistHash === undefined ? null : p.checklistHash, p.engine === undefined ? null : p.engine,\r\n"
  + "      toJsonText(p.evidence === undefined ? null : p.evidence), p.intakeRejectId === undefined ? null : p.intakeRejectId);\r\n",
  "  const info = conn.prepare('INSERT INTO intake_questions (statement, resolve_spec, layer, secondary_layer, gate, checklist_hash, engine, evidence, intake_reject_id, prob, prob_ci, engine_note)'\r\n"
  + "    + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')\r\n"
  + "    .run(p.statement.trim(), toJsonText(p.resolveSpec), p.layer === undefined ? null : p.layer,\r\n"
  + "      p.secondaryLayer === undefined ? null : p.secondaryLayer, p.gate === undefined ? null : p.gate,\r\n"
  + "      p.checklistHash === undefined ? null : p.checklistHash, p.engine === undefined ? null : p.engine,\r\n"
  + "      toJsonText(p.evidence === undefined ? null : p.evidence), p.intakeRejectId === undefined ? null : p.intakeRejectId,\r\n"
  + "      p.prob === undefined ? null : p.prob, toJsonText(p.probCi === undefined ? null : p.probCi),\r\n"
  + "      p.engineNote === undefined ? null : p.engineNote);\r\n", 'R5');
// R6：入参护栏 —— prob 越界即抛（概率不得绕过 [0,1]）
rep("    throw new Error('gate 必须是 ' + GATES.join('|') + ' 或 null');\r\n  }\r\n",
  "    throw new Error('gate 必须是 ' + GATES.join('|') + ' 或 null');\r\n  }\r\n"
  + "  if (p.prob !== undefined && p.prob !== null && (typeof p.prob !== 'number' || !(p.prob >= 0 && p.prob <= 1))) {\r\n"
  + "    throw new Error('prob 必须是 [0,1] 数字或 null，收到: ' + JSON.stringify(p.prob));\r\n"
  + "  }\r\n", 'R6');
// R7：导出迁移列定义表
rep('  SCHEMA_INTAKE_QUESTIONS, SCHEMA_PREDICTIONS_R4,',
  '  INTAKE_QUESTION_COLUMNS, SCHEMA_INTAKE_QUESTIONS, SCHEMA_PREDICTIONS_R4,', 'R7');

const crlf1 = (s.match(/\r\n/g) || []).length;
const bare1 = (s.match(/(?<!\r)\n/g) || []).length;
fs.writeFileSync(P, s, 'utf8');
const sha1 = crypto.createHash('sha256').update(fs.readFileSync(P, 'utf8'), 'utf8').digest('hex');
console.log(JSON.stringify({ sha_after: sha1, bytes_before: raw.length, bytes_after: s.length,
  crlf_before: crlf0, crlf_after: crlf1, bare_lf_before: bare0, bare_lf_after: bare1 }, null, 1));


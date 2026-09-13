'use strict';
/** 验证**已发布**的守卫模块（require 真身，不是副本）：RO 必须抛、RW 必须过。 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const Database = require(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3'));
const { assertWritable } = require(path.join(ROOT, 'p1b', 'scripts', '_sqlite-guard.cjs'));
const DB = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const out = {};
const ro = new Database(DB, { readonly: true, fileMustExist: true });
try { assertWritable(ro, 'unit-ro'); out.ro = { threw: false }; }
catch (e) { out.ro = { threw: true, message: String(e.message).slice(0, 90) }; }
ro.close();
const rw = new Database(path.join(ROOT, '.scratch', 'merged-migration', 'guard-probe.db'));
try { assertWritable(rw, 'unit-rw'); out.rw = { threw: false, returned_conn: rw.readonly === false }; }
catch (e) { out.rw = { threw: true, message: String(e.message) }; }
rw.close();
try { assertWritable(null, 'unit-null'); out.nullConn = { threw: false }; }
catch (e) { out.nullConn = { threw: true, message: String(e.message).slice(0, 60) }; }
out.PASS = out.ro.threw === true && out.rw.threw === false && out.rw.returned_conn === true && out.nullConn.threw === true;
console.log(JSON.stringify(out, null, 1));
if (!out.PASS) process.exit(1);

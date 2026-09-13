'use strict';
/** 探针：better-sqlite3 是否暴露 db.readonly（用于写路径守卫）。零写。 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const Database = require(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3'));
const DB = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const ro = new Database(DB, { readonly: true, fileMustExist: true });
const rw = new Database(path.join(ROOT, '.scratch', 'merged-migration', 'probe-rw.db'));
const out = { ro_readonly: ro.readonly, rw_readonly: rw.readonly, ro_inMemory: new Database(':memory:').readonly };
// 反证：只读主连接 ATTACH 建新文件 = 上次那个 SQLITE_CANTOPEN 的复现
try { ro.exec("ATTACH DATABASE '" + path.join(ROOT, '.scratch', 'merged-migration', 'probe-attach.db').replace(/'/g, "''") + "' AS pub"); out.ro_attach_create = { ok: true }; }
catch (e) { out.ro_attach_create = { ok: false, code: e.code, message: String(e.message).split('\n')[0] }; }
try { ro.prepare("INSERT INTO process_roles (role,enforcement) VALUES ('probe','contract')").run(); out.ro_insert = { ok: true }; }
catch (e) { out.ro_insert = { ok: false, code: e.code, message: String(e.message).split('\n')[0] }; }
console.log(JSON.stringify(out, null, 1));
ro.close(); rw.close();

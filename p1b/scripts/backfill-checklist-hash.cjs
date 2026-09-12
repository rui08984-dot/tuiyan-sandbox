'use strict';
// F16 回填：879 行 checklist_hash 空的题，按 evidence.kind 映射补上
const path=require('path');
const dbApi=require(path.join('E:/music player/','p1a-terminal','src','db.js'));
const CONFIRM = process.argv.includes('--confirm');
dbApi.init(path.join('E:/music player/','p1a-terminal','data','p1a.db'));
const c=dbApi.getConnection();
// 映射表（按 F16 证据：各批脚本声明的清单版本）
const MAP = { forward_batch:'v2', forward_batch_b2:'v2', oct_forward:'v2', b3_backfill:'v2', b3_forward:'v2', wide_backfill:'v2', wide_forward:'v2' };
const rows=c.prepare("SELECT p.id AS pid, json_extract(e.value,'$.kind') AS k FROM predictions p, json_each(p.evidence_json) e WHERE json_extract(e.value,'$.kind') IS NOT NULL AND p.checklist_hash IS NULL").all();
console.log('待回填行数:', rows.length);
let n=0, skip=0;
for(const r of rows){
  const v = MAP[r.k];
  if(!v){ skip++; continue; }
  if(CONFIRM) c.prepare('UPDATE predictions SET checklist_hash=? WHERE id=?').run(v, r.pid);
  n++;
}
console.log('可回填:', n, '| 无映射跳过:', skip, '| confirm:', CONFIRM);
console.log('回填后空值:', c.prepare('SELECT COUNT(*) n FROM predictions WHERE checklist_hash IS NULL').get().n);
if(!CONFIRM) console.log('DRY-RUN：加 --confirm 执行');
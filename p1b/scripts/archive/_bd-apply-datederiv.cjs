'use strict';
// 口径B 微步1/4：契约表 date_derivations 扩展（读-改-写-复验 sha；纯 JSON additive；零写库）
const fs = require('fs');
const crypto = require('crypto');
const F = 'E:/music player/p1b/sim/out/g2-contract-frozen-r4.json';
const R = 'E:/music player/p1b/scripts/_bd-daterules.json';
const PREV = 'bafd3d389a91b042d0875ad8678a260ed0636722385a8e18888550a6c6fb9808';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
if (sha(fs.readFileSync(F)) !== PREV) throw new Error('pre-sha mismatch（文件已被改动？中止）');
const doc = JSON.parse(fs.readFileSync(F, 'utf8'));
if (doc.date_derivations) throw new Error('date_derivations 已存在？中止（幂等保护）');
const rules = JSON.parse(fs.readFileSync(R, 'utf8'));
if (Object.keys(rules).length !== 22) throw new Error('rules != 22');
for (const [k, v] of Object.entries(rules)) {
  if (typeof v.source_key !== 'string' || typeof v.granularity !== 'string' || typeof v.rule !== 'string') throw new Error('bad rule: ' + k);
  if (v.source_key === 'week_start' || /直接取用/.test(v.rule)) continue; // 直接取用类无需换算函数
}
doc.date_derivations = rules;
doc.date_derivation_added = '2026-09-14';
doc.previous_sha256 = PREV;
doc.meta.refrozen_at = '2026-09-14';
doc.meta.refrozen_by = 'agent（口径B 微步1/4 · date_derivations 22 kind · additive）';
doc.meta.refrozen_reason = '决策brief §5 口径B：为 22 个周期 kind 登记 date_derivation 到期日换算规则（g2-report 换算用，微步2 接线）；sha 变更原因＝本扩展；旧 sha 存顶层 previous_sha256；探测收据=p1b/scripts/_bd-dateprobe.cjs/_bd-anchorprobe.cjs（只读）';
fs.writeFileSync(F, JSON.stringify(doc, null, 2), 'utf8');
const rt = JSON.parse(fs.readFileSync(F, 'utf8'));
console.log('NEW_SHA=' + sha(fs.readFileSync(F)));
console.log('VERIFY rules=' + Object.keys(rt.date_derivations).length
  + ' contracts=' + Object.keys(rt.contracts).length
  + ' aliases=' + Object.keys(rt.aliases).length
  + ' top_added=' + rt.date_derivation_added
  + ' prev_ok=' + (rt.previous_sha256 === PREV));

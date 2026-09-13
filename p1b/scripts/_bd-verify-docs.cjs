'use strict';
// 口径B 微步4 读回验收（只读）
const fs = require('fs');
const has = (f, s) => fs.readFileSync(f, 'utf8').includes(s);
const D = 'E:/music player/docs/specs/2026-09-11-万物可预测性审计器-design.md';
const C = 'E:/music player/docs/specs/变更留痕索引-20260912.md';
const R = 'E:/music player/docs/specs/README-总索引.md';
const P = 'E:/music player/docs/sandbox/p1b/itest/p19-PROGRESS.md';
const lines = (f) => fs.readFileSync(f, 'utf8').split(String.fromCharCode(10)).length;
console.log('design_lines=' + lines(D) + ' changelog_lines=' + lines(C) + ' readme_lines=' + lines(R) + ' p19_lines=' + lines(P));
console.log('D_h424=' + has(D, '### §4.2.4 修订 R4.3') + ' D_order424_before_s5=' + (fs.readFileSync(D, 'utf8').indexOf('§4.2.4') < fs.readFileSync(D, 'utf8').indexOf('## §5 与②类校准线')));
console.log('D_original_intact=' + (has(D, '（本块完 · 2026-09-13 · R4.2）') && has(D, '### §4.2.3 修订 R4.2')));
console.log('D_nums=' + [has(D, '1058→1312'), has(D, '33→197'), has(D, '928→1120'), has(D, '007b41188807'), has(D, 'bafd3d389a91'), has(D, '2026106=2026-09-13'), has(D, '26105=2026-09-14'), has(D, 'backfill_no_forwardLooking')].join(','));
console.log('C_s16=' + has(C, '## §16 追加 · 2026-09-14') + ' C_s15_intact=' + has(C, '## §15 追加 · 2026-09-14') + ' C_table=' + has(C, '| 读数前后 |') + ' C_nums=' + [has(C, '1312'), has(C, '007b41188807'), has(C, '5a72ef3f')].join(','));
console.log('R_block=' + has(R, 'G2 口径修订 R4.3 与契约表 date_derivation') + ' R_tielv_intact=' + has(R, '## 5 · 铁律速查（违反=弃棒）') + ' R_nums=' + [has(R, '007b41188807'), has(R, '1312'), has(R, '5a72ef3f')].join(','));
console.log('P_section=' + has(P, '口径B微步4完成') + ' P_prev_intact=' + has(P, '口径B微步3验收通过'));

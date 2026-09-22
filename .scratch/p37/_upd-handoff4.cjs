'use strict';
// 一次性：交接件加「eurostat_live leak 诊断」到知会 + §0 完成行
const fs = require('fs');
const P = '.scratch/handoff/推演沙盘-交接-20260921-终态.md';
const BQ = String.fromCharCode(96);
let t = fs.readFileSync(P, 'utf8');

// ① §5 知会区：把原来的「未处置」改为「已诊断（推荐维持现状）」
const old = '- ★**既有生产题 ' + BQ + 'eurostat_live_*' + BQ + ' 9 条中 6 条在 gate 下判 leak**（过锚率 33%）——属生产题口径问题，已如实上报**未自行处置**（改动须版本递进＋拍板）';
if (t.indexOf(old) < 0) { console.log('★未找到知会行'); process.exit(1); }
const neu = '- ★**既有生产题 ' + BQ + 'eurostat_live_*' + BQ + ' 9 条中 6 条在 gate 下判 leak**（过锚率 33%）——**已专项诊断**（（五十三）批）：根因＝**出题时目标期选「当期/当年」**（期已开始 ⇒ 真泄漏）；**与 I1 生成器 v1/v2 错同型**（该口径已在 I1 v3 修正并锁死）；**推荐维持现状**（账本不可变／6 条全未解不触门／移出＝事后择优禁）；诊断件 ' + BQ + '.scratch/p37/eurostat-live-leak诊断-20260922.md' + BQ + '';
t = t.replace(old, neu);

// ② §0 完成行加⑥
t = t.replace('⑤默认关锁＋修测试偶发红 | 本件头部刷新注 |', '⑤默认关锁＋修测试偶发红 ⑥**eurostat_live leak 专项诊断**（只读） | 本件头部刷新注 |');
fs.writeFileSync(P, t, 'utf8');
console.log('交接件已更新');

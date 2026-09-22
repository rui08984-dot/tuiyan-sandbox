'use strict';
// 一次性：p19 索引加 144 块（09-22 四批）
const fs = require('fs');
const P = 'docs/sandbox/p1b/itest/p19-ANCHOR-INDEX.md';
let t = fs.readFileSync(P, 'utf8');
const marker = '| # | 行 | 断点块 | 摘要 |\n';
const i = t.indexOf(marker);
if (i < 0) { console.log('★未找到表头'); process.exit(1); }
const add = [
'| 144 | L2636+ | 【2026-09-22 四批 · 09-22 例行结算 ＋ 候选留痕旁路补齐 ＋ ★修「跑测试写仓库产物」缺陷】 | **①09-22 结算**＝到期 34 ⇒ resolved **3**（L2 binance 09-21 收盘，全 false）／零翻转（四表逐位同、恰 +3）／已解 1658→**1661**、L2 404→**407**/0.2384；未结＝binance pending 3（正常）＋ cta/elexon fail 5（已知地域封禁）；**②候选留痕旁路补齐两处**（role3-utype 5 处父题级／calendar-questions 3 处源-geo 级；默认关零行为变化）⇒ **★I1 严格口径首次可读＝85.71%**（候选口径 100%；被丢 1 条＝IT 历史不足；仍 ≥80% 判据）；**③★修「跑测试写仓库产物」缺陷**＝thickcell-replay.test.cjs 只传 --json 而脚本 .md 用默认路径 ⇒ 每次跑测试写仓库产物（既有记忆同病根·复发）⇒ 补传 --md ＋ 回归锁；测试 533→**535**；**④交接件原位刷新**（§0／§1／§2／§5）＋ 锚 p32 扩展至 **17 批**；★过程自查＝反引号坑今日累计 5 次 ⇒ 纪律升级「含反引号文本一律走文件」。',
].join('\n') + '\n';
t = t.slice(0, i + marker.length) + add + t.slice(i + marker.length);
t = t.replace('· 143 个断点块 ·', '· 144 个断点块 ·').replace('**143 个断点块**', '**144 个断点块**');
t = t.replace('（索引完 · 2026-09-21 · 143 块', '（索引完 · 2026-09-22 · 144 块');
t = t.replace('最近刷新 2026-09-21（四十四批）', '最近刷新 2026-09-22（09-22 四批）');
fs.writeFileSync(P, t, 'utf8');
console.log('p19 索引已加 144 块');

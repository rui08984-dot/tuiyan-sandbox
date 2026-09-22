'use strict';
// 一次性：交接件 §2 补 09-22 批次链
const fs = require('fs');
const P = '.scratch/handoff/推演沙盘-交接-20260921-终态.md';
const BQ = String.fromCharCode(96);
let t = fs.readFileSync(P, 'utf8');
const anchor = '## 2. 已收口勿重做（全部 git 可查）';
if (t.indexOf(anchor) < 0) { console.log('★未找到'); process.exit(1); }
const add = [
anchor,
'',
'**09-22 全天 6 批（commit 链）**：',
'- ' + BQ + '409e9fa' + BQ + ' 交接件第 21 份 ＋ 锚 p32 ＋ p19 索引 143 块 ＋ B4 审计（零新增坏锚）',
'- ' + BQ + '89e3440' + BQ + ' 地图 §72 ＋ 留痕 §104（收尾三件）',
'- ' + BQ + 'e3253e2' + BQ + ' 落盘审计（10/10 在盘）＋ 清理 bash 重定向副产物',
'- ' + BQ + 'd74bb81' + BQ + ' **★修「跑测试写仓库产物」缺陷**（thickcell-features 的 .md 默认路径）＋ 日期口径更正',
'- ' + BQ + 'ba2c78a' + BQ + ' **09-22 例行结算**（到期 34 ⇒ resolved 3；已解 1658→**1661**；L2 404→**407**/0.2384）',
'- ' + BQ + '6a11bc0' + BQ + ' 角色③候选留痕旁路（' + BQ + '--record-candidates' + BQ + '；5 处父题级丢弃点）',
'- ' + BQ + '1abf2f8' + BQ + ' 交接件原位刷新（§0／§1／§5）',
'- ' + BQ + 'cfff2bb' + BQ + ' **I1 候选留痕旁路** ⇒ **★严格口径首次可读＝85.71%**',
'- 待提交 锚 p32 扩展（17 批）＋ 地图 §73 ＋ 留痕 §105 ＋ p19 索引 144 块',
'',
].join('\n');
t = t.replace(anchor, add);
fs.writeFileSync(P, t, 'utf8');
console.log('§2 已补 09-22 链');

'use strict';
// 一次性：收尾落盘（锚 p32／地图 §78／留痕 §110／p19 索引 149 块／坑总表补全库数字）
const fs = require('fs');
const BQ = String.fromCharCode(96);

// ① 锚 p32 §2.6 补一行
const AP = 'docs/sandbox/p1b/itest/p32-第4期交付与I1角色3-dlt修复-20260921-PROGRESS.md';
let a = fs.readFileSync(AP, 'utf8');
const aAnchor = '- **★eurostat_live_* 6 条判 leak 专项诊断**（只读，零改动）：';
const i = a.indexOf(aAnchor);
if (i < 0) { console.log('★锚 p32 锚点未找到'); process.exit(1); }
const lineEnd = a.indexOf('\n', i);
a = a.slice(0, lineEnd) + '\n- **★全库 leak 扫描（把点做成面）**：1368 条有 cutoff 的题中 **leak 7 条／pass 1085／窗口起点推不出 276（单列）**；leak 分属 **3 个 kind**——eurostat_live 两 kind（6 条，已知）＋**noaa_solar_cycle_ssn_monthly 1 条（★本次新发现）**；★**同批对照**（同 kind 6 条）：backfill 4 条 pass／未来期 forward 1 条 pass／**当期 forward 1 条 leak** ⇒ **第三个同型实例** ⇒ 证明该错**跨 3 生成器/3 域系统性**；处置沿用既有裁决（零改动）。' + a.slice(lineEnd);
fs.writeFileSync(AP, a, 'utf8');
console.log('① 锚 p32 已补');

// ② 地图 §78
const MP = '项目全资源地图-20260914.md';
let m = fs.readFileSync(MP, 'utf8');
m = m.replace('（**最新；以本节为准**；§65–§76 为承前）', '（承前）');
const sec78 = [
'',
'## §78 2026-09-22 续5 · 全库 leak 扫描（★发现第三个同型实例）（**最新；以本节为准**；§65–§77 为承前）',
'',
'### 一句话',
'把 eurostat_live 的「点」做成「面」——**全库扫一遍** ⇒ **leak 7 条／3 kind**（含 **1 条此前未知**）⇒ 确认「数据未发布 ≠ 窗口未开始」是**跨域系统性易犯错**。',
'',
'### 扫描结果（1368 条有 cutoff 的题）',
'',
'| 判定 | 条数 |',
'|---|---|',
'| pass | **1085** |',
'| **★leak** | **7** |',
'| 窗口起点推不出 | 276（单列，未判）|',
'',
'**leak 按 kind**：eurostat_live_tertiary_attain 3／eurostat_live_unemployment_monthly 3（均已知）／**noaa_solar_cycle_ssn_monthly 1（★本次新发现）**。',
'',
'### ★新发现这条（id=1100）+ 同批对照',
'',
'同批 6 条（同 kind）：',
'',
'| id | 类型 | 目标期 | cutoff | 判定 |',
'|---|---|---|---|---|',
'| 1096-1099 | backfill | 2026-05~08（过去月）| 前一日 23:59 | **pass** ✓ |',
'| 1101 | forward | 2026-**10**（未来月）| 09-13 | **pass** ✓ |',
'| **1100** | forward | 2026-**09**（**当月**）| 09-13 | **★leak** ✗ |',
'',
'⇒ **同批里 backfill 与未来期 forward 都干净，唯独「当期 forward」出错**。',
'',
'### ★第三个同型实例',
'',
'| # | 实例 | 表现 |',
'|---|---|---|',
'| 1 | I1 生成器 v1/v2 | v1/v2 都 leak；**v3「期首日严格晚于 cutoff」才对** |',
'| 2 | eurostat_live_*（6 条）| 当期与当年 ⇒ leak |',
'| 3 | **noaa_solar_cycle_ssn_monthly（1 条，本次）** | 当期 ⇒ leak |',
'',
'⇒ 共性＝**出题时目标期选「当期/当年」** ⇒ 证明该错**跨 3 生成器/3 域系统性**（非孤立）。',
'',
'### 处置',
'- **零改动**（账本不可变；7 条均不触门）；**不新增待拍板项**（适用既有裁决 A）。',
'- 价值＝**把孤立发现升级为模式确认**。',
'',
'### 同步索引',
'',
'锚 **p32**｜地图 **§78**｜p19 索引 **149 块**｜留痕 **§110**｜测试 **539/539**｜**待拍板 0 项**。',
'',
'（§78 完 · 2026-09-22 续5 · 全库 leak 扫描 · 零改动）',
].join('\n');
fs.writeFileSync(MP, m + sec78, 'utf8');
console.log('② 地图 §78 已追加');

// ③ 留痕 §110
const CL = 'docs/specs/变更留痕索引-20260912.md';
const s110 = [
'',
'## §110 2026-09-22 续5 · 全库 leak 扫描（★发现第三个同型实例）',
'',
'- **触发**：eurostat_live 诊断后，把「点」做成「面」——全库扫描 cutoff vs 窗口起点。',
'- **性质**：只读扫描（零代码改动、零账本写）。',
'',
'### 结果（1368 条有 cutoff 的题）',
'- pass **1085**／**★leak 7**／窗口起点推不出 276（单列，未判）。',
'- leak 按 kind：eurostat_live 两 kind 6 条（已知）＋ **noaa_solar_cycle_ssn_monthly 1 条（★本次新发现）**。',
'',
'### ★新发现这条（id=1100）＋同批对照',
'- 同批 6 条：backfill 4 条 **pass**／未来期 forward 1 条 **pass**／**当期 forward 1 条 leak**。',
'- ⇒ **同批里只有「当期」出错**。',
'',
'### ★第三个同型实例',
'| # | 实例 |',
'|---|---|',
'| 1 | I1 生成器 v1/v2（v3 才对）|',
'| 2 | eurostat_live_*（6 条）|',
'| 3 | **noaa_solar_cycle_ssn_monthly（1 条）** |',
'',
'- 共性＝**出题时目标期选「当期/当年」** ⇒ **跨 3 生成器/3 域系统性**。',
'',
'### 处置',
'- **零改动**；**不新增待拍板项**（适用既有裁决 A）；价值＝**模式确认**。',
'',
'### 诚实边界',
'- 扫描**只覆盖有 meta.cutoff 的题**（1368/1994）⇒ 其余 626 条**未判**（非「通过」，是未覆盖）。',
'- 276 条窗口起点推不出 ⇒ 单列（未判 pass/leak）。',
'',
'### 落点',
'- 扫描件 ' + BQ + '.scratch/p37/全库leak扫描-20260922.md' + BQ + '｜锚 **p32**｜地图 **§78**｜p19 索引 **149 块**',
'',
'（§110 完 · 2026-09-22 续5 · 全库 leak 扫描 · 零改动）',
].join('\n');
fs.appendFileSync(CL, s110 + '\n', 'utf8');
console.log('③ 留痕 §110 已追加');

// ④ p19 索引 149
const IP = 'docs/sandbox/p1b/itest/p19-ANCHOR-INDEX.md';
let idx = fs.readFileSync(IP, 'utf8');
const marker = '| # | 行 | 断点块 | 摘要 |\n';
const ii = idx.indexOf(marker);
const block = '| 149 | L2636+ | 【2026-09-22 续5 · 全库 leak 扫描（★发现第三个同型实例）】 | 1368 条有 cutoff 的题中 **pass 1085／★leak 7／窗口起点推不出 276（单列）**；leak 分属 **3 kind**＝eurostat_live 两 kind（6 条已知）＋**noaa_solar_cycle_ssn_monthly 1 条（★本次新发现）**；**★同批对照**（同 kind 6 条）＝backfill 4 条 pass／未来期 forward 1 条 pass／**当期 forward 1 条 leak** ⇒ **第三个同型实例**（前两＝I1 v1/v2、eurostat_live）⇒ 证明「**数据未发布 ≠ 窗口未开始**」是**跨 3 生成器/3 域系统性易犯错**；处置＝**零改动**（沿用既有裁决 A，不新增待拍板）；诚实边界＝只覆盖有 cutoff 的题（1368/1994，其余 626 未判）＋276 条窗口起点推不出单列。 |\n';
idx = idx.slice(0, ii + marker.length) + block + idx.slice(ii + marker.length);
idx = idx.replace('· 148 个断点块 ·', '· 149 个断点块 ·').replace('**148 个断点块**', '**149 个断点块**');
idx = idx.replace('（索引完 · 2026-09-22 · 148 块', '（索引完 · 2026-09-22 · 149 块');
fs.writeFileSync(IP, idx, 'utf8');
console.log('④ p19 索引 149 块');

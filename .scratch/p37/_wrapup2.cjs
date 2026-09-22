'use strict';
// 一次性：收尾落盘（锚 p32 §2.6 扩充／地图 §74／留痕 §106／p19 索引 145 块／交接件 §1 更新）
const fs = require('fs');
const BQ = String.fromCharCode(96);

// ── ① 锚 p32：§2.6 扩充 ＋ §5 读数 ＋ §6 ──
const AP = 'docs/sandbox/p1b/itest/p32-第4期交付与I1角色3-dlt修复-20260921-PROGRESS.md';
let a = fs.readFileSync(AP, 'utf8');
a = a.replace('- **★I1 严格口径首次可读**：候选口径 6/6＝100% ⇒ **严格口径（提议全集 7）＝85.71%**（被丢 1 条＝IT 历史不足）；仍 ≥80% 判据，但是**更诚实的读数**',
  [
  '- **★I1 严格口径首次可读**：候选口径 6/6＝100% ⇒ **严格口径（提议全集 7）＝85.71%**（被丢 1 条＝IT 历史不足）；仍 ≥80% 判据，但是**更诚实的读数**',
  '- **★候选留痕旁路覆盖全部 5 个出题器**：corpus-sources-b4（原有）／role3-utype（父题级 5 处）／calendar-questions（源-geo 级 3 处）／**corpus-thicken（recipe 条目级 23 处）**／**role3-pilot（不丢弃·比 drops 更严）**',
  '- **★★corpus-thicken 口径错先犯后修**：首版把 elexon 的 `not_wind_fuel`（源里 6745 行非 WIND）计入提议全集 ⇒ 严格分母从 6 虚增到 **6751（失真 1125 倍）**；辨明「**数据行过滤 ≠ 候选丢弃**」⇒ 新增 `dataFilter`/`FILTERED` 与 `recDrop`/`DROPS` **分开**，留痕件单列 `data_filtered`；修正后提议全集回到 **6**',
  '- **★审计锁 ⑧**：五出题器留痕口径审计——判据**不机械要求** record-candidates 字样，允许「不丢弃（更严）」设计；清单长度锁 5（防漏审）',
  ].join('\n'));
a = a.replace('| 测试 | **535/535** |', '| 测试 | **538/538** |');
fs.writeFileSync(AP, a, 'utf8');
console.log('① 锚 p32 已扩充');

// ── ② 地图 §74 ──
const MP = '项目全资源地图-20260914.md';
let m = fs.readFileSync(MP, 'utf8');
m = m.replace('（**最新；以本节为准**；§65–§72 为承前）', '（承前）');
const sec74 = [
'',
'## §74 2026-09-22 续 · 候选留痕旁路覆盖全部出题器 ＋ ★一处口径错先犯后修（**最新；以本节为准**；§65–§73 为承前）',
'',
'### 一句话',
'候选留痕旁路（让过锚率的**严格分母**可测）从 3 个出题器扩到 **全部 5 个**；过程中**先犯后修**一处口径错——把「源数据行过滤」误计入提议全集（失真 1125 倍）。',
'',
'### 五个出题器覆盖现状',
'',
'| 出题器 | 旁路 | 粒度 |',
'|---|---|---|',
'| corpus-sources-b4 | ✓ 原有 | 题级 |',
'| role3-utype | ✓ | 父题级（5 处）|',
'| calendar-questions | ✓ | 源/geo 级（3 处）|',
'| corpus-thicken | ✓ 本批 | recipe 条目级（23 处）|',
'| role3-pilot | ✓ 本批 | **不丢弃**（比 drops 更严）|',
'',
'### ★★口径错先犯后修（本批最重要）',
'- **犯**：给 corpus-thicken 加旁路时，把 elexon 的 `not_wind_fuel`（源里 **6745 行**非 WIND 燃料）计入「提议全集」⇒ 严格分母从 6 虚增到 **6751（失真 1125 倍）**。',
'- **辨**：`not_wind_fuel` 是**源数据行的过滤**（该 recipe 只关心 WIND），**不是**「本可成为候选但被丢的提议」。',
'- **修**：新增 `dataFilter()` / `FILTERED` 与 `recDrop()` / `DROPS` **分开**；留痕件单列 `data_filtered`（**不计入** proposed_total）。',
'- **验**：修正后 elexon 提议全集回到 **6**（真实），数据过滤 6745 单列。',
'- **锁**：测试 ⑤（口径分离锁）＋反向锁（not_wind_fuel／invalid_sample 不得走 recDrop）。',
'',
'### ★role3-pilot 的「缺」是设计如此',
'- 它**不丢弃**任何提议（解析失败/契约违约/调用失败均留 rows，`_valid:false` ＋ `resolve:null`）⇒ gate 判 no_anchor ⇒ **分母天然＝提议全集**（**比 drops 更严**）。',
'- 本批补显式 `drops: []` ＋ 说明 ⇒ gate 可报**严格口径**（42/42＝100%）。',
'- **审计锁 ⑧**：判据不机械要求 record-candidates 字样（允许两种等效设计）；清单长度锁 5。',
'',
'### 同步索引',
'',
'锚 **p32**｜地图 **§74**｜p19 索引 **145 块**｜留痕 **§106**｜测试 **538/538**。',
'',
'（§74 完 · 2026-09-22 续 · 五出题器留痕全覆盖 ＋ 口径错先犯后修 · 测试 538/538）',
].join('\n');
fs.writeFileSync(MP, m + sec74, 'utf8');
console.log('② 地图 §74 已追加');

// ── ③ 留痕 §106 ──
const CL = 'docs/specs/变更留痕索引-20260912.md';
const s106 = [
'',
'## §106 2026-09-22 续 · 候选留痕旁路覆盖全部出题器 ＋ ★一处口径错先犯后修',
'',
'- **触发**：交接件 §1 新首选棒③「把候选留痕旁路接入常规流程」的执行与收尾。',
'',
'### ① corpus-thicken 补旁路（23 处丢弃点）',
'- 类型分布：fetch_fail 5／insufficient_history 5（含 <20 阈值 ×2）／no_quantile 5／out_of_band 6／not_wind_fuel 1／invalid_sample 1。',
'',
'### ② ★★口径错先犯后修',
'- **犯**：把 `not_wind_fuel`（源里 6745 行非 WIND）计入提议全集 ⇒ 严格分母 6 → **6751（失真 1125 倍）**。',
'- **辨**：「**数据行过滤**」≠「**候选丢弃**」。',
'- **修**：新增 `dataFilter()`/`FILTERED`，与 `recDrop()`/`DROPS` 分开；留痕件单列 `data_filtered`。',
'- **验**：修正后提议全集回到 **6**。',
'',
'### ③ role3-pilot 补 drops 字段',
'- 其口径**比 drops 更严**（不丢弃，无效项留 rows 标 `_valid:false`）⇒ 分母天然＝全集。',
'- 补显式 `drops: []` ＋ 说明 ⇒ gate 可报严格口径（42/42＝100%）。',
'',
'### ④ 审计锁 ⑧（五出题器口径审计）',
'- 判据**不机械要求** record-candidates 字样：允许「① 支持参数」或「② 声明不丢弃」两种等效设计。',
'- 清单长度锁 5（新增出题器时须同步本测试 ⇒ 防漏审）。',
'',
'### ★ 过程自查',
'- **测试正则方括号未转义**：`/drops: []/` 中 `[]` 是**空字符类** ⇒ 永不匹配 ⇒ 改用 `indexOf`。',
'- **测试加错文件**：初版加到 `role3-utype.test.cjs`（其 `SCRIPT` 指向 utype 而非 pilot）⇒ 已移到 `role3-freeze.test.cjs`。',
'- **引号嵌套错**：写一次性脚本时单引号内嵌单引号 ⇒ 改用双引号转义。',
'',
'### 落点',
'- 锚 **p32**｜地图 **§74**｜p19 索引 **145 块**｜测试 **538/538**｜留痕件 `.scratch/p37/thicken-elexon3.json`（口径修正后的证据）',
'',
'（§106 完 · 2026-09-22 续 · 五出题器留痕全覆盖 ＋ 口径错先犯后修 · 测试 538/538）',
].join('\n');
fs.appendFileSync(CL, s106 + '\n', 'utf8');
console.log('③ 留痕 §106 已追加');

// ── ④ p19 索引 145 ──
const IP = 'docs/sandbox/p1b/itest/p19-ANCHOR-INDEX.md';
let idx = fs.readFileSync(IP, 'utf8');
const marker = '| # | 行 | 断点块 | 摘要 |\n';
const ii = idx.indexOf(marker);
const block = '| 145 | L2636+ | 【2026-09-22 续 · 候选留痕旁路覆盖全部出题器 ＋ ★一处口径错先犯后修】 | **①覆盖扩到全部 5 个出题器**（corpus-sources-b4 原有／role3-utype 父题级 5 处／calendar-questions 源-geo 级 3 处／**corpus-thicken recipe 条目级 23 处**／**role3-pilot 不丢弃·比 drops 更严**）；**②★★口径错先犯后修**＝首版把 elexon 的 not_wind_fuel（源里 6745 行非 WIND）计入提议全集 ⇒ 严格分母 6→**6751（失真 1125 倍）**；辨明「**数据行过滤 ≠ 候选丢弃**」⇒ 新增 dataFilter/FILTERED 与 recDrop/DROPS 分开，留痕件单列 data_filtered；修正后回到 **6**；**③role3-pilot 补 drops:[] 字段**（其口径更严：不丢弃任何提议）⇒ gate 可报严格口径 42/42＝100%；**④审计锁 ⑧**（五出题器口径审计，判据不机械要求 record-candidates，清单锁 5）；测试 535→**538**；★过程自查＝测试正则方括号未转义（空字符类永不匹配）／测试加错文件／引号嵌套错。 |\n';
idx = idx.slice(0, ii + marker.length) + block + idx.slice(ii + marker.length);
idx = idx.replace('· 144 个断点块 ·', '· 145 个断点块 ·').replace('**144 个断点块**', '**145 个断点块**');
idx = idx.replace('（索引完 · 2026-09-22 · 144 块', '（索引完 · 2026-09-22 · 145 块');
fs.writeFileSync(IP, idx, 'utf8');
console.log('④ p19 索引 145 块');

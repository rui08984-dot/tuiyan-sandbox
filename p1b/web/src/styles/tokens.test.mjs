import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const { CHECKS, readTokens, ratio } = require('./contrast-check.cjs');

/** 「全站样式表」＝**按目录枚举**，不是点名清单。
 *
 *  ★2026-09-30 两道闸就是这么红的：原版各带一份点名清单，且两份都含 `intake.css`，
 *   它随死页面 `pages/intake/IntakePage.tsx` 一起删除 ⇒ 顶层 readFileSync ENOENT
 *   ⇒ 下面两条闸全红（实测 'test failed'）。
 *   改名单的毛病不止于「会过期」这一条：原清单**漏**了 home / note / question /
 *   resolve / wait / whereoff 六个已入库的样式表——纪律写的是「全站」，实际只扫了
 *   若干个，新加样式表默认不在射程内，而且没人会注意到射程变了。
 *   改为枚举后：① 删文件不再红；② 新样式表自动进射程，是**加严**不是放宽。
 *   实测 2026-09-30：枚举出的 16 个 .css 在下面两道扫描下都干净（零命中）。 */
const cssFiles = readdirSync(new URL('./', import.meta.url))
  .filter((f) => f.endsWith('.css')).sort();
const readStyle = (f) => readFileSync(new URL('./' + f, import.meta.url), 'utf8');

test('观测台语义层变量齐备', () => {
  for (const v of ['--grid-line', '--panel-3', '--shadow-4', '--space-section', '--font-size-micro']) {
    assert.ok(css.includes(v + ':'), '缺变量 ' + v);
  }
});

/** 2026-09-22 全方面重构：身份色由暖棕羊皮纸换为抹茶绿观测台。
 *  ★2026-09-27 八轮：底色再由「墨绿黑」换为「中性石墨」——
 *  动机不是好不好看（不可测），是三处可测的结构问题：
 *   ① 原底色带绿味（#1A1F1C 的 R<G<B），面板层级只能靠「继续加绿」区分 ⇒ 整站一个色相
 *      ⇒ 撞「近黑底＋单一亮点」AI 味清单，也丧失「不同层/不同域用不同色」的辨识度；
 *   ② 强调色由「全站唯一光源」降为「仪器指示灯」，色相让位给语义；
 *   ③ 三层径向光晕 + 星座粒子零信息承载 ⇒ 删除（glow-* 全部 transparent）。
 *  ★ 不是删闸，是换锁：新值同样逐字锁定，且下面增补了自动对比度闸（更强的守卫）。 */
test('★冷白记录台身份变量值未被改动', () => {
  assert.ok(css.includes('--bg: #F4F4F1;'), '--bg 被改（应为冷白 #F4F4F1）');
  assert.ok(css.includes('--accent: #0F6E63;'), '--accent 被改（应为深青 #0F6E63）');
  assert.ok(css.includes('--panel: #FFFFFF;'), '--panel 被改（应为纯白 #FFFFFF）');
  assert.ok(css.includes('--text: #1A1A1A;'), '--text 被改（应为近纯黑 #1A1A1A）');
});

/** ★八轮第二轮（冷白记录台）新增两道闸：
 *  ① 现场深色主题必须在场且自带合格的层色——浅底版的低彩度色在深底上只有 ~2.3:1（实测不合格）。
 *  ② 未测斜纹工具类必须在场：本轮的核心机制是「已落定一律灰、颜色/纹理只给还没落定的」，
 *     若 .is-unmeasured 消失，19 个薄格会退回纯空白，被读成「没数据」而非「已知不足」。 */
test('★现场深色主题自带合格层色（浅底层色在深底不合格）', () => {
  const live = css.slice(css.indexOf('[data-mode="live"]'));
  assert.ok(live.length > 0, '缺 [data-mode="live"] 深色主题块');
  for (const v of ['--layer-l1', '--layer-l2', '--layer-l3', '--layer-l4', '--layer-l5', '--layer-l6']) {
    assert.ok(live.includes(v + ':'), '现场主题缺 ' + v);
  }
  assert.ok(css.includes('[data-mode="live"]'), '缺现场模式选择器');
});

test('★未测＝斜纹的工具类在位（核心机制不得退化）', () => {
  assert.ok(css.includes('.is-unmeasured'), '缺 .is-unmeasured（未测格斜纹）');
  assert.ok(css.includes('--unmeasured-ink'), '缺 --unmeasured-ink');
  assert.ok(css.includes('repeating-linear-gradient'), '斜纹须用 repeating-linear-gradient');
});

test('★全站不得有写死的强调色 rgba（换色板会静默降级）', () => {
  // 病象：旧色板时代遗留 20+ 处 rgba(143,175,123,α) 写死值，换成浅底后会显脏且不受主题控制。
  // ★范围＝枚举出的全部 .css（见文件头 cssFiles 说明），不是点名清单。
  assert.ok(cssFiles.length > 0, 'styles/ 枚举为空 ⇒ 这道扫描已空跑，失去意义');
  const offenders = [];
  for (const f of cssFiles) {
    const t = readStyle(f);
    if (/143,\s*175,\s*123/.test(t)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], '仍有写死的旧强调色：' + offenders.join(','));
});

/** ★新增闸：装饰性背景必须为零。
 *  病象：三层径向光晕 + 暗角 + 星座粒子，全部不表达任何状态、不参与任何读数，
 *  只是在深底上制造「有东西在动」的错觉，并让面板边界更难分辨。
 *  本闸把「装饰不得回来」固化，防后续以「加氛围」为名重新引入。 */
test('★装饰性背景层已归零（防氛围装饰回流）', () => {
  for (const v of ['--glow-1', '--glow-2', '--glow-3', '--vignette']) {
    // v 自带前导 --，故模式里不要再拼 '--'（否则会拼成 '---glow-1' 而永不匹配）
    const m = new RegExp(v + ':\\s*([^;]+);').exec(css);
    assert.ok(m, '缺变量 ' + v);
    assert.equal(m[1].trim(), 'transparent', v + ' 应为 transparent（装饰已删除），实得 ' + m[1].trim());
  }
});

test('L1-L6 层色六色全在', () => {
  for (const v of ['--layer-l1', '--layer-l2', '--layer-l3', '--layer-l4', '--layer-l5', '--layer-l6']) {
    assert.ok(css.includes(v + ':'), '缺 ' + v);
  }
});

/** ★八轮第二轮：`.app-surface` 双层网格**已整体删除**，本闸随之换锁。
 *  病象：网格在深底上是「坐标系」；换浅底后它变成**纸纹**，与正文打架，
 *  而全站其实没有一处真正挂过 .app-surface（实测 grep 零命中）——即一个从未生效的装饰。
 *  新锁：reduced-motion 仍在（交付底线），且「未测斜纹」在场（见上）。 */
test('reduced-motion 仍在场（交付底线）且底纹网格已退役', () => {
  assert.ok(css.includes('prefers-reduced-motion'), '缺 reduced-motion（交付底线，不可删）');
  assert.equal(css.includes('.app-surface'), false, '.app-surface 已退役（浅底上只是纸纹，且从未挂载）');
});

/** ★ 新增闸：换色板后「好不好看」不可测，「看不看得清」可测。
 *  初版 --matcha/#6E8B5E(3.90) 与 --layer-l6/#C4705E(4.12) 肉眼看着没问题，实测不达标
 *  ⇒ 本闸把「改色必跑对比度」固化进测试，防止后续换色静默降级可读性。 */
test('全部前景色对比度达标（WCAG 4.5:1；图表轴线 3:1）', () => {
  const T = readTokens(new URL('./tokens.css', import.meta.url));
  const bad = [];
  for (const [fg, bg, min, note] of CHECKS) {
    const r = ratio(T[fg], T[bg]);
    if (r < min) bad.push(note + ' 实测 ' + r.toFixed(2) + ' <' + min);
  }
  assert.deepEqual(bad, [], '对比度不合格:\n' + bad.join('\n'));
});

test('刻度网格为双层（主+次）且为抹茶色相', () => {
  assert.ok(css.includes('--grid-line-fine'), '缺次网格变量');
  assert.ok(css.includes('--grid-size-fine'), '缺次网格尺寸变量');
  assert.ok(css.includes('--grid-size'), '缺主网格尺寸变量');
});

/** ★八轮第二改：禁「全大写拉丁」eyebrow 回流。
 *  病象：`.plate-tail` / `.chart-eyebrow` / `.tb-label` / `.page-side-title` /
 *   `.ov-hero-eyebrow` 五处都带 `text-transform: uppercase` + 大字距，
 *   在中文标题旁贴一串全大写拉丁字母——独立 critic 判为「AI 破绽·全中·最严重」档，
 *   且 critic 指出它们「光学重量几乎等于标题」，两者在互抢。
 *  处置：尾字**信息保留**（英文名仍显示），只去掉全大写与大字距。
 *  本闸把它锁死，防以「排版规范」为名加回。 */
test('★禁全大写拉丁 eyebrow（AI 破绽，防回流）', () => {
  // ★范围＝枚举出的全部 .css（见文件头 cssFiles 说明）：原点名清单漏了 motion 之外
  //   的六个已入库样式表，且含已删的 intake.css。
  assert.ok(cssFiles.length > 0, 'styles/ 枚举为空 ⇒ 这道扫描已空跑，失去意义');
  const offenders = [];
  for (const f of cssFiles) {
    const t = readStyle(f);
    if (/text-transform:\s*uppercase/.test(t)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], '仍有 text-transform:uppercase：' + offenders.join(','));
});

/** ★八轮第二改：DeviationBar 必须在场且语义正确。
 *  病象：旧 MiniGauge 把「弧越长」画成「越好」，而 Brier 是误差（越小越好）——
 *   弧长 0.192/0.25 看着「快满格」，实际是「比无信息线好 0.058」。图形替数字说反话。
 *   且同一仪表在一页画了 7 次。本闸锁「偏差条已取代仪表」。
 *
 *  ★2026-09-30 口径修正：`charts/DeviationBar.tsx` 与 `charts/ReadoutCard.tsx`
 *   随死页面源码一起删除 ⇒ 顶层 readFileSync ENOENT ⇒ 本条闸红（实测 'test failed'）。
 *   **纪律没消失，只换了落点**：产品里现在唯一画「相对基准的偏差」的组件是
 *   `charts/BiasStrip.tsx`（偏流条），它逐条继承了原闸要守的三件事——
 *     ① 基准当零轴：BiasStrip.tsx:77-78 把「无信息线 0.25」画成零轴，
 *        且在 aria 与轴标里都写明这条线是基准（原闸的 `baseline`）；
 *     ② 两个方向分得开：`is-under`／`is-over`（＝劣于／优于基准，BiasStrip.tsx:93）；
 *        注意它**不靠颜色单独承载**——图注 .bias-key 同时给出文字（:111-112）；
 *     ③ 有无障碍完整读法：`aria-label` 里逐项报出总数／够不够／断线含义（:69-72）。
 *   第四件「不许回到半圆仪表」也保留，但改按「仪表模块不许回来」断言：
 *   原闸那句 `ReadoutCard 仍用 MiniGauge` 读的是两个都已删除的文件，
 *   对着空气断言等于没断言。改钉在**模块存在性**上才拦得住真回流。
 *   （与 charts/charts.test.mjs:207「死图表模块不许回来」是同一纪律的两处落点，
 *   故意留冗余——「不许回来」这类闸单点失守的代价太高。） */
test('★偏差条在位（禁半圆仪表回流：弧长语义与误差相反）', () => {
  assert.ok(css.length > 0);
  // 本文件顶部的 `css` 是 tokens.css；图表样式在 charts.css，别拿 token 表去搜图表类名
  const chartsCss = readFileSync(new URL('./charts.css', import.meta.url), 'utf8');
  const bias = readFileSync(new URL('../charts/BiasStrip.tsx', import.meta.url), 'utf8');
  // ① 基准当零轴
  assert.ok(bias.includes('bias-axis'), '偏差条须把基准画成零轴（原闸的 baseline）');
  assert.ok(bias.includes('无信息线'), '零轴是「无信息线」这条基准，不是一根随便的横线');
  assert.ok(chartsCss.includes('.bias-axis'), '零轴缺样式（画了也没画出来）');
  // ② 优于/劣于基准两种状态分得开，且不靠颜色单独承载
  assert.ok(bias.includes("'is-under'") && bias.includes("'is-over'"), '须区分劣于/优于基准两种状态');
  assert.ok(bias.includes('bias-key'), '两态须在图注里各带一条文字记号（只靠颜色＝色觉障碍读不出）');
  assert.ok(/比 0\.25 小/.test(bias) && /比 0\.25 大/.test(bias), '图注须把两态写成句子里的话');
  // ③ 无障碍完整读法
  assert.ok(bias.includes('aria-label'), '须有无障碍完整读法（不靠颜色单独承载）');
  // ④ 半圆仪表不许回来（模块存在性 + 活代码引用双查）
  assert.equal(existsSync(new URL('../charts/Gauge.tsx', import.meta.url)), false,
    'Gauge 回来了——弧长语义与误差相反的老病象会跟着回来');
  const chartFiles = readdirSync(new URL('../charts/', import.meta.url));
  assert.equal(chartFiles.some((f) => /MiniGauge/.test(f)), false, 'MiniGauge 回来了');
  for (const f of chartFiles.filter((f) => /\.tsx?$/.test(f))) {
    const t = readFileSync(new URL('../charts/' + f, import.meta.url), 'utf8');
    assert.equal(/MiniGauge/.test(t), false, 'charts/' + f + ' 又用上了 MiniGauge（半圆仪表）');
  }
});

/** ★八轮第二改：动效须守 find-animation-opportunities 的四道门。
 *  门①频率：核心导航属「每天 100+ 次」档 ⇒ 原文判定「Reject. No animation. Ever.」
 *  门②目的：六项合法目的之外（"仪器自检感"不在其中）⇒ 删。
 *  病象：page-power-on（340ms 通电仪式）+ scanline 每次开页必播，频次门违规。
 *  本闸锁「不得回流」。 */
test('★动效守频次门（禁页面通电仪式与扫描线回流）', () => {
  // ★只查代码区：注释里说明「为何删除」是必要留痕，不得被当成回流
  const raw = readFileSync(new URL('./motion.css', import.meta.url), 'utf8');
  const m = raw.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('/*') && !l.trim().startsWith('//')).join('\n');
  assert.equal(/page-power-on/.test(m), false, 'page-power-on 已删（核心导航属 100+/day 档，永不动效）');
  assert.equal(/scan-sweep/.test(m), false, '扫描线已删（每次开页必播的纯装饰）');
  assert.ok(m.includes('page-settle'), '应保留近乎无感的 120ms 落定（属「防突兀变化」）');
  // 留存的动效必须都尊重 reduced-motion
  assert.ok(m.includes('prefers-reduced-motion'), '缺 prefers-reduced-motion（交付底线）');
});

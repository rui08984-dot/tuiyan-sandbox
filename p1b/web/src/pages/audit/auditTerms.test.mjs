import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * ★口径变更留痕（2026-09-30）：本文件原先逐条 readFileSync('./AuditPage.tsx') 断言审计页的术语纪律。
 *   死页源码（AuditPage.tsx / OverviewPage.tsx）**已从磁盘删除**——实测 `pages/audit/` 现在只剩本文件，
 *   git status 两条 D。⇒ 原第 5 行 readFileSync 直接 ENOENT，5 个用例全灭。
 *
 * 改的是断言的**写法**，不是它的**松紧**（先例：pages/disclosure/disclosureUx.test.mjs 第四道闸，
 *   那里对同一件事做过同款改写并留了痕）。逐条去向：
 *
 *   原① 审计页已接入 Term 组件          → 新① Term 渐进披露机制改由**活页**承载（披露页 + 记一笔页）
 *   原② 关键术语已接入（裸奔清零）      → 新② 那 8 个 id 随页退役（实测无活载体，见下）；改为锁死
 *                                            「已退役」＋「不许复活」两件新事实
 *   原③ 人话与专业词并存（未删术语）    → 新③ 并存性改在**全活页**上验（接手页出人话，披露页出专业词）
 *   原④ 不确定性文案保留且未隐藏        → 新④ n<30 落在**真正接手 /audit 数据的页**上（原页已无载体）
 *   原⑤ 表头与 KV 键均已包 Term        → 新⑤ 活页实测无「<th> + <Term>」先例 ⇒ 如实记为随页退役，
 *                                            换成同意图的后继锁（不给误差值/只记方向）
 *   ——另加 新⑥：死页退役但**旧路径重定向仍在**（书签不断）
 *
 * ★为什么这 8 个 id 退役后不重新指派：它们是审计页独有的（brier / baseRate / cutoff / r4 /
 *   g2Regime / layer / resolver / wilson）。实测全仓活页里 `<Term id="` 只剩三处——
 *   NegativeResultsPage 的 bayesPrior / posteriorAgg、NotePage 的 truthAnchor——**没有一处是这 8 个**。
 *   把它们硬派给别的页＝编造一条从未存在的接线。故如实退役，不假装。
 */
const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
const whereoff = readFileSync(new URL('../WhereOffPage.tsx', import.meta.url), 'utf8');
const neg = readFileSync(new URL('../disclosure/NegativeResultsPage.tsx', import.meta.url), 'utf8');
const note = readFileSync(new URL('../NotePage.tsx', import.meta.url), 'utf8');

const deadHere = ['AuditPage.tsx', 'OverviewPage.tsx']
  .map((f) => fileURLToPath(new URL('./' + f, import.meta.url)));

test('① 术语渐进披露：Term 组件仍被活页接入（原审计页同款断言，改指活载体）', () => {
  // 与原第 8/9 行同款断言形状（import 形状 + <Term 使用），只是载体从死页换成活页。
  assert.ok(/import\s*\{[^}]*\bTerm\b[^}]*\}\s*from\s*'\.\.\/\.\.\/components\/ui'/s.test(neg), '披露负结果页未导入 Term');
  assert.ok(neg.includes('<Term'), '披露负结果页未使用 <Term');
  // ★第二载体：单点承载会让这道闸在某一页重构时整道消失，故锁两处（NotePage 是「记一笔」活页）。
  //   注意两页的 ui 导入深度不同：disclosure/ 下的 NegativeResultsPage 是 '../../components/ui'，
  //   pages/ 根下的 NotePage 是 '../components/ui'（NotePage.tsx:38）。路径写错＝这道闸自己红。
  assert.ok(/import\s*\{[^}]*\bTerm\b[^}]*\}\s*from\s*'\.\.\/components\/ui'/s.test(note), '记一笔页未导入 Term');
  assert.ok(note.includes('<Term'), '记一笔页未使用 <Term');
});

test('② 关键术语「裸奔清零」随死页退役 ⇒ 改为锁死「已退役」＋「不许复活」', () => {
  // 原断言是「这 8 个 id 必须包 Term」。死页没了 ⇒ 断言对象不存在，改为断言退役这件事本身。
  for (const f of deadHere) {
    assert.equal(existsSync(f), false, '死页源码回来了：' + f + '（路由早已重定向，组件再不被渲染）');
  }
  // ★防复活第二道：路由表也不许把它们 import 回来（不 import ⇒ tsc 不会再报 TS6133，
  //   但 import 回来意味着有人想把死页重新接线——那正是「绕回来复活」的前一步）。
  for (const dead of ['AuditPage', 'OverviewPage']) {
    assert.equal(new RegExp('import\\s+[A-Za-z]*\\s*\\{?\\s*' + dead).test(app), false,
      dead + ' 的 import 回来了（组件早已不渲染，tsc 会再报 TS6133）');
  }
});

test('③ 人话与专业词并存（未删术语）', () => {
  // 人话那一半：接手 /audit 数据的合并体仍在出「基率 / 样本不足」这两个人话词。
  assert.ok(whereoff.includes('基率'), '基率被删');
  assert.ok(whereoff.includes('样本不足'), '样本不足被删');
  // 专业词那一半：不能因为讲人话就把专业词全删了。披露页的「校准」必须仍是专业词在用。
  assert.ok(neg.includes('校准'), '专业词「校准」在披露页被删（人话与专业词不得只剩一套）');
  assert.ok(note.includes('校准'), '专业词「校准」在记一笔页被删');
});

test('④ 不确定性文案保留且未隐藏（n<30 落在真正接手 /audit 数据的页上）', () => {
  // ★载体换成 WhereOffPage：/audit 的数据现在落在它身上（App.tsx:184 重定向到 /where-off），
  //   不确定性纪律跟着数据走，比留在死页上更贴近真实曝光面。
  assert.ok(whereoff.includes('n<30') || whereoff.includes('n<30'), 'n<30 文案丢失');
  assert.ok(whereoff.includes('基率 + Wilson'), '基率人话映射丢失（引擎给了先验，界面得说人话）');
  assert.ok(whereoff.includes('不给误差值'), '「样本不足不给误差值」被删（薄格裸奔防护没了）');
});

test('⑤ 表头与 KV 键包 Term：活页实测无此先例，如实退役，换同意图后继锁', () => {
  /* 原断言：`<th><Term id="layer"` / `<th><Term id="brier"` 必须存在。
   * 退役理由（实测，非推测）：全仓活页 .tsx 里同时含 `<th` 与 `<Term` 的文件数为 **0**
   *   ——`<Term id="` 仅存于 NegativeResultsPage(:192) 与 NotePage，两处都不是表头。
   *   所以这一断言在新事实下无载体可指；按纪律不编造载体、不静默删断言，
   *   改为锁「防裸奔」的**后继形态**：薄格必须显式声明只记方向、不给误差值，
   *   而不是甩一个裸数字让人误读。 */
  assert.ok(whereoff.includes('样本不足 30'), '薄格说明丢失');
  assert.ok(whereoff.includes('没测够'), '「没测够」的人话限定被删（断线语义不得裸奔）');
  assert.ok(whereoff.includes('不参与排序'), '薄格不参与排序的声明被删');
});

test('⑥ ★新事实：死页源码已删，但旧路径的重定向路由仍在（书签不断）', () => {
  // 删源码 ≠ 删路由。原 App.tsx 留痕写明「旧路径的 Route 必须留着（书签不断）」——
  //   源码退役之后，这条留痕只剩这道闸守着。
  assert.ok(/<Route path="\/audit" element=\{<Navigate to="\/where-off" replace \/>\} \/>/.test(app),
    '/audit 未重定向到 /where-off（书签会断）');
  assert.ok(/<Route path="\/overview" element=\{<Navigate to="\/where-off" replace \/>\} \/>/.test(app),
    '/overview 未重定向到 /where-off（书签会断）');
  // 落地页必须实挂真组件，不是重定向到自己或落到 *
  assert.ok(/<Route path="\/where-off" element=\{<WhereOffPage \/>\} \/>/.test(app), '落地页 /where-off 未实挂 WhereOffPage');
});

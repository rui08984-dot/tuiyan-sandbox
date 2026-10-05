'use strict';
/**
 * p1b/test/capability-catalog.test.cjs —— 「能力目录」的机械自检（2026-09-30）
 *
 * ── 这份目录是什么、为什么要给它上闸 ────────────────────────────────────────
 *   `docs/mcp/CAPABILITY-CATALOG.md` 是本项目**对外**的说明书：按「用户会问什么」分四组
 *   （打分 / 记账 / 裁决 / 审计），每条能力写满五栏（用户这么说 / 它调什么 / 得到什么 /
 *   不能做什么 / 越界了怎么办），外加开头一节「你能不能连上、连上要不要钥匙」。
 *
 *   它的病象和工具表一样：**目录烂掉时没人会发现**。工具名写错、端点写错、文件路径写错、
 *   某条能力少了「不能做什么」那一栏——这些在 Markdown 里全都不刺眼，
 *   而外部调用方是**照着它接的**。所以本文件把目录里出现的每一个「可执行标识符」
 *   拿来和真源对表。
 *
 * ── 本闸守的四件事 ─────────────────────────────────────────────────────────
 *   ① **五栏齐**：每条能力（`### x.y` 级标题）必须有 ①②③④⑤ 五个栏位标记，
 *     且 ④「不能做什么」**不许为空**（空栏比没栏更坏：它看起来像有边界）。
 *   ② **标识符对得上真源**：目录里出现的每一个 `p1b_*` 工具名、`/api/...` 端点、
 *     「组 命令」CLI 对、仓内文件路径，都必须**真的存在**。
 *   ③ **每条能力有真跑过的示例**：每个能力块至少一个 ```console 围栏，
 *     且全文**不许**出现「示例省略」「类似地」这类搪塞词。
 *   ④ **令牌门那一节不许被删**：它是前两轮盘点漏掉的那条（共享令牌门 ＋ 拒绝启动组合），
 *     删掉它「对外」这个问题就没答完整。
 *
 * ── 关于「不许空跑绿灯」 ───────────────────────────────────────────────────
 *   ②③ 两组断言是**遍历型**的：它们的绿灯完全取决于「提取到了东西」。
 *   所以每组前面都有一条**同级前置断言**先把「提取非空」钉死
 *   （`提取到 N 个标识符` ＋ `至少 1 个`），并把实际条数报出来。
 *   没有这个前置，判据从「全部对得上」退化成「数组为空时全部通过」。
 *
 * 零写库、零网络、零子进程：本文件只 require `p1b/mcp/tools.cjs` 与
 * `p1b/cli/commands.cjs`，前者对 p1a.db 零接触。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DOC = path.join(ROOT, 'docs', 'mcp', 'CAPABILITY-CATALOG.md');
const CATALOG_REL = 'docs/mcp/CAPABILITY-CATALOG.md';

const tools = require(path.join(ROOT, 'p1b', 'mcp', 'tools.cjs'));
const C = require(path.join(ROOT, 'p1b', 'cli', 'commands.cjs'));

// ── 真源清单（跑测试时现取，不写死条数；条数由前置断言单独钉）────────────────

/** 工具名全集：默认注册 21 条；关掉联机闸时少一条。 */
function realToolNames() {
  return tools.listTools().map((t) => t.name);
}

/**
 * HTTP 端点全集：扫 `app.get/post/put/delete('…')` 的**字面量**注册。
 * 扫不到非字面量路径（本仓实测零个），所以这份清单是完整的；
 * 真扫不完整这件事由「取不到就抛」保证，而不是悄悄返回空数组。
 */
function realRoutes() {
  const dirs = [path.join(ROOT, 'p1b', 'src', 'server.js')];
  const rdir = path.join(ROOT, 'p1b', 'src', 'routes');
  for (const f of fs.readdirSync(rdir)) {
    if (f.endsWith('.js')) dirs.push(path.join(rdir, f));
  }
  const out = [];
  const re = /app\.(get|post|put|delete)\(\s*'([^']*)'/g;
  for (const f of dirs) {
    const src = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = re.exec(src)) !== null) out.push(m[2]);
  }
  if (!out.length) throw new Error('HTTP 端点扫描取到 0 条 ⇒ 真源变了或扫描口径失效，不许当「没查到」放过');
  return out;
}

/** CLI 命令对全集：`组 中文名`（18 条，投影自 commands.cjs）。 */
function realCliPairs() {
  return C.allCommands().map((c) => c.group.zh + ' ' + c.zh);
}

const FIVE_COLS = ['① 用户这么说', '② 它调什么', '③ 得到什么', '④ 不能做什么', '⑤ 越界了怎么办'];

/** 四组的编号（§0 是「连接前提」，§5+ 是附录，**都不是能力条目**）。 */
const GROUP_NUMS = ['1', '2', '3', '4'];

/**
 * 把目录切成**能力块**：只取四组下面的 `### N.y …`（N ∈ 1..4）。
 * ★必须按组号过滤：`### 0.x`（连接前提的小节）**不是能力条目**，
 *   拿它去要求「五栏齐」会得到一条永远红的假断言；而把它静默算进来，
 *   又会让「提取到多少条」这个数失真 ⇒ 前置断言就失去了意义。
 */
function capabilityBlocks(md) {
  const lines = md.split('\n');
  const heads = [];
  lines.forEach((ln, i) => {
    const m = /^###\s+(\d+)\.\d+\s/.exec(ln);
    if (m && GROUP_NUMS.indexOf(m[1]) >= 0) heads.push(i);
  });
  const out = [];
  for (let i = 0; i < heads.length; i++) {
    const from = heads[i];
    const to = i + 1 < heads.length ? heads[i + 1] : lines.length;
    out.push({ title: lines[from].trim(), from: from + 1, to: to, body: lines.slice(from + 1, to).join('\n') });
  }
  return out;
}

function readDoc() { return fs.readFileSync(DOC, 'utf8'); }

// ════════════════════════════════════════════════════════════════════

test('目录件在位：存在、非空、UTF-8、LF 行尾', () => {
  assert.ok(fs.existsSync(DOC), CATALOG_REL + ' 不存在');
  const raw = fs.readFileSync(DOC);
  assert.ok(raw.length > 4000, '目录只有 ' + raw.length + ' 字节 ⇒ 像是空壳');
  const md = raw.toString('utf8');
  // 往返一次还能读回原串 ⇒ 没有 BOM / 没有非法 UTF-8 序列被替换
  assert.equal(Buffer.from(md, 'utf8').toString('utf8'), md, '不是合法 UTF-8（可能有 BOM 或坏字节）');
  assert.notEqual(md.charCodeAt(0), 0xfeff, '文件带 BOM');
  assert.equal(raw.indexOf(0x0d), -1, '文件含 CR：行尾必须是 LF');
  assert.match(md, /^# /, '第一行不是一级标题');
});

test('四组齐：打分 / 记账 / 裁决 / 审计', () => {
  const md = readDoc();
  const groups = ['打分', '记账', '裁决', '审计'];
  // ★前置：真的按「用户会问什么」分了组（不是按代码目录分）
  // ★`m` 旗标不能少：标题在第 200 行以后，没有 `m` 时 `^` 只锚首行 ⇒ 全部漏匹配。
  for (const g of groups) {
    assert.match(md, new RegExp('^##\\s+\\d+\\.\\s*分组[：:]\\s*' + g, 'm'), '缺分组节：' + g);
  }
  const heads = md.split('\n').filter((l) => /^##\s+\d+\.\s*分组/.test(l));
  assert.strictEqual(heads.length, 4, '分组节数应为 4，实测 ' + heads.length + '：' + heads.join(' / '));
});

test('★令牌门一节在位：连不连得上 / 要不要钥匙 / 拒绝启动组合，三条都答了', () => {
  const md = readDoc();
  const h = md.indexOf('## 0.');
  assert.ok(h >= 0, '缺第 0 节（连接前提）');
  const sec = md.slice(h, md.indexOf('\n## 1.'));
  assert.ok(sec.length > 800, '第 0 节只有 ' + sec.length + ' 字符 ⇒ 像是没答完整');
  for (const kw of ['P1B_SHARED_TOKEN', 'x-p1b-token', '401', '拒绝启动', 'P1B_HOST', '静态资源']) {
    assert.ok(sec.includes(kw), '第 0 节没答到：' + kw);
  }
});

test('每条能力五栏齐，且「不能做什么」不许空', () => {
  const md = readDoc();
  const blocks = capabilityBlocks(md);
  // ★前置：遍历型断言不许空跑 —— 先钉死「真提取到能力块，且数量够」
  assert.ok(blocks.length >= 10, '只提取到 ' + blocks.length + ' 个能力块（期望 ≥10）⇒ 切分口径失效');
  for (const b of blocks) {
    for (const col of FIVE_COLS) {
      assert.ok(b.body.includes(col), b.title + ' 缺栏位「' + col + '」');
    }
    // ④ 不许空：取到「④ 不能做什么」那一行，到下一个栏位或块尾之间的内容必须有实质文字
    const i4 = b.body.indexOf('④ 不能做什么');
    const rest = b.body.slice(i4 + '④ 不能做什么'.length);
    const stop = Math.min(...['⑤ 越界了怎么办', '```'].map((k) => {
      const j = rest.indexOf(k);
      return j < 0 ? rest.length : j;
    }));
    const cell = rest.slice(0, stop).replace(/^\s*\|/, '').replace(/\|/g, '').trim();
    assert.ok(cell.length >= 20, b.title + ' 的「④ 不能做什么」几乎是空的（' + cell.length + ' 字符）');
  }
});

test('每条能力都带一个真跑过的示例围栏；全文无搪塞词', () => {
  const md = readDoc();
  const blocks = capabilityBlocks(md);
  // ★前置
  assert.ok(blocks.length >= 10, '只提取到 ' + blocks.length + ' 个能力块 ⇒ 切分口径失效');
  let fences = 0;
  for (const b of blocks) {
    const n = (b.body.match(/```console/g) || []).length;
    fences += n;
    assert.ok(n >= 1, b.title + ' 没有 ```console 示例围栏 ⇒ 这条能力没有可跑的示例');
  }
  assert.ok(fences >= blocks.length, '示例围栏总数 ' + fences + ' < 能力块数 ' + blocks.length);
  for (const bad of ['示例省略', '类似地', '以此类推', 'TODO', '待补']) {
    assert.equal(md.includes(bad), false, '目录里出现搪塞/占位词：' + bad);
  }
  // ★自指陷阱（真踩过）：目录里**不能**把这串搪塞词抄出来解释这条断言
  //   ——抄出来就会被上面同一条断言照红。所以目录只写「清单在测试文件里」。
});

/**
 * 目录里出现的 `p1b_*` 串，**不全是工具名** —— 有两个是故意写的非工具：
 *   · `p1b_token` ＝ 共享令牌的 Cookie / 查询串名（`server.js:60`），
 *   · `p1b_no_such_tool` ＝ §0.4 里「叫一个不存在的工具会怎样」那个反例。
 * 放行它们必须**逐个列出并说明理由**，不能写成「排除含 token/no_such 的」——
 * 那种正则豁免下次换个名字就绕过去了。
 */
const NOT_TOOL_NAMES = new Set(['p1b_token', 'p1b_no_such_tool']);

test('目录里的每个 MCP 工具名都真存在（遍历不空跑）', () => {
  const md = readDoc();
  const names = Array.from(new Set(md.match(/p1b_[a-z0-9_]+/g) || []))
    .filter((n) => !NOT_TOOL_NAMES.has(n));
  // ★前置：先把「提取非空」钉死，否则「空数组全部通过」＝ 假绿
  assert.ok(names.length >= 21, '只从目录提取到 ' + names.length + ' 个工具名（期望 ≥21）⇒ 提取口径失效');
  const real = new Set(realToolNames());
  // ★再钉一次真源：真源本身不许为空
  assert.ok(real.size >= 20, 'tools/list 只返回 ' + real.size + ' 条 ⇒ 真源侧出问题');
  const bad = names.filter((n) => !real.has(n));
  assert.deepEqual(bad, [], '目录里引用了不存在的工具：' + bad.join(', '));
  // 反向：21 条一条都不许从目录里消失（漏写比写错更难发现）
  const missing = Array.from(real).filter((n) => !names.includes(n));
  assert.deepEqual(missing, [], '目录漏掉了这些工具：' + missing.join(', '));
});

test('目录里的每个 /api 端点都真注册（遍历不空跑）', () => {
  const md = readDoc();
  const paths = Array.from(new Set(md.match(/\/api\/[A-Za-z0-9_:/-]+/g) || []))
    // 形如 `/api/analytics/*` 的**通配写法**（§0.1 的计数说明里用），不是一条具体端点
    .filter((p) => p !== '/api/analytics/');
  // ★前置
  assert.ok(paths.length >= 15, '只从目录提取到 ' + paths.length + ' 个端点（期望 ≥15）⇒ 提取口径失效');
  const real = realRoutes();
  assert.ok(real.length >= 50, '路由扫描只取到 ' + real.length + ' 条 ⇒ 扫描口径失效');
  // 目录里给的是**实例化**路径（`/api/baseline/openmeteo_daily_max`、
  // `/api/predictions/2010/resolve`），真源里是**模板**（`/api/baseline/:kind`）。
  // ⇒ 逐条按模板匹配：`:参数` 段吃任意单段。这样「端点根本不存在」照样红，
  // 而「参数填了什么」不由本闸裁决（那是 §5 的读者责任）。
  const tmpl = real.map((r) => {
    const re = r.split('/').map((seg) => (seg.charAt(0) === ':' ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    return new RegExp('^' + re.join('/') + '$');
  });
  const bad = paths.filter((p) => !tmpl.some((re) => re.test(p)));
  assert.deepEqual(bad, [], '目录里引用了未注册的端点：' + bad.join(', '));
});

test('目录里的每个「组 命令」CLI 对都真存在（遍历不空跑）', () => {
  const md = readDoc();
  const groups = ['体检', '结算', '读数', '门禁', '备份'];
  const cmds = new Set(C.allCommands().map((c) => c.zh));
  const pairs = [];
  for (const g of groups) {
    for (const c of cmds) {
      const token = g + ' ' + c;
      if (md.includes(token)) pairs.push(token);
    }
  }
  // ★前置
  assert.ok(pairs.length >= 10, '只匹配到 ' + pairs.length + ' 个 CLI 对（期望 ≥10）⇒ 匹配口径失效');
  const real = new Set(realCliPairs());
  const bad = pairs.filter((p) => !real.has(p));
  assert.deepEqual(bad, [], '目录里引用了不存在的 CLI 命令：' + bad.join(', '));
});

test('目录里的每个仓内文件路径都真在盘上（遍历不空跑）', () => {
  const md = readDoc();
  // ★扩展名按长度降序排：`js` 排在 `json` 前面会把 `…-r4.json` 截成 `…-r4.js`。
  const raw = md.match(/(?:p1b|p1a-terminal|docs)\/[A-Za-z0-9_./一-鿿-]+\.(?:mts|mjs|cjs|json|md|db|js)/g) || [];
  const paths = Array.from(new Set(raw));
  // ★前置
  assert.ok(paths.length >= 20, '只从目录提取到 ' + paths.length + ' 个文件路径（期望 ≥20）⇒ 提取口径失效');
  const missing = paths.filter((p) => !fs.existsSync(path.join(ROOT, p)));
  assert.deepEqual(missing, [], '目录里引用了不存在的文件：' + missing.join(', '));
});

test('四组各至少有一条「当库用」（require 即用的最短路）', () => {
  const md = readDoc();
  const blocks = capabilityBlocks(md);
  // 按组切：每个「## N. 分组：X …」到下一个分组节或文末。
  // ★末尾**不锚定 `$`**：真实标题带副标题（`## 1. 分组：打分 —— 「我判得准不准」`），
  //   锚死 `$` 会让这一组静默解析成 0 个 —— 那种绿灯是假的。
  const secRe = /^##\s+\d+\.\s*分组[：:]\s*(打分|记账|裁决|审计)/gm;
  const marks = [];
  let m;
  while ((m = secRe.exec(md)) !== null) marks.push({ g: m[1], i: m.index });
  // ★前置
  assert.strictEqual(marks.length, 4, '分组节解析到 ' + marks.length + ' 个（期望 4）');
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i].i;
    const to = i + 1 < marks.length ? marks[i + 1].i : md.length;
    const sec = md.slice(from, to);
    assert.ok(sec.includes('当库用'), '分组「' + marks[i].g + '」里没有任何一条走「当库用」');
    // 而且必须真的给出可 require 的模块路径，不是只写三个字
    assert.ok(/require\(/.test(sec) || /当库用（真跑/.test(sec),
      '分组「' + marks[i].g + '」的「当库用」没有给出可跑的 require 示例');
  }
  assert.ok(blocks.length >= 10, '能力块提取只有 ' + blocks.length + ' 个');
});

test('★发行闸 C3 同款：目录里没有「看起来像真端点」的非本机 IPv4', () => {
  const md = readDoc();
  // ★前置：非空（否则「零命中」会被读成「通过」）
  assert.ok(md.length > 4000, '目录为空 ⇒ C3 扫描退化成空跑');
  // 口径照 `p1b/scripts/audit-release.cjs:60-79` 的 C3_分类：只判「像连接目标的」IPv4
  // （前文带 `://`、或后文带 `:端口`、或前文带 `userinfo@`），散文里的网段字面量不判红。
  const IPV4 = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g;
  const OK_IP = new Set(['127.0.0.1', '0.0.0.0']);
  const hits = [];
  md.split('\n').forEach((ln, i) => {
    IPV4.lastIndex = 0;
    let m;
    while ((m = IPV4.exec(ln)) !== null) {
      const s = m[0];
      if (OK_IP.has(s)) continue;
      const pre = ln.slice(Math.max(0, m.index - 14), m.index);
      const post = ln.slice(m.index + s.length, m.index + s.length + 14);
      if (/^\s*\/\d{1,2}\b/.test(post)) continue;   // `x.x.x.0/16` 网段定义
      if (/\/\/$/.test(pre) || /:\d{2,5}/.test(post) || /[A-Za-z0-9._-]+@$/.test(pre)) {
        hits.push((i + 1) + ' 行：' + s);
      }
    }
  });
  assert.deepEqual(hits, [], '目录里写了像真端点的内网 IP（C3 会照红）：\n  ' + hits.join('\n  '));
});

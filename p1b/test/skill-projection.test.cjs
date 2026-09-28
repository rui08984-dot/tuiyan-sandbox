'use strict';
/**
 * p1b/test/skill-projection.test.cjs —— SKILL 文档的**投影锁**（2026-09-28）
 *
 * 本件的角色：`p1b/skill/` 是给 LLM 读的说明书，**它的每一个字都必须能在代码里找到出处**。
 * 说明书最危险的失效模式不是「写得不清楚」，而是「写了一个不存在的命令 / 写错了档位 /
 * 引用了一个不存在的文件行」——LLM 读说明书是为了照着跑，跑不通就等于没写，
 * 而**读起来完全通顺的假命令比明显的错更致命**（agent 不会怀疑一份格式正确的文档）。
 * ⇒ 本件把说明书**钉死在真源上**：改了代码不改文档、或写了文档不改代码，本件立刻打红。
 *
 * ── 三条断言（缺一条就等于没锁）──────────────────────────────────────────
 *   ① **命令投影**：SKILL 与 references 里**每一条 `node p1b/cli …` 调用**的两个 token，
 *      都必须能被 CLI 自己的路由 `resolveCommand()` 解析出来。编一个命令名即红。
 *      （用 `resolveCommand` 而不是自建名字表 ⇒ 判据与运行时**同一份代码**，不会各说各话。）
 *   ② **档位投影**：SKILL 的档位表逐行比对 `commands.cjs` 的 `c.tier`，
 *      且**只允许 R/F/W 三个字母**（`cli.test.cjs:120` 已把这条钉在命令表侧）。
 *      写错一档（R 写成 F）会让 agent 把只读件当写盘件、或反之。
 *   ③ **引用投影**：SKILL 与 references 里**每一条 `路径:行号`** 引用的文件都必须在仓库里真实
 *      存在，且行号不得超出该文件行数。编一个 `p1b/scripts/xxx.cjs:999` 即红。
 *
 * ── 为什么本件不 require p1b/scripts 下的任何脚本 ────────────────────────
 *   口径见 `scripts-require-safety.test.cjs:40`（测试里出现「`const <名> =
 *   path.join(ROOT,'p1b','scripts','<x>.cjs')` 且同文件再 require 它」即算命中）。
 *   本件只 require `p1b/cli/commands.cjs`（纯数据表）与 `p1b/cli/index.cjs`（纯路由，
 *   `index.cjs:283` 的 `require.main === module` 守卫使模块加载零副作用），
 *   对 `p1b/scripts/**` **连模块加载都不做**——一律走 `fs.readFileSync` 读文本。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const CLI_DIR = path.join(ROOT, 'p1b', 'cli');
const SKILL_DIR = path.join(ROOT, 'p1b', 'skill');
const SKILL_MD = path.join(SKILL_DIR, 'SKILL.md');
const REFS = ['forecast.md', 'gate.md', 'leak.md', 'dueof.md']
  .map((f) => path.join(SKILL_DIR, 'references', f));

// 纯数据 / 纯路由模块，零 db、零写盘、零网络。
const C = require(path.join(CLI_DIR, 'commands.cjs'));
const { resolveCommand } = require(path.join(CLI_DIR, 'index.cjs'));

/** 全部受检文档的 {name, text}；缺件即红（这是「先红后绿」的那盏红灯本身）。 */
function docs() {
  const files = [SKILL_MD].concat(REFS);
  const out = [];
  for (const f of files) {
    assert.ok(fs.existsSync(f), 'SKILL 文档缺失：' + path.relative(ROOT, f).split(path.sep).join('/')
      + '（本件是它的投影锁：文档不在，锁无从谈起）');
    out.push({ name: path.relative(ROOT, f).split(path.sep).join('/'), text: fs.readFileSync(f, 'utf8') });
  }
  return out;
}

/** `node p1b/cli <a> [<b>]` 的调用行；跳过 `--help` / 占位符 / 续行提示。 */
const INVOKE_RE = /node\s+p1b\/cli\s+([^\s`|)]+)(?:\s+([^\s`|)]+))?/g;

test('① 命令投影：文档里每条 CLI 调用都能被 CLI 自己的路由解析（编命令即红）', () => {
  const bad = [];
  const seen = new Set();
  let total = 0;

  for (const d of docs()) {
    INVOKE_RE.lastIndex = 0;
    let m;
    while ((m = INVOKE_RE.exec(d.text)) !== null) {
      const a = m[1];
      const b = m[2];
      if (a.startsWith('-')) continue;                       // `node p1b/cli --help`
      // 尖括号是本仓文档自带的位置参数占位记号（`node p1b/cli <组> <命令> [位置参数…]`），
      // 不是命令名 ⇒ 两个位置上都跳过。漏掉这一条会把**用法模板**误判成**编造的命令**。
      if (a.startsWith('<')) { total++; continue; }
      if (b !== undefined && (b.startsWith('-') || b.startsWith('<'))) { total++; continue; }
      const r = resolveCommand(a, b);
      total++;
      if (!r.cmd) {
        bad.push(d.name + ': `node p1b/cli ' + a + (b ? ' ' + b : '') + '` 解析不到命令'
          + (r.unknown ? '（未知 token：' + r.unknown + '）' : r.ambiguous ? '（不唯一，要带组名）' : '（组内无此命令）'));
      } else {
        seen.add(r.group.zh + ' ' + r.cmd.zh);
      }
    }
  }

  assert.ok(total >= 10, '受检调用样本太少（' + total + ' 条），抽取口径可能已失效');
  assert.deepEqual(bad, [], '以下调用在 CLI 里不存在：\n  ' + bad.join('\n  '));

  // 覆盖面：SKILL.md 自身必须把 18 条命令全部写到（漏写一条 = agent 永远不知道它存在）
  const skill = docs()[0].text;
  const missing = C.allCommands()
    .map((c) => c.group.zh + ' ' + c.zh)
    .filter((k) => !skill.includes(k.split(' ')[0] + ' ' + k.split(' ')[1]));
  assert.deepEqual(missing, [], 'SKILL.md 未提到这些命令：' + missing.join('、'));
  assert.ok(seen.size >= 10, '实测到的不同命令数偏少：' + seen.size);
});

test('② 档位投影：SKILL 的档位表逐行等于 commands.cjs，且只出现 R/F/W', () => {
  const skill = docs()[0].text;

  // 只认「表格行」这一种形态：`| 命令 | 档位 | 用途 |`。
  // 行内散文里的 R/F/W 是叙述，不参与比对——否则「R 档透传写旗只会提醒不拦」这类
  // 说明句会被误当成一条命令的档位声明。
  const rows = new Map();
  for (const line of skill.split(/\r?\n/)) {
    const cells = line.split('|').map((s) => s.trim()).filter((s) => s.length);
    if (cells.length < 3) continue;
    const zh = cells[0].replace(/\*\*/g, '');
    const tierCell = cells[1].replace(/\*\*/g, '');
    const m = /^([RFW])/.exec(tierCell);
    if (!m) continue;
    const c = C.allCommands().find((x) => x.zh === zh);
    if (!c) continue;                       // 不是命令行（如「—」「R 只读｜…」说明行）
    assert.ok(!rows.has(zh), '档位表里「' + zh + '」出现了两行');
    rows.set(zh, m[1]);
  }

  assert.ok(rows.size >= 15, '档位表只认出 ' + rows.size + ' 行，抽取口径可能已失效');
  for (const [zh, tier] of rows) {
    const c = C.allCommands().find((x) => x.zh === zh);
    assert.equal(tier, c.tier, '「' + c.group.zh + ' ' + zh + '」在 SKILL.md 里写成 ' + tier
      + ' 档，commands.cjs 里是 ' + c.tier + ' 档');
  }

  // 全文档白名单：只允许 R / F / W 三个档位字母。「N 打网」是 net 标记、不是第四档，
  // 写成 N 档一律打红（这正是最容易犯的那个错）。
  for (const d of docs()) {
    const hits = [];
    const re = /档位[^\n|]{0,6}?([A-Z])(?![A-Za-z])/g;
    let m;
    while ((m = re.exec(d.text)) !== null) hits.push(m[1]);
    assert.deepEqual(hits.filter((x) => !'RFW'.includes(x)), [],
      d.name + ' 出现了 R/F/W 之外的档位字母：' + hits.filter((x) => !'RFW'.includes(x)).join(','));
  }
});

test('③ 引用投影：每条 `路径:行号` 的文件都真实存在、行号在范围内（编引用即红）', () => {
  // ★路径字符类**必须含 CJK**：本仓的引用里就有 `docs/specs/万物分类清单-v2.md:6` 这种带中文的
  //   冻结件名，而 JS 的 `\w` 只认 `[A-Za-z0-9_]` ⇒ 用 `[\w./-]` 会让**所有中文路径的引用被静默跳过**，
  //   锁看着在跑、实际没锁住那一半（2026-09-28 首版就是这么漏的：变异测试注入
  //   `p1b/scripts/根本不存在的件.cjs:12` 竟然还是绿的）。
  //   字符类只放 路径字符（. - word）＋ CJK 汉字区（U+4E00–U+9FFF），
  //   **不含 CJK 标点**（U+3000 区 / 全角区）⇒ 句末的 `）`、顿号、句号不会粘进路径。
  const CITE_RE = /(?<![\w.\/-])((?:p1a|p1b|docs|tools|scripts|\.scratch)[-.\/\w一-鿿]*\.(?:cjs|js|mjs|json|md|ts|tsx|html|sql|batch|log|txt|db)):(\d+)(?:[-–](\d+))?/g;
  const bad = [];
  const checked = new Map();
  let total = 0;

  for (const d of docs()) {
    CITE_RE.lastIndex = 0;
    let m;
    while ((m = CITE_RE.exec(d.text)) !== null) {
      total++;
      const rel = m[1];
      const line = Number(m[2]);
      const line2 = m[3] ? Number(m[3]) : null;
      const abs = path.join(ROOT, rel);
      if (!fs.existsSync(abs)) { bad.push(d.name + ': 文件不存在 → ' + rel + ':' + m[2]); continue; }
      if (!checked.has(rel)) {
        checked.set(rel, fs.readFileSync(abs, 'utf8').split(/\r?\n/).length);
      }
      const n = checked.get(rel);
      if (line < 1 || line > n) { bad.push(d.name + ': 行号越界 → ' + rel + ':' + m[2] + '（该文件共 ' + n + ' 行）'); continue; }
      if (line2 !== null && (line2 < line || line2 > n)) {
        bad.push(d.name + ': 行号区间越界 → ' + rel + ':' + m[2] + '-' + m[3] + '（该文件共 ' + n + ' 行）');
      }
    }
  }

  assert.ok(total >= 25, '受检引用样本太少（' + total + ' 条），抽取口径可能已失效');
  assert.deepEqual(bad, [], '以下引用在仓库里落空：\n  ' + bad.join('\n  '));
});

test('④ 口径锁：不得把 exit 3 笼统写成「gate」，也不得出现「预测」二字', () => {
  for (const d of docs()) {
    // ① 铁律：exit 3 的含义随脚本而变，文档必须逐命令写明，且不得出现「3 = gate」这类概括。
    const generic = d.text.match(/3\s*[=＝]\s*(?:gate|门禁)(?!\s*(?:码|裁决|的))/gi);
    assert.equal(generic, null, d.name + ' 把 exit 3 笼统写成了 gate：' + (generic || []).join(','));

    // ② 词表：说明书里禁用「预测」二字（对外与对内一律用「读数」「判读」「到期」）。
    assert.equal(d.text.includes('预测'), false, d.name + ' 出现了「预测」二字');
  }

  // ③ 三条铁律必须在 SKILL.md 里点名，且 N 必须是 net 标记而非第四档。
  const skill = docs()[0].text;
  for (const kw of ['铁律', 'W 档', '人类', '空集']) {
    assert.ok(skill.includes(kw), 'SKILL.md 缺关键词「' + kw + '」');
  }
  assert.match(skill, /N\s*(?:是|＝|=)?\s*(?:独立|不是第四|标记)/, 'SKILL.md 必须写明 N 不是第四个档');
});

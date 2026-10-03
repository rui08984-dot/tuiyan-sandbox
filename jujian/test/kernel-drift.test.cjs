'use strict';
/**
 * jujian/test/kernel-drift.test.cjs —— ★内核漂移守卫
 *
 * ── 为什么有这个文件 ────────────────────────────────────────────────────────
 *   局鉴的领域内核是从推演沙盘 `p1b/src/` **平移**过来的，不是重写的。
 *   选平移不选重写，是因为这 6 个文件经实测是**纯逻辑**（零 db、零 http、零网络），
 *   平移的收益是零行为漂移；重写反而会把 130 个角色的语义重新冒一次险。
 *
 *   ★代价：两份代码从此可能分叉。所以必须有这道守卫 ——
 *   「复制会漂移」是事实，「复制会**静默**漂移」才是事故。
 *   本文件的作用就是把静默变成响亮：任何一侧改动而另一侧没跟，立即红。
 *
 * ── 守卫口径 ──────────────────────────────────────────────────────────────
 *   ① 5 个纯逻辑文件 + 角色数据 JSON：**必须逐字节一致**（sha256 比对）。
 *   ② `botc/roles.js`：允许且**仅允许**文件头那一段（血统声明 ＋ 数据源路径）不同，
 *      从 `const SCRIPTS` 起往下的**逻辑部分必须逐字节一致**。
 *      —— 这是本项目唯一一处「有意的差异」，把它钉死在判据里，而不是靠记忆。
 *
 * ── 脱离本仓库后怎么办 ────────────────────────────────────────────────────
 *   若局鉴被抽成独立仓、旁边不再有 `p1b/`，本文件整体 `t.skip()` 而不是失败 ——
 *   守卫的义务是「两侧都在时必须一致」，不在时无权报错。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const HERE = __dirname;
const SELF = path.join(HERE, '..');
const SANDBOX = path.join(SELF, '..');           // 推演沙盘仓库根
const P1B = path.join(SANDBOX, 'p1b', 'src');
const SANDBOX_DATA = path.join(SANDBOX, 'docs', 'sandbox', 'botc-adapt', 'data', 'roles-zh.json');

/** 两侧都在才谈漂移；只有一侧存在 ⇒ 跳过（守卫不越权）。 */
const BOTH_SIDES_PRESENT = fs.existsSync(P1B) && fs.existsSync(SANDBOX_DATA);
const skip = BOTH_SIDES_PRESENT ? false : '推演沙盘不在本工作区（局鉴已独立），漂移守卫不适用';

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/** 必须逐字节一致的纯逻辑文件：相对路径在两侧同形。 */
const IDENTICAL = [
  'botc/contradictions.js',
  'botc/extractPrompt.js',
  'botc/advisePrompt.js',
  'detectors/werewolf-contradictions.js',
  'adapters/avalon.js',
];

test('① 内核纯逻辑文件：两侧逐字节一致', { skip }, () => {
  for (const rel of IDENTICAL) {
    const mine = path.join(SELF, 'src', 'kernel', rel);
    const theirs = path.join(P1B, rel);
    assert.ok(fs.existsSync(mine), '局鉴侧缺文件: ' + rel);
    assert.ok(fs.existsSync(theirs), '沙盘侧缺文件: ' + rel);
    assert.equal(sha(mine), sha(theirs),
      `★内核漂移：${rel}\n  局鉴 ${sha(mine)}\n  沙盘 ${sha(theirs)}\n`
      + '  —— 两边都改，或把局鉴设为唯一真源并从沙盘反向引用。');
  }
});

test('② 角色数据 JSON：逐字节一致', { skip }, () => {
  const mine = path.join(SELF, 'data', 'roles-zh.json');
  assert.equal(sha(mine), sha(SANDBOX_DATA),
    '★角色数据漂移：130 个角色归一化数据两侧不一致');
});

test('③ botc/roles.js：★唯一允许的差异是文件头与数据源路径，逻辑部分必须逐字节一致', { skip }, () => {
  const mine = fs.readFileSync(path.join(SELF, 'src', 'kernel', 'botc', 'roles.js'), 'utf8');
  const theirs = fs.readFileSync(path.join(P1B, 'botc', 'roles.js'), 'utf8');

  // 逻辑锚点：数据源路径块**之后**的第一行（缓存声明）。从这里往下的每一行
  // （加载、剧本角色集、团队结构、唯一性、角色解析三口径、中文名、能力摘要、导出）
  // 两侧必须一模一样，含换行与缩进。
  //
  // ★锚点为何落在 `let _roles = null;` 而不是 `const SCRIPTS`：
  //   第一版把锚点定在 SCRIPTS，结果把「数据源路径」那三行也划进了逻辑区，
  //   而那正是本项目**唯一有意**的差异 —— 守卫当场判红，逼我把接缝说到行。
  //   这条注释留着，是为了让后来者知道锚点为什么在这里，别手贱往前挪。
  const anchor = 'let _roles = null;';
  const cut = (s) => {
    const i = s.indexOf(anchor);
    assert.notEqual(i, -1, '找不到逻辑锚点 ' + anchor + '（文件结构变了？）');
    return s.slice(i);
  };
  assert.equal(cut(mine), cut(theirs),
    '★roles.js 逻辑部分漂移：' + anchor + ' 之后的任何一行都必须两侧一致。'
    + '本项目允许的唯一差异是文件头血统声明与 ROLES_PATH 三行。');

  // 差异必须**只**落在文件头与路径块，且文件头必须自述这份差异（防止有人把差异藏进深处）。
  const myHead = mine.slice(0, mine.indexOf(anchor));
  assert.match(myHead, /JUJIAN_BOTC_ROLES_PATH/,
    '局鉴侧文件头未声明 JUJIAN_BOTC_ROLES_PATH —— 有意的差异必须写在文件头上');
  assert.match(myHead, /roles-zh\.json/,
    '局鉴侧文件头未声明自有数据源路径');
  // 反向：局鉴侧不得再指回沙盘的 docs/ 目录（那会让「独立」名不副实）。
  assert.doesNotMatch(mine, /'docs',\s*'sandbox'/,
    '★局鉴侧 roles.js 仍指向沙盘的 docs/sandbox 数据目录 —— 独立项目不得回指沙盘');
});

test('④ 内核不得偷偷引入 db / http / 网络依赖', () => {
  // 这条不依赖沙盘，是局鉴自己的架构纪律：内核保持可单测、可离线跑。
  const banned = [
    { re: /require\(\s*['"][^'"]*deps[^'"]*['"]\s*\)/, why: 'p1b 的 deps（会拖回沙盘）' },
    { re: /require\(\s*['"][^'"]*better-sqlite3['"]\s*\)/, why: '数据库驱动（内核必须纯）' },
    { re: /\bhttps?\.(get|request)\s*\(/, why: '出网调用（内核必须纯）' },
    { re: /\bfetch\s*\(/, why: 'fetch 调用（内核必须纯）' },
  ];
  for (const rel of ['botc/roles.js', ...IDENTICAL]) {
    const src = fs.readFileSync(path.join(SELF, 'src', 'kernel', rel), 'utf8');
    for (const b of banned) {
      assert.doesNotMatch(src, b.re, `内核 ${rel} 出现了被禁依赖：${b.why}`);
    }
  }
});

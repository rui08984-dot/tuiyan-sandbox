'use strict';
/**
 * p1b/test/readme.test.cjs —— 根 README 与演示路径的守卫（readme 模块 · 2026-09-30）
 *
 * 它守的是什么：README 是陌生人**看到的第一个字**，也是别人决定「能不能用」的依据。
 * 所以这里守的不是排版，是**承诺**：
 *   ① 承诺的命令能跑（★最致命的一处：陌生人第一步就撞上）
 *   ② 8 条红线逐条在（别人靠它判断能不能用）
 *   ③ 平台表只写验过的（没验的写上去就是撒谎）
 *   ④ 没有试用倒计时 / 准确率承诺 / 推荐语（一句就能被击穿）
 *   ⑤ 首屏句与 npm description **不是同一句**（一个被阅读，一个被检索）
 *
 * ★三条自证纪律（同 audit-release.test.cjs）：
 *   ① **反向锁逐条单独注入**：命令改成不存在的脚本名 ⇒ ④ 必须红。
 *   ② **循环必须留下执行痕迹**：每条带循环的断言前，都有同级的「确实抽到了 N 个」前置断言
 *      ——抽出 0 个再逐个断言全过，就是空跑绿灯。
 *   ③ 判据函数从 dist.test.mjs **派生**禁词表，不另立清单（另立＝迟早漂移）。
 *
 * ★本件只读：不起端口、零网络、零 LLM、零新依赖；只 spawn README 自己承诺的只读命令。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const README_REL = 'README.md';
const DEMO_REL = path.join('docs', '演示路径.md');
const 上限行 = 80;
const 运行超时 = 120000;

const 读 = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ─────────────────────────────────────────────────────────────
// 判据函数（导出给反向锁复用 —— 判据被改成恒真时，反向锁先红）
// ─────────────────────────────────────────────────────────────

/** 抽 README/演示路径里所有 `node …` 命令。只认**独立反引号段**（本仓约定：一条命令一段）。 */
function 抽命令(txt) {
  const 出 = [];
  for (const m of txt.matchAll(/`([^`\n]+)`/g)) {
    const 段 = m[1].trim();
    if (/^node\s/.test(段)) 出.push(段);
  }
  return [...new Set(出)];
}

/** 取命令的第一个非 flag 记号＝脚本路径（cwd 相对仓库根）。 */
function 命令脚本(cmd) {
  const tok = cmd.trim().split(/\s+/)[1] || '';
  return tok.replace(/^["']|["']$/g, '');
}

/** 命令是否「承诺可跑」：脚本文件存在。判据本体，导出给反向锁。 */
function 命令可跑(cmd, 文件存在) {
  const 脚本 = 命令脚本(cmd);
  if (!脚本) return { ok: false, why: '命令里没有脚本路径：' + cmd };
  if (!文件存在(脚本)) return { ok: false, why: '脚本不存在：' + 脚本 };
  return { ok: true, why: '脚本存在：' + 脚本 };
}

/** 真跑一条命令，返回真实退出码。 */
function 跑命令(cmd) {
  const argv = cmd.trim().split(/\s+/).map((t) => t.replace(/^["']|["']$/g, ''));
  const r = spawnSync(argv[0], argv.slice(1), {
    cwd: ROOT, encoding: 'utf8', timeout: 运行超时, shell: false,
  });
  return { code: r.status, err: r.error ? String(r.error.message) : '', out: (r.stdout || '') + (r.stderr || '') };
}

/** 抽 markdown 行内链接的目标（跳过 http(s) 与纯锚点）。 */
function 抽链接(txt) {
  const 出 = [];
  for (const m of txt.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const t = m[1];
    if (/^(https?:|#|mailto:)/.test(t)) continue;
    出.push(t);
  }
  return [...new Set(出)];
}

/** 抽反引号里**带斜杠**的仓库相对路径（`start.bat` 这类只存在于绿色包内的文件不在此列）。 */
function 抽仓内路径(txt) {
  const 出 = [];
  for (const m of txt.matchAll(/`([^`\n]+)`/g)) {
    const 段 = m[1].trim();
    if (!/^[.\w][\w.\-/]*\/[\w.\-/]+$/.test(段)) continue;
    if (/^node\s/.test(段)) continue;
    出.push(段);
  }
  return [...new Set(出)];
}

/**
 * ★禁词表**从 UI 闸派生**，不另立：读 p1b/web/dist.test.mjs，把
 * `assert.equal(s.includes('X'), false` 里的字面量抠出来。
 * spec Testing Strategy 3：「禁词闸：README 不含 UI 禁词（照 web/dist.test.mjs 的口径）」。
 */
function 抽禁词(distSrc) {
  const 出 = [];
  for (const m of distSrc.matchAll(/includes\('([^']+)'\),\s*false/g)) 出.push(m[1]);
  return [...new Set(出)];
}

/** 抽「红线节」里的编号行（`1. …` 到 `8. …`）。 */
function 抽红线行(txt) {
  const 起 = txt.indexOf('## ★8 条红线');
  if (起 < 0) return [];
  const 止 = txt.indexOf('\n## ', 起 + 1);
  const 节 = txt.slice(起, 止 < 0 ? txt.length : 止);
  return 节.split('\n').filter((l) => /^\d+\. /.test(l));
}

/**
 * ★红线锚句表：README 那 8 条与 docs/RIGHTS.md 全文的对应关系。
 * 键＝README 行里必须出现的锚片段，值＝RIGHTS.md 里同一条的锚片段（证明二者说的是同一件事）。
 */
const 红线锚 = [
  ['生成时', '不做事后补写'],
  ['荐下注', '推荐下注'],
  ['默认不联网', '默认**不联网**'],
  ['出网白名单', '出网白名单'],
  ['市场共识数据', '市场共识数据'],
  ['不提供境外托管', '不提供境外托管'],
  ['姓名、邮箱、工号', '不写入**姓名、邮箱、工号'],
  ['不记录调用方身份', '不记录调用方身份'],
];

/** 试用倒计时 / 准确率承诺 / 推荐语 —— spec Boundaries: Never。 */
const 禁语 = [
  '试用', '限时', '倒计时', '免费试用', '秒级上手只需',
  '准确率', '胜率', '命中率', '建议您', '建议你', '推荐下注', '必胜', '稳赚',
  /\d+\s*(天|日|小时|分钟)后/, /\d+\s*%\s*(准确|准)/,
];

// ─────────────────────────────────────────────────────────────
// ① 形态：存在、≤80 行、LF、末尾换行
// ─────────────────────────────────────────────────────────────
test('① README 存在、≤80 行、纯 LF、末尾有换行', () => {
  const p = path.join(ROOT, README_REL);
  assert.ok(fs.existsSync(p), '根 README.md 不存在');
  const raw = fs.readFileSync(p);
  const txt = raw.toString('utf8');
  // ★前置：非空且够长（否则「删到只剩标题」也能过 80 行上限）
  assert.ok(raw.length > 800, `README 只有 ${raw.length} 字节——先确认不是被删空了`);
  const 行 = txt.split('\n');
  const 正文行数 = 行[行.length - 1] === '' ? 行.length - 1 : 行.length;
  assert.ok(正文行数 <= 上限行, `README ${正文行数} 行，超出硬上限 ${上限行} 行`);
  assert.equal(txt.includes('\r'), false, 'README 含 CR —— 必须纯 LF，否则 git diff --check 逐行报 trailing whitespace');
  assert.equal(raw[raw.length - 1], 10, 'README 末尾缺换行');
});

// ─────────────────────────────────────────────────────────────
// ② 首屏句与 npm description 不是同一句
// ─────────────────────────────────────────────────────────────
test('② ★首屏句与 npm description 各用各的、且互不混用', () => {
  const txt = 读(README_REL);
  const pkg = JSON.parse(读('package.json'));
  const 首屏句 = '把判断力做成契约，让任何 agent 都无法替你下结论';
  const 检索句 = '一个算 Brier 分的账本，LLM 不参与给数';
  const 副标题 = '记录你的判断，然后证明它没有说谎';

  assert.ok(txt.includes(首屏句), 'README 首屏缺 B 句（共鸣位）');
  assert.ok(txt.includes(副标题), 'README 缺副标题（30 秒可验证的承诺）');
  assert.equal(pkg.description, 检索句, 'npm description 必须是检索句（Brier / ledger / LLM 三个搜索词）');
  // ★反向：不许互相混用 —— 混用就两头不讨好
  assert.equal(txt.includes(检索句), false, 'README 混入 npm description（检索句归 registry，首屏不写）');
  assert.equal(String(pkg.description).includes(首屏句), false, 'npm description 混入首屏句（共鸣句赢在阅读，输在检索）');
  assert.notEqual(首屏句, 检索句, '两句必须是两句');
});

// ─────────────────────────────────────────────────────────────
// ③ 8 条红线逐条在 README，且与 docs/RIGHTS.md 说的是同一件事
// ─────────────────────────────────────────────────────────────
test('③ ★8 条红线逐条在 README，且与 RIGHTS.md 交叉核对', () => {
  const txt = 读(README_REL);
  const rights = 读(path.join('docs', 'RIGHTS.md'));
  const 行 = 抽红线行(txt);
  // ★前置：真的抽到了这一节
  assert.ok(txt.includes('## ★8 条红线'), 'README 缺 8 条红线那一节');
  assert.equal(行.length, 8, `README 红线应恰有 8 条，实际 ${行.length} 条：${JSON.stringify(行)}`);
  assert.equal((rights.match(/^\d+\. /gm) || []).length, 8, 'RIGHTS.md 编号红线不是 8 条（全文页本身坏了）');

  // ★前置：锚表与红线条数一致（防有人加第 9 条却忘了补锚）
  assert.equal(红线锚.length, 行.length, `锚表 ${红线锚.length} 条 ≠ 红线 ${行.length} 条`);

  行.forEach((l, i) => {
    const [读me锚, rights锚] = 红线锚[i];
    assert.ok(l.includes(读me锚), `README 第 ${i + 1} 条缺锚句「${读me锚}」：${l}`);
    assert.ok(rights.includes(rights锚), `RIGHTS.md 缺第 ${i + 1} 条的锚句「${rights锚}」——两侧对不上`);
  });
  // README 只引用不复制全文：RIGHTS.md 的独有长句不许整段搬进来
  assert.equal(txt.includes('## 这 8 条在代码里长什么样'), false, 'README 复制了 RIGHTS.md 的全文节，违反「只引用不复制」');
  assert.ok(txt.includes('docs/RIGHTS.md'), 'README 未引用 docs/RIGHTS.md');
});

// ─────────────────────────────────────────────────────────────
// ④ ★README 承诺的命令真跑一次，退出码 0
// ─────────────────────────────────────────────────────────────
test('④ ★README 里每条 node 命令真跑一次，退出码 0', () => {
  const txt = 读(README_REL);
  const cmds = 抽命令(txt);
  // ★前置：循环确实执行了 N 次 / 真的抽到东西（抽到 0 条再逐条断言就是空跑绿灯）
  assert.ok(cmds.length >= 3, `README 只抽到 ${cmds.length} 条 node 命令，闸门形同虚设：${JSON.stringify(cmds)}`);
  cmds.forEach((c) => {
    const 判 = 命令可跑(c, (f) => fs.existsSync(path.join(ROOT, f)));
    assert.equal(判.ok, true, 判.why);
  });
  cmds.forEach((c) => {
    const r = 跑命令(c);
    assert.equal(r.err, '', `命令起不来：${c}（${r.err}）`);
    assert.equal(r.code, 0, `README 承诺的命令退出码不是 0：${c}（实际 ${r.code}）\n${r.out.slice(-600)}`);
  });
});

// ─────────────────────────────────────────────────────────────
// ⑤ ★反向锁：把脚本名改成不存在的 ⇒ ④ 的判据必须红
// ─────────────────────────────────────────────────────────────
test('⑤ ★反向锁：命令里的脚本不存在时，判据必须咬人', () => {
  const 坏 = '`node p1b/不存在的脚本.cjs 体检 泄漏`';
  const cmds = 抽命令(坏);
  // ★前置：反向锁自己的抽取也非空（否则它在验一个空数组）
  assert.equal(cmds.length, 1, `反向锁没抽到命令：${JSON.stringify(cmds)}`);
  const 判 = 命令可跑(cmds[0], (f) => fs.existsSync(path.join(ROOT, f)));
  assert.equal(判.ok, false, '这条闸必须咬人：脚本不存在时一律判红');
  assert.ok(判.why.includes('不存在'), `理由要说明「不存在」，实际：${判.why}`);

  // ★并且真跑一次：不是存在的脚本，node 自己会非 0
  const r = 跑命令('node p1b/不存在的脚本.cjs 体检 泄漏');
  assert.notEqual(r.code, 0, `不存在的脚本竟然退出 0（${r.code}）——说明 spawn 静默失败了`);
});

// ─────────────────────────────────────────────────────────────
// ⑥ 反链：README 引用的每个文件都真实存在
// ─────────────────────────────────────────────────────────────
test('⑥ ★反链检查：README 引用的每个文件都真实存在', () => {
  const txt = 读(README_REL);
  const 链接 = 抽链接(txt);
  const 路径 = 抽仓内路径(txt);
  // ★前置：两类都真的抽到了东西
  assert.ok(链接.length >= 2, `只抽到 ${链接.length} 个链接，反链检查形同虚设：${JSON.stringify(链接)}`);
  assert.ok(路径.length >= 2, `只抽到 ${路径.length} 个仓内路径，反链检查形同虚设：${JSON.stringify(路径)}`);
  链接.forEach((t) => {
    assert.ok(fs.existsSync(path.join(ROOT, t)), `README 链接到不存在的文件：${t}`);
  });
  路径.forEach((t) => {
    assert.ok(fs.existsSync(path.join(ROOT, t)), `README 引用了不存在的仓内路径：${t}`);
  });
});

// ─────────────────────────────────────────────────────────────
// ⑦ 禁词闸（口径从 UI 闸派生）
// ─────────────────────────────────────────────────────────────
test('⑦ ★禁词闸：README 与演示路径都不含 UI 禁词（表从 dist.test.mjs 派生）', () => {
  const distSrc = 读(path.join('p1b', 'web', 'dist.test.mjs'));
  const 禁 = 抽禁词(distSrc);
  // ★前置：真的从 UI 闸抠出词了（抠不到就是派生断了，闸会假绿）
  assert.ok(禁.length >= 1, '没从 p1b/web/dist.test.mjs 抠出任何禁词——派生断了，本闸会假绿');
  for (const rel of [README_REL, DEMO_REL]) {
    const txt = 读(rel);
    for (const w of 禁) {
      assert.equal(txt.includes(w), false, `${rel} 含 UI 禁词「${w}」`);
    }
  }
});

// ─────────────────────────────────────────────────────────────
// ⑧ 不许写：试用倒计时 / 准确率承诺 / 推荐语
// ─────────────────────────────────────────────────────────────
test('⑧ ★不许出现试用倒计时、准确率承诺、推荐语', () => {
  const txt = 读(README_REL);
  for (const rel of [README_REL, DEMO_REL]) {
    const t = 读(rel);
    for (const w of 禁语) {
      const hit = w instanceof RegExp ? w.test(t) : t.includes(w);
      assert.equal(hit, false, `${rel} 命中禁语：${String(w)}`);
    }
  }
  // ★前置：Brier 分必须还在（否则是把承诺删了而不是删了假话）
  assert.ok(txt.includes('Brier'), 'README 丢了 Brier 分——这是本产品唯一在算的东西，不许删');
});

// ─────────────────────────────────────────────────────────────
// ⑨ 平台表只写已验过的
// ─────────────────────────────────────────────────────────────
test('⑨ ★平台支持表只写已验过的（win-x64），未验的一律标未验', () => {
  const txt = 读(README_REL);
  const 起 = txt.indexOf('## 平台支持');
  // ★前置：这一节在
  assert.ok(起 >= 0, 'README 缺「平台支持」一节');
  const 止 = txt.indexOf('\n## ', 起 + 1);
  const 节 = txt.slice(起, 止 < 0 ? txt.length : 止);
  const 行 = 节.split('\n').filter((l) => /^\|/.test(l));
  assert.ok(行.length >= 3, `平台表行数不足（表头＋分隔＋数据）：实际 ${行.length} 行`);

  assert.ok(/win/i.test(节), '平台表没写已验过的 Windows x64');
  const 未验行 = 行.filter((l) => /mac|linux|darwin/i.test(l));
  // ★前置：未验平台**被写出来了**（是标了未验，不是压根没提）
  assert.ok(未验行.length >= 1, '平台表没提 macOS/Linux——那属于「藏问题」，比标未验更糟');
  未验行.forEach((l) => {
    assert.equal(/✅/.test(l), false, `未验平台不许打勾：${l}`);
    assert.ok(/未验|不出包|不承诺/.test(l), `未验平台必须写明「未验/不承诺」：${l}`);
  });
});

// ─────────────────────────────────────────────────────────────
// ⑩ 演示路径：两条都在，且每条命令真跑、退出码与文档标注一致
// ─────────────────────────────────────────────────────────────
test('⑩ ★两条 3 分钟演示路径在，且命令真跑、退出码与文档标注一致', () => {
  const txt = 读(DEMO_REL);
  // ★前置：两条路径都在
  assert.ok(txt.includes('路径 A'), '演示路径缺 A（给第一次见的人 · 展示「拒绝」）');
  assert.ok(txt.includes('路径 B'), '演示路径缺 B（给他人看的人 · 展示纪律）');
  assert.ok(/拒绝/.test(txt) && /删/.test(txt), '演示路径两条的核心（拒绝 / 亲手删数字）没点出来');

  // 表格行：| `node …` | 3 |
  const 行 = txt.split('\n').filter((l) => /^\|\s*`node\s/.test(l));
  assert.ok(行.length >= 3, `演示路径只列出 ${行.length} 条命令，闸门形同虚设`);
  行.forEach((l) => {
    const cmd = (l.match(/`(node [^`]+)`/) || [])[1];
    const 码 = (l.match(/\|\s*(\d+)\s*\|?\s*$/) || [])[1];
    assert.ok(cmd, `表格行没解析出命令：${l}`);
    assert.ok(码 !== undefined, `表格行没解析出预期退出码：${l}`);
    const 判 = 命令可跑(cmd, (f) => fs.existsSync(path.join(ROOT, f)));
    assert.equal(判.ok, true, 判.why);
    const r = 跑命令(cmd);
    assert.equal(r.err, '', `命令起不来：${cmd}（${r.err}）`);
    assert.equal(String(r.code), 码, `文档写的退出码与实测不符：${cmd}（文档 ${码}，实测 ${r.code}）\n${r.out.slice(-600)}`);
  });

  // ★空集不许被读成通过：至少有一条命令的预期退出码是 3，且它读的是空候选集件
  const 三 = 行.filter((l) => /\|\s*3\s*\|?\s*$/.test(l));
  assert.ok(三.length >= 1, '演示路径里没有「候选 0 条 ⇒ exit 3」那一拍——那是整个项目最重要的一行设计');
  三.forEach((l) => assert.ok(/candidates-empty\.json|空候选/.test(l), `exit 3 的那一拍必须指向空候选集件：${l}`));
});

// ─────────────────────────────────────────────────────────────
// ⑪ 发行口径干净：无盘符绝对路径、无 IPv4 连接目标
// ─────────────────────────────────────────────────────────────
test('⑪ ★README 无盘符绝对路径、无 IPv4 连接目标（承 C2/C3 纪律）', () => {
  const A = require(path.join(ROOT, 'p1b', 'scripts', 'audit-release.cjs'));
  const 本机 = new Set(['127.0.0.1', '0.0.0.0']);
  for (const rel of [README_REL, DEMO_REL]) {
    const txt = 读(rel);
    // C2：绝对盘符路径。README 会被 npm 自动打进 tarball，发行闸扫的是产物树——
    //   根 README 不在那棵树里，所以这里**提前**按住，别等哪天有人改打包清单才炸。
    A.C2_WINPATH_RE.lastIndex = 0;
    const 盘符 = txt.match(A.C2_WINPATH_RE) || [];
    assert.equal(盘符.length, 0, `${rel} 含盘符绝对路径：${JSON.stringify(盘符)}`);

    // C3：README 里不需要「散文里的网段字面量」那个豁免 —— 直接要求除本机回环外零 IPv4
    A.C3_IPV4_RE.lastIndex = 0;
    const ip = txt.match(A.C3_IPV4_RE) || [];
    const 越界 = ip.filter((s) => !本机.has(s));
    assert.equal(越界.length, 0, `${rel} 含 IPv4 字面量：${JSON.stringify(越界)}`);
  }
});

module.exports = { 抽命令, 命令脚本, 命令可跑, 跑命令, 抽链接, 抽仓内路径, 抽禁词, 抽红线行, 红线锚, 禁语 };

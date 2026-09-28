'use strict';
/**
 * p1b/scripts/secret-preflight.cjs —— 密钥轮换与清史的**开工前体检**（2026-09-29）
 *
 * 为什么有它：这两件事里有几件**做错了就很难恢复**（改写 421 个 commit 哈希），
 * 所以不该靠人对着文档逐条核。本脚本把「前置条件」与「做完怎么验」各查一遍，
 * 打印**可以直接复制粘贴的命令**。
 *
 * ★**三条硬纪律**：
 *   ① **绝不打印密钥本体**。只打印「当前 key 的指纹前 8 位」与「它是否仍是泄露的那把」。
 *   ② **绝不联网**。它只查本地 git 与本地配置。
 *   ③ **默认只读**。它不做任何写操作；清史要人自己敲命令。
 *
 * 用法：node p1b/scripts/secret-preflight.cjs
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts }).trim();
const 问 = (s) => process.stdout.write(s + '\n');

const 指纹 = (s) => crypto.createHash('sha256').update('p1b-leak-probe-salt').update(String(s)).digest('hex').slice(0, 8);

const 结果 = { 绿: [], 红: [], 提示: [] };
const 绿 = (m) => 结果.绿.push(m);
const 红 = (m) => 结果.红.push(m);
const 提 = (m) => 结果.提示.push(m);

问('');
问('═══ 密钥轮换 · 清史 · 开工前体检 ═══');
问('');

// ── 1. 泄露面有多大 ────────────────────────────────────────────────
问('【1】泄露面（只读实测）');
let commitN = '?';
let hitN = '?';
try {
  commitN = sh('git', ['rev-list', '--all', '--count']);
  绿(`可达 commit：${commitN} 个`);
} catch (e) { 红(`读 commit 数失败：${e.message}`); }
try {
  const out = sh('git', ['log', '--all', '-Ssk_tr_', '--oneline']);
  hitN = out ? out.split('\n').filter(Boolean).length : 0;
  // 这是**事实**不是阻塞：清史要重写的正是它们。
  提(`命中密钥模式的 commit：${hitN} 个 —— 清史会重写全部 ${commitN} 个哈希`);
} catch (e) { 提(`扫历史失败：${e.message}`); }

try {
  const remote = sh('git', ['remote', '-v']);
  if (!remote) 绿('git remote 为空 ⇒ 该 key 从未离开本机，没有外泄到托管平台');
  else 红(`有远端 ${remote.split('\n')[0]} ⇒ 清史的优先级立刻上升`);
} catch (e) { 提(`读 remote 失败：${e.message}`); }

// ── 2. 清史的工具在不在 ────────────────────────────────────────────
问('');
问('【2】清史工具');
try {
  const v = sh('git', ['filter-repo', '--version']);
  绿(`git filter-repo 已装：${v}`);
} catch {
  红('git filter-repo **未安装** ⇒ 装它：python -m pip install git-filter-repo');
}

// ── 3. 清史的前置：工作树必须干净 ──────────────────────────────────
问('');
问('【3】清史前置条件');
try {
  const dirty = sh('git', ['status', '--porcelain']).split('\n').filter((l) => l && !l.startsWith('??'));
  if (!dirty.length) 绿('已跟踪文件全部已提交（filter-repo 要求干净工作树）');
  else 红(`有 ${dirty.length} 个已跟踪文件未提交 —— filter-repo 会拒绝，先提交或 stash`);
  const untracked = sh('git', ['status', '--porcelain']).split('\n').filter((l) => l.startsWith('??'));
  if (untracked.length) 提(`未跟踪 ${untracked.length} 个（多为日志/截图，filter-repo 允许，但确认里面没有要保留的东西`);
} catch (e) { 红(`读工作树状态失败：${e.message}`); }

// ── 4. 备份放得下吗 ────────────────────────────────────────────────
问('');
问('【4】备份可行性');
try {
  const sz = sh('du', ['-sh', '.git']).split(/\s+/)[0];
  提(`.git 体积 ${sz} ⇒ 双重备份（mirror ＋ bundle）大约要 2–3 倍空间，确认目标盘放得下`);
} catch { 提('读 .git 体积失败（Windows 需 du -sh，Git Bash 下通常可用）'); }

// ── 5. 未来的泄漏口堵住了吗 ────────────────────────────────────────
问('');
问('【5】泄漏口');
try {
  const ig = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  if (/^\.scratch\/audit-\*/m.test(ig)) 绿('.gitignore 已挡 .scratch/audit-*（新的会话记录不会再把密钥带进来）');
  else 红('.gitignore **没有** .scratch/audit-* 规则 —— 这正是当初密钥被提交进去的那条路');
} catch (e) { 红(`读 .gitignore 失败：${e.message}`); }

// ── 6. 当前这把 key 是不是泄露的那把（不打印本体）────────────────────
问('');
问('【6】当前 key 状态（★只打印指纹，绝不打印本体）');
const cfgPath = path.join(ROOT, 'p1a-terminal', 'config', 'providers.json');
try {
  if (!fs.existsSync(cfgPath)) {
    提('providers.json 不存在（可能走了 env 兜底）—— 轮换后请确认新 key 落在哪');
  } else {
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const m = raw.match(/sk_tr_[A-Za-z0-9_-]{10,}/);
    if (!m) 提('providers.json 里没找到 sk_tr_ 形态的 key（可能已是新 key，或走了别的供应商）');
    else {
      const fp = 指纹(m[0]);
      绿(`当前 key 指纹：sha256:${fp}（长度 ${m[0].length}）`);
      提('★轮换后重跑本脚本：指纹若与上面这行**不同**，就证明轮换真的生效了');
      提('  （本脚本不记录基线指纹，因为它不该被写进任何文件——你自己比对前后两次输出即可）');
    }
  }
} catch (e) { 提(`读 providers.json 失败：${e.message}`); }

// ── 汇总 ───────────────────────────────────────────────────────────
问('');
问('═'.repeat(66));
问(`前置条件：${结果.绿.length} 项通过  ／  ${结果.红.length} 项阻塞`);
for (const m of 结果.绿) 问('  [OK]   ' + m);
for (const m of 结果.红) 问('  [阻塞] ' + m);
for (const m of 结果.提示) 问('  [提示] ' + m);

if (结果.红.length) {
  问('');
  问(`★有 ${结果.红.length} 项阻塞：`);
  for (const m of 结果.红) 问('  · ' + m);
  问('★把上面这几条清掉再动手。清史会重写哈希，不可逆。');
} else {
  问('');
  问('✔ 前置条件全过。**备份仍是第一步** —— 清史会重写 ' + commitN + ' 个 commit 的哈希，不可逆。');
}

// ── 可直接复制的命令 ────────────────────────────────────────────────
问('');
问('═'.repeat(66));
问('轮换（★只有人能在浏览器里做，助手无凭据）');
问('  1. 登 https://tokenrhythm.studio 后台 → 撤销 sk_tr_ 开头的那把');
问('  2. 顺手查调用日志：谁用过这把、什么时候用的');
问('  3. 重签一把，写回 p1a-terminal/config/providers.json');
问('     ★别再粘进任何聊天窗口/会话记录 —— 密钥当初就是这么炸的');
问('  4. node p1b/scripts/secret-preflight.cjs   ← 比对指纹是否变了');
问('');
问('清史（★不可逆：重写上面 ' + commitN + ' 个 commit 的哈希）');
问('  0. 备份（两步都做，缺一不可）：');
问('       git clone --mirror "E:\\music player" D:\\p1a-backup\\mirror.git');
问('       git bundle create D:\\p1a-backup\\bundle.bundle --all');
问('  1. 删掉 .scratch/audit-3gen 下那两个文件（全 refs 去重后只此两处）：');
问('       git filter-repo --path .scratch/audit-3gen --invert-paths');
问('  2. 剪掉悬空对象（git log 看不见但 cat-file 读得出的那 6 个）：');
问('       git reflog expire --expire=now --all && git gc --prune=now --aggressive');
问('  3. 验收（三条都要过）：');
问('       git log --all -S\'sk_tr_\' --oneline        # 期望零输出');
问('       git rev-list --all --objects | git cat-file --batch-check="%(objectname) %(objecttype) %(rest)"');
问('       # 对每个 blob 跑一遍内容扫描，期望零命中');
问('  4. 恢复方式：删掉 .git 后从 D:\\p1a-backup\\mirror.git 克隆回来');
问('');
问('═'.repeat(66));
process.exit(0);

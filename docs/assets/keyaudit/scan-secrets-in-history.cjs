#!/usr/bin/env node
// 只读扫描器：在 git 全部对象（含悬空对象）里找真密钥明文，绝不回显完整值。
// 为什么用「读配置→算指纹→扫 blob」而不是 git log -S<密钥>：
//   -S 的参数会进 shell 历史与本文件，等于把密钥抄到第二处；本脚本只在内存里比对。
// 输出只有：blob 短哈希、出现路径、命中次数、前 6 位掩码。
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const git = (...a) =>
  execFileSync('git', a, { cwd: REPO, maxBuffer: 1024 * 1024 * 1024, encoding: 'utf8', windowsHide: true });

// —— 收集候选密钥：配置文件里所有名字像凭证的字段 ——
const CONFIG = 'p1a-terminal/config';
const SECRETS = [];
for (const f of fs.readdirSync(path.join(REPO, CONFIG))) {
  if (!f.endsWith('.json')) continue;
  const txt = fs.readFileSync(path.join(REPO, CONFIG, f), 'utf8');
  for (const m of txt.matchAll(/"([A-Za-z0-9_]*(?:key|token|secret|password)[A-Za-z0-9_]*)"\s*:\s*"([^"]{16,})"/gi)) {
    SECRETS.push({ file: `${CONFIG}/${f}`, field: m[1], value: m[2] });
  }
}
if (!SECRETS.length) {
  console.log('NO_SECRETS_FOUND_IN_CONFIG — 配置里没读到候选密钥，扫描无意义，停下');
  process.exit(2);
}
// 去重（同一个 key 出现在多个文件）
const seen = new Set();
const uniq = SECRETS.filter((s) => (seen.has(s.value) ? false : seen.add(s.value)));

console.log(`候选密钥 ${uniq.length} 条（仅报形状，绝不报全文）：`);
for (const s of uniq) {
  console.log(`  ${s.file} :: ${s.field}  len=${s.value.length}  prefix=${s.value.slice(0, 6)}…`);
}

// —— 枚举所有对象（含未被任何 ref 指向的悬空对象）——
const check = git('cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype) %(objectsize)');
const blobs = check
  .split('\n')
  .map((l) => l.trim().split(' '))
  .filter((p) => p[1] === 'blob')
  .map((p) => [p[0], Number(p[2])]);
console.log(`\n对象库内 blob 总数：${blobs.length}`);

// blob → 路径（rev-list 只给首次出现名，够定位）
const objMap = new Map();
for (const line of git('rev-list', '--all', '--objects').split('\n')) {
  const sp = line.indexOf(' ');
  if (sp < 0) continue;
  const sha = line.slice(0, sp);
  const p = line.slice(sp + 1);
  if (!p) continue;
  if (!objMap.has(sha)) objMap.set(sha, new Set());
  objMap.get(sha).add(p);
}

const hits = [];
for (const [sha, size] of blobs) {
  if (size === 0 || size > 400 * 1024 * 1024) continue;
  let buf;
  try {
    buf = execFileSync('git', ['cat-file', 'blob', sha], { cwd: REPO, maxBuffer: 1024 * 1024 * 1024, windowsHide: true });
  } catch {
    continue;
  }
  for (let i = 0; i < uniq.length; i++) {
    const needle = Buffer.from(uniq[i].value, 'utf8');
    let at = buf.indexOf(needle);
    let n = 0;
    while (at !== -1) {
      n++;
      at = buf.indexOf(needle, at + 1);
      if (n > 5000) break;
    }
    if (n > 0) hits.push({ sha, size, i, n });
  }
}

if (!hits.length) {
  console.log('\n结果：全部 blob（含悬空）零命中。');
  process.exit(0);
}

console.log(`\n命中 blob ${hits.length} 个（值已掩码）：`);
for (const h of hits) {
  const s = uniq[h.i];
  const paths = [...(objMap.get(h.sha) || ['<路径未知：悬空/未在任何 ref 的树中出现>'])];
  console.log(`\n  blob ${h.sha.slice(0, 10)}  ${h.size}B  命中 ${h.n} 次  前缀=${s.value.slice(0, 6)}…`);
  console.log(`  来源文件：${s.file} :: ${s.field}`);
  for (const p of paths) console.log(`    路径: ${p}`);
  // 找出哪些 commit 曾经装过这个 blob
  try {
    const fs2 = git('log', '--all', '--oneline', `--find-object=${h.sha}`).trim();
    if (fs2) console.log(`  引入/删除该 blob 的 commit：\n${fs2.split('\n').map((l) => '    ' + l).join('\n')}`);
  } catch (e) {
    console.log(`  (find-object 查询失败：${e.message.split('\n')[0]})`);
  }
  // 该路径在历史里出现过的全部 commit
  for (const p of paths) {
    if (p.includes('*')) continue;
    try {
      const lc = git('log', '--all', '--oneline', '--', p).trim();
      if (lc) console.log(`  路径 ${p} 出现在：\n${lc.split('\n').map((l) => '    ' + l).join('\n')}`);
    } catch {}
  }
}

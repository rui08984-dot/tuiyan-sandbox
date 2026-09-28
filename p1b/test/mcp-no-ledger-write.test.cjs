'use strict';
/**
 * p1b/test/mcp-no-ledger-write.test.cjs —— 跑完全部 18 个工具后 p1a.db 的 sha256 + mtime + 行数全不变
 *
 * ── 这条锁防的是「某天加了个写工具」 ────────────────────────────────────────
 *  工具表是对外暴露面。一旦某条工具真的能写生产账本，而外部调用方是无名、不可控的
 *  （设计书 :567 亲口说的风险），那就不是「加了个功能」，是「把内部生产库开到了公网上」。
 *  工具表层面有 `mcp-golden.test.cjs` ①② 钉条数与档位分布；本条钉的是**实际效果** ——
 *  哪怕将来条数没变、名字没变，只要有一个工具真的动了 p1a.db，这里立刻红。
 *
 * ── 三项指标各防一种不同的漏法 ────────────────────────────────────────────
 *   · sha256  —— 内容变了（含「改了又改回」：内容一样但 mtime 变了由下面那条抓）
 *   · mtimeMs —— ★哪怕内容逐位相同，只要有人开过写事务就会动 mtime。
 *               只查 sha256 会漏掉「开了库、写了又回滚、最后内容一样」这条路。
 *   · 行数    —— 语义层的证据：sha256 变可能是 WAL/页重排，内容一样时行数也一样，
 *               但行数**单独**变了就一定意味着有 INSERT/DELETE 发生过。
 *   行数用 `node:sqlite` 的 **readOnly** 连接数（Node 内建，零新依赖）——
 *   ★**用只读连接这件事本身就是被测对象的一部分**：能只读打开，说明本层没留下写句柄。
 *
 * 零网络：唯一的 net 工具 `p1b_settle_corpus` 是 W+confirm 档，
 * 确认闸在子进程启动前就 return 了（`p1b/cli/index.cjs` 的 confirm 分支），
 * 跑它**一次网络都不发**。本文件里那条用例还会断言它拿到的是 `NOT_CONFIRMED`。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const DB = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const MCP = path.join(ROOT, 'p1b', 'mcp');

const tools = require(path.join(MCP, 'tools.cjs'));
const T = require(path.join(MCP, 'toolTable.cjs'));

/** 核心表行数快照。**只读**打开 —— 本层不得持有写句柄这条纪律在这里被顺带验证。 */
function rowCounts() {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    const names = db.prepare("select name from sqlite_master where type='table' order by name").all().map((r) => r.name);
    const out = {};
    for (const n of names) out[n] = db.prepare('select count(*) as c from "' + n + '"').get().c;
    return out;
  } finally { db.close(); }
}

function snapshot() {
  const st = fs.statSync(DB);
  return {
    sha256: crypto.createHash('sha256').update(fs.readFileSync(DB)).digest('hex'),
    mtimeMs: st.mtimeMs,
    size: st.size,
    rows: rowCounts(),
  };
}

/** 每条工具的最小可用参数（4 个带位置参数的工具各给一个明显无效/无害的值）。 */
function argsFor(name) {
  switch (name) {
    case 'p1b_audit_anchor_gate': return { candidates: path.join(__dirname, 'fixtures', 'does-not-exist.json') };
    case 'p1b_audit_prereg_freeze': return { prereg_file: path.join(__dirname, 'fixtures', 'does-not-exist.md') };
    case 'p1b_backup_offsite': return { dest: path.join(ROOT, '.scratch', 'mcp-no-ledger-write', 'dest') };
    case 'p1b_backup_restore_drill': return { backup_dir: path.join(ROOT, '.scratch', 'mcp-no-ledger-write', 'nonexistent-backups') };
    default: return {};
  }
}

test('跑完全部 18 个工具后：p1a.db 的 sha256 + mtime + 行数全不变', () => {
  const names = tools.listTools().map((t) => t.name);
  assert.strictEqual(names.length, 18, '本测试要跑的是全部 18 条');

  const before = snapshot();
  const results = names.map((n) => {
    const r = tools.callTool(n, argsFor(n));
    return {
      n,
      exit: r.structuredContent.exit,
      gate: r.structuredContent.verdict && r.structuredContent.verdict.gate,
      isError: r.isError === true,
      // 非零退出时把输出尾部带出来：只记一个退出码的话，偶发失败永远查不出原因
      // （本测试首跑时 `读数 kind目录` 偶发 exit 1，后续 4 次复跑均未复现；
      //  当时若没留这行尾巴，那个 1 就成了一个永久悬案）。
      tail: r.structuredContent.exit === 0 ? '' : ' ‖ ' + r.content[0].text.split('\n').filter(Boolean).slice(-3).join(' ⏎ '),
    };
  });
  const after = snapshot();

  // 逐项对比，失败时把差在哪一行写进断言消息（只给一句「不一样」等于没给）
  const report = [];
  const fail = [];
  if (after.sha256 !== before.sha256) fail.push('sha256: ' + before.sha256 + ' → ' + after.sha256);
  if (after.mtimeMs !== before.mtimeMs) fail.push('mtimeMs: ' + before.mtimeMs + ' → ' + after.mtimeMs);
  if (after.size !== before.size) fail.push('size: ' + before.size + ' → ' + after.size);
  for (const t of Object.keys(before.rows)) {
    if (after.rows[t] !== before.rows[t]) fail.push('行数 ' + t + ': ' + before.rows[t] + ' → ' + after.rows[t]);
  }
  for (const r of results) report.push(r.n + ' exit=' + r.exit + ' gate=' + r.gate + ' isError=' + r.isError + r.tail);

  assert.deepStrictEqual(fail, [], '★p1a.db 被动了：\n  ' + fail.join('\n  ') + '\n逐条结果：\n  ' + report.join('\n  '));

  // 顺带留一份逐条结果到 stderr：出问题时这份清单是唯一的线索
  process.stderr.write('[mcp-no-ledger-write] ' + report.join('\n') + '\n');
});

test('唯一那条联网工具跑完仍然是 NOT_CONFIRMED —— 一次网络都没发', () => {
  const r = tools.callTool('p1b_settle_corpus', {});
  assert.strictEqual(r.structuredContent.exit, 2, 'W 档工具应当撞上确认闸的 exit 2');
  assert.strictEqual(r.structuredContent.verdict.gate, 'NOT_CONFIRMED');
  assert.strictEqual(r.structuredContent.argv.indexOf('--确认'), -1, 'argv 里出现了确认 token');
  assert.strictEqual(r.structuredContent.argv.indexOf('--confirm'), -1, 'argv 里出现了确认 token');
});

test('本层源码对 p1a.db 的访问面为零：没有 require 任何 db / src 模块', () => {
  // 这条是静态的机械证明：MCP 进程**连只读句柄都不该有**。
  // 触碰 p1a.db 的唯一路径是 cliBridge 里的那一次 spawn，由 node p1b/cli 去开句柄。
  const banned = [
    /require\([^)]*['"][^'"]*p1b[\\/]src[\\/][^'"]*['"]\)/,   // 直接摸 p1b/src
    /require\([^)]*['"][^'"]*p1b[\\/]scripts[\\/][^'"]*['"]\)/, // 直接摸子脚本
    /require\([^)]*['"][^'"]*\bdb\b[^'"]*['"]\)/i,              // 直接摸任何 db 模块
    /better-sqlite3/, /node:sqlite/,                           // 自己开库
  ];
  const hits = [];
  for (const f of fs.readdirSync(MCP).filter((f) => f.endsWith('.cjs'))) {
    const src = fs.readFileSync(path.join(MCP, f), 'utf8');
    for (const re of banned) {
      const m = re.exec(src);
      if (m) hits.push(f + ' :: ' + m[0]);
    }
  }
  assert.deepStrictEqual(hits, [], 'p1b/mcp/ 里出现了对账本的直接访问：\n  ' + hits.join('\n  '));
});

test('argv 拼装是白名单式的：调用方给的未知键进不了命令行', () => {
  // 攻击面实测确认：`p1b/cli/index.cjs` 会把 `--` 之后的 token 原样透传给子脚本，
  // 而子脚本认得 `--out` / `--write` / `--confirm` 等 8 个写盘 flag。
  // 本层不给 MCP 调用方拼 `--` 的能力：只从登记过的 4 个位置参数键里取值。
  const { buildArgv } = require(path.join(MCP, 'cliBridge.cjs'));
  const cmd = T.lookup('p1b_audit_anchor_gate');
  const argv = buildArgv(cmd, { candidates: 'x.json', '--确认': 'y', out: 'D:/任意/路径', extra: ['--write'] });
  assert.deepStrictEqual(argv, ['门禁', '锚点', 'x.json'], 'argv 里混进了未登记的参数：' + JSON.stringify(argv));
});

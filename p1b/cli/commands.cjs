'use strict';
/**
 * p1b/cli/commands.cjs —— P1b 预测侧薄 CLI 的**命令表**（单一真源）
 *
 * ── 本件是什么 ────────────────────────────────────────────────────────────
 * 一张「组 → 命令 → 子脚本 + 档位 + 参数注入规则」的纯数据表。`index.cjs` 只做
 * 路由 / 帮助 / 确认闸 / spawn，不含任何业务判断。**改行为请改这张表，不要改路由。**
 *
 * ── 硬纪律（三条，改动前先读）─────────────────────────────────────────────
 * ① **薄包装**：`p1b/scripts/` 下的脚本**一个都不改、一个都不删**。CLI 只做
 *    「选脚本 + 补参数 + spawn」。任何需要改脚本才能跑通的命令，一律不进表。
 * ② **spawn 绝不 require**：`p1b/test/scripts-require-safety.test.cjs:40` 的检测口径是纯文本
 *    扫描——测试文件里出现「`const <名> = path.join(ROOT, 'p1b', 'scripts', '<x>.cjs')` 且同文件
 *    再模块加载它」这一对同形字样即算命中。本 CLI 对 p1b/scripts 只 spawn，天然不在命中面内。
 *    ★**本注释刻意不写出那条正则的完整字面量**：谁把它照抄进 `p1b/test/` 下的文件，谁就会
 *    被当成「require 了一个不存在的脚本」而打红（`scripts-require-safety.test.cjs:61`）。
 * ③ **默认只读**：R 档命令 CLI 一个写盘参数都不注入；F 档只往 `.scratch/cli/<时间戳>/`
 *    注入（永不入库）；W/N 档必须显式 `--确认`（或 `--confirm`）才 spawn。
 *
 * ── 档位记号（每条命令都标，帮助里逐条显示）────────────────────────────────
 *   R ＝ 只读：零写盘、零写库、零网络（CLI 不注入任何写参数）
 *   F  ＝ 写盘不写库：产物只落 `.scratch/cli/<ts>/`，永不进 `p1b/sim/out/` 或 `docs/specs/`
 *   W  ＝ 写 `p1a.db`（生产账本）——必须 `--确认`
 *   N  ＝ 打网络
 *
 * ── 为什么「注入输出目录」是必须的而不是洁癖 ───────────────────────────────
 *   `kind-table.cjs:33` 的 `--out` 缺省＝`docs/specs/kind-目录表.md`，`:237` 是**无条件**
 *   `writeFileSync`；`u8-columns.cjs:25` 与 `calibration-report.cjs:16` 的 `--out-dir`
 *   缺省＝`p1b/sim/out`（git tracked 目录）。⇒ 不注入就是「跑一次诊断、把仓库产物覆盖一遍」。
 *   本仓 14 个测试在 `p1b/sim/out` 上取目录快照，单文件挡不住这种竞态。
 *
 * ── 为什么 F 档不全进第一批 ───────────────────────────────────────────────
 *   `forecast-calendar.cjs:53` spawn daemon 的 `--report-due` **不带 `--report-due-out`**，
 *   而 daemon 的缺省落盘位置是 git tracked 的 `p1b/sim/out/resolve-daemon.due.json`
 *   （`corpus-resolve-daemon.cjs:489-492`）⇒ 它不是「写盘件」，是「覆盖仓库产物件」。
 *   在 daemon 支持 `--report-due-out` 之前，本 CLI 不收它。
 *
 * ── 显式排除件（不进表，`--help` 里也列出来以便对照）──────────────────────
 *   `_sqlite-guard.cjs`      —— 是**库**不是 CLI（`grep -c process.argv` = 0），spawn 起来什么都不做
 *   `_rollback-template.cjs` —— 是**模板**且语法就不对（`node --check` 报 `:14 SyntaxError`）
 *   `forecast-calendar.cjs`  —— 见上，覆盖 git tracked 产物
 *   `intake-ledger-e2e.cjs`  —— `:16-18` 的 `OUT_DIR` **硬编码** `p1b/sim/out` ＋ `:109-110`
 *                              无条件 `writeFileSync` ⇒ **零参件无法被 CLI 重定向**；
 *                              这类件（连同其余起服务/打网件）一律不进 CLI
 */

const path = require('path');
const fs = require('fs');

/** 仓库根（本件在 `p1b/cli/` 下 ⇒ 上两层）。 */
const ROOT = path.join(__dirname, '..', '..');
/** 被包装的脚本目录。CLI 只从这里取文件，**从不写入**。 */
const SCRIPTS = path.join(ROOT, 'p1b', 'scripts');
/** F 档产物的唯一落点（已加进 `.gitignore`）。 */
const OUT_ROOT = path.join(ROOT, '.scratch', 'cli');

/**
 * 会让「R 档命令」开始写盘的透传参数。CLI 不拦（拦了会改子脚本行为），
 * 只在 spawn 前打一行提醒——薄包装原则优先于替用户做主。
 */
const WRITE_FLAGS = ['--write', '--out', '--json', '--text', '--md', '--emit-review', '--record-candidates', '--confirm'];

/** `calibration-report.cjs` 的输入件（`:30/:31/:119/:154/:191` 全部走 `latestByPattern(OUT_DIR,…)`）。
 *  注入 `--out-dir` 会连**输入**一起改道 ⇒ 空目录跑出来是「stage4=n/a」的残废报告。
 *  修法：跑之前把 `p1b/sim/out` 里命中这些正则的件**复制**到暂存目录，`latestByPattern` 随即
 *  挑到与生产完全相同的最新件 ⇒ 行为逐位不变，且生产目录只被读。 */
const CALIB_INPUT_RES = [
  /^stage4-run-five-layers-\d{8}[a-z]?\.json$/,
  /^g2-report-latest-\d{8}[a-z]?\.json$/,
  /^u8-columns-\d{8}\.json$/,
  /^stage5-rank-diagnostic-\d{8}\.json$/,
  /^negative-results-ledger-\d{8}\.json$/,
];

/** 把 `calibration-report.cjs` 的输入件预置进暂存目录（只读生产、只写暂存）。 */
function preCopyCalibInputs(ctx) {
  const src = path.join(ROOT, 'p1b', 'sim', 'out');
  let names;
  try { names = fs.readdirSync(src); } catch (e) { return ['（读不到 p1b/sim/out，跳过输入预置：' + e.message + '）']; }
  const hit = names.filter((f) => CALIB_INPUT_RES.some((re) => re.test(f)));
  for (const f of hit) fs.copyFileSync(path.join(src, f), path.join(ctx.outDir, f));
  return ['已预置输入 ' + hit.length + ' 件 → ' + ctx.outDir + '（生产目录只读）'];
}

/**
 * 档位显示串。
 * @param {{tier:string, net:boolean}} c
 */
function tierLabel(c) {
  const t = c.tier === 'R' ? 'R 只读' : c.tier === 'F' ? 'F 写盘·不写库' : 'W 写库';
  return c.net ? t + '·N 打网' : t;
}

/** 组 → 命令。`key` 是英文别名（`doctor`/`settle`/`read`/`audit`），`zh` 是主名。 */
const GROUPS = [
  {
    key: 'doctor',
    zh: '体检',
    alias: ['doctor', 'jian ti', 'check'],
    desc: '跑批/账本/泄漏/到期欠账的只读体检',
    commands: [
      {
        zh: '看板',
        script: 'board.cjs',
        tier: 'R',
        net: false,
        desc: '一页看板：G2 五门 / 采信链 / 五层读数 / 账本计数',
        pos: [],
        build: () => [],
      },
      {
        zh: '跑批',
        script: 'exp-health.cjs',
        tier: 'R',
        net: false,
        desc: '跑批体检：进程 / DB 增长 / 队列陈旧度（判读口径「零增长 ≠ 卡死」）',
        pos: [],
        build: () => [],
      },
      {
        zh: '泄漏',
        script: 'leak-scan.cjs',
        tier: 'R',
        net: false,
        desc: '全库泄漏扫描：pass / ★leak / 未判定，并单列 gate 不认的字段',
        pos: [],
        build: () => [],
      },
      {
        zh: '文件全图',
        script: 'file-map.cjs',
        tier: 'R',
        net: false,
        desc: '项目「文件全图」生成器（目录结构 + 每个相关文件是什么）；缺省打 stdout，不落盘',
        pos: [],
        build: () => [],
      },
      {
        zh: '欠账',
        script: '_b1-matures-audit.cjs',
        tier: 'R',
        net: false,
        desc: '到期欠账：R4 全部行的「已存 matures_at vs 由 evidence 现推」，并先打契约到期口径覆盖表',
        pos: [],
        // 覆盖表来自 A 阶段的纯件 `p1b/src/evidence/dueBranches.js`（只读契约、不写、零 db）。
        // 本命令**只打印它已导出的东西，不复制它的判定逻辑**（实现与否由 dueOf 现场断言，
        // 见 `p1b/test/corpus-resolve-dueof.test.cjs` 第 ⑧ 例）。A 件缺失时降级提示、不报错。
        coverage: true,
        build: () => [],
      },
    ],
  },
  {
    key: 'settle',
    zh: '结算',
    alias: ['settle', 'run'],
    desc: '结算与同步（写生产账本 ⇒ 必须显式 --确认）',
    commands: [
      {
        zh: '语料',
        script: 'corpus-resolve.cjs',
        tier: 'W',
        net: true,
        desc: '语料题机械 resolve（零 LLM，按 evidence_json[0].resolve 参数）—— 打网 6 源 + 写 p1a.db',
        pos: [],
        confirm: true,
        // 子脚本自己的开关就叫 `--confirm`（`corpus-resolve.cjs:10`）；CLI 的中文闸是 `--确认`。
        build: () => ['--confirm'],
      },
    ],
  },
  {
    key: 'read',
    zh: '读数',
    alias: ['read', 'report'],
    desc: '读数件（G2 门 / 五层 / 校准 / 派生列 / 判词离散度 / kind 目录）',
    commands: [
      { zh: 'G2门', script: 'g2-report.cjs', tier: 'R', net: false, desc: 'G2 能力门月报 · R4 口径（`:582/:588` 的落盘在 `if (JSON_OUT/TEXT_OUT)` 内，缺省不写）', pos: [], build: () => [] },
      { zh: '分层', script: 'stage4-run.cjs', tier: 'R', net: false, desc: '阶段 4 分层预测真跑（L2/L5 最小引擎 × 真实账本，逐层 Brier/ECE）', pos: [], build: () => [] },
      { zh: '校准', script: 'calibration-report.cjs', tier: 'F', net: false, desc: '分域格校准报告（--out-dir 既是入也是出 ⇒ CLI 先把输入件预置进暂存目录）', pos: [], pre: preCopyCalibInputs, build: (ctx) => ['--out-dir', ctx.outDir] },
      { zh: '列', script: 'u8-columns.cjs', tier: 'F', net: false, desc: 'U8 加列读侧派生：KL 可预报性 / Murphy 三分解 / prequential 累计曲线', pos: [], build: (ctx) => ['--out-dir', ctx.outDir] },
      { zh: '判词离散度', script: 'verdict-spread.cjs', tier: 'F', net: false, desc: '判词离散度：同题多路判词的分歧幅度（缺省落 p1b/sim/out ⇒ 必须改道）', pos: [], build: (ctx) => ['--out-dir', ctx.outDir] },
      { zh: 'kind目录', script: 'kind-table.cjs', tier: 'F', net: false, desc: 'resolve.kind 目录表（缺省直接覆盖 docs/specs/kind-目录表.md ⇒ 必须改道）', pos: [], build: (ctx) => ['--out', path.join(ctx.outDir, 'kind-目录表.md'), '--json', path.join(ctx.outDir, 'kind-table-latest.json')] },
    ],
  },
  {
    key: 'audit',
    zh: '门禁',
    alias: ['audit', 'gate'],
    desc: '账本与门禁（锚点 / 契约 / 冻结哈希 / 抽检清单）',
    commands: [
      {
        zh: '锚点',
        script: 'anchor-gate.cjs',
        tier: 'R',
        net: false,
        desc: 'Q0 拒收门三问的可执行判定（过锚率，按候选/严格双口径）',
        pos: [{ name: '候选.json', desc: '出题器留痕件（含 candidates[]，可选 drops[]）' }],
        // anchor-gate 自己要求 `--candidates`（`:204-205` 缺参即 exit 2），且只在 `--out/--md`
        // 给了路径时才写盘（`:244/:281`）⇒ R 档成立。候选 0 条时它 exit 3（`:209`，
        // 防「空集」被读成「通过」）—— CLI 原样透出这个码，不抹平。
        build: (ctx, pos) => (pos[0] ? ['--candidates', pos[0]] : []),
      },
      { zh: '契约', script: 'g2-contract-verify.cjs', tier: 'R', net: false, desc: '契约表「源码派生」复现检查（全文件零 writeFileSync，实测 grep = 0）', pos: [], build: () => [] },
      {
        zh: '冻结哈希',
        script: 'prereg-freeze.cjs',
        tier: 'R',
        net: false,
        desc: 'PREREG 冻结块 sha256 复算（MATCH=false ⇒ 冻结件被改）',
        pos: [{ name: '文件', desc: '含「## 冻结登记」块的 md' }],
        // prereg-freeze 取 `process.argv[2]`（`:56`）⇒ CLI 的第一个位置参数直接落到它 argv[2]。
        // `--write` 才会改文件（`:76` 在 `if (WRITE)` 内）⇒ 不给 --write 即 R。
        build: (ctx, pos) => (pos[0] ? [pos[0]] : []),
      },
      {
        zh: '抽检清单',
        script: 'g2-audit-build.cjs',
        tier: 'F',
        net: false,
        desc: '② 抽检清单 v2 构造器（`:110` 的 EMIT_REVIEW 落盘是无条件的 ⇒ 必须注入路径）',
        pos: [],
        build: (ctx) => ['--emit-review', path.join(ctx.outDir, 'g2-audit-review.tsv')],
      },
    ],
  },
  {
    key: 'backup',
    zh: '备份',
    alias: ['backup', 'bei fen', 'drill'],
    desc: '生产库异地备份 + 恢复演练（备份是写操作 ⇒ 必须显式 --确认）',
    commands: [
      {
        zh: '异地',
        script: 'backup-offsite.cjs',
        tier: 'F',
        net: false,
        desc: '把生产库备份到另一块盘：逐份落 sha256 收据、保留最近 N 份（目标同盘会直接拒）',
        pos: [{ name: '异地目录', desc: '备份落点，如 D:/p1a-backup' }],
        // 备份不写 p1a.db，但它是真的在写盘 ⇒ 仍走确认闸，否则「跑一下试试」就落盘了。
        // --dest 从位置参数取：CLI 的 build 只拼参数，不替用户选盘符。
        confirm: true,
        // 档位字母只有 R/F/W 三档（cli.test.cjs:120 钉死），而「备份」既不是 R 也不是 W
        // （它只读 p1a.db）。这里如实写清写到哪里，好过把备份说成「写生产账本」——
        // 确认闸弹出的那行字要是撒谎，用户在真正该点确认的时候反而不敢点。
        writes: '只写备份目录（★不碰 p1a.db）；目标与源同盘会被子脚本直接拒',
        build: (ctx, pos) => (pos[0] ? ['--dest', pos[0]] : []),
      },
      {
        zh: '演练',
        script: 'restore-drill.cjs',
        tier: 'F',
        net: false,
        desc: '从备份里挑一份恢复到临时件，校验 sha256/integrity_check/核心表行数与内容 sha256，报告「能不能用」（绝不碰生产库）',
        pos: [{ name: '备份目录', desc: '异地备份所在目录，如 D:/p1a-backup' }],
        // F 档：只往 .scratch/cli/<ts>/ 写报告与临时件，不写 p1a.db ⇒ 不需要 CLI 确认闸。
        // 脚本自己还有一道 --确认（默认 dry-run），两层闸各管各的。
        build: (ctx, pos) => (pos[0] ? ['--dir', pos[0]] : []),
      },
    ],
  },
];

/** 显式排除件（帮助里列出来，方便对照「为什么某个脚本不在表里」）。 */
const EXCLUDED = [
  ['_sqlite-guard.cjs', '库，不是 CLI（零 process.argv）'],
  ['_rollback-template.cjs', '模板，且 node --check 即语法错（:14）'],
  ['forecast-calendar.cjs', 'spawn daemon --report-due 不带 --report-due-out ⇒ 覆盖 git tracked 产物'],
  ['intake-ledger-e2e.cjs', 'OUT_DIR 硬编码 p1b/sim/out ＋ 无条件写 ⇒ 零参件无法被 CLI 重定向'],
];

/** 组查找：中文名优先，其次 key / alias。 */
function findGroup(token) {
  if (!token) return null;
  const t = String(token);
  for (const g of GROUPS) {
    if (g.zh === t || g.key === t || (g.alias || []).includes(t)) return g;
  }
  return null;
}

/** 命令查找：组内中文名优先，其次 `key` 字段。返回时**带上 group**（帮助文案要用组名拼用法行）。 */
function findCommand(group, token) {
  if (!group || !token) return null;
  const t = String(token);
  const hit = group.commands.find((c) => c.zh === t || c.key === t);
  return hit ? Object.assign({ group }, hit) : null;
}

/** 全部命令（展平），供自测遍历。 */
function allCommands() {
  return GROUPS.flatMap((g) => g.commands.map((c) => Object.assign({ group: g }, c)));
}

module.exports = {
  ROOT, SCRIPTS, OUT_ROOT, WRITE_FLAGS, CALIB_INPUT_RES,
  GROUPS, EXCLUDED, tierLabel, findGroup, findCommand, allCommands,
};

'use strict';
/**
 * p1b/mcp/toolTable.cjs —— MCP 工具表的**唯一真源**（18 条 = CLI 的 18 条，一条不多一条不少）
 *
 * ── 本件是什么 ────────────────────────────────────────────────────────────
 * 一张「MCP 工具名 → commands.cjs 里的哪条命令 + 给 LLM 看的描述 + 输入 schema」的表。
 * 它**只读** `p1b/cli/commands.cjs`（纯数据模块，require 它零副作用），不 require 任何
 * `p1b/src/**`、不碰 p1a.db、不发网络。
 *
 * ── 为什么这张表不放在 commands.cjs 里 ────────────────────────────────────
 * 设计书《推演沙盘-特化智能体方案设计书-20260928.md》第 120 行原方案是「给 4 个 `pos`
 * 各加 ASCII key 与 type（+4 行）」。本轮**没照做**，是两个理由，不是因为嫌麻烦：
 *   ① **写入边界**：本批的授权写入面是 `p1b/mcp/**` ＋ `p1b/test/**` ＋ `index.cjs` 的
 *      spawn 那几行 ＋ `docs/specs/**`。改 `commands.cjs` 越界了。
 *   ② **职责归属**：ASCII 工具名是 **MCP 侧的传输关切**。`commands.cjs` 是人类 CLI 的
 *      单一真源（`p1b/test/skill-projection.test.cjs` 拿它当投影基准），往里塞
 *      `p1b_doctor_board` 这种只对协议有意义的名字，是把协议的词汇漏进人类界面。
 *      —— 分开放，两边各自干净；代价是要在本件里**断言 18 条对得上**（见下）。
 *
 * ── 「18 条对得上」是本件最重要的不变量 ────────────────────────────────────
 * `assertCoverage()` 在模块加载时跑：命令表里每一条都必须在本表有 ASCII 名，
 * 本表每个 ASCII 名都必须指向真实存在的命令，多一个少一个都**拒绝启动 server**。
 * 理由：MCP 工具表是对外暴露面，「悄悄加了一个写工具」是这个形态下最贵的 bug
 * （设计书第 672 行要求 `mcp-golden.test.cjs` 钉死它）——但回归锁是事后发现，
 * 启动即拒是当场发现。
 *
 * ── 硬纪律 ────────────────────────────────────────────────────────────────
 * · **零新依赖**：只用 node 内建 + `p1b/cli/commands.cjs`。
 * · **禁词**：本件所有面向模型的文案**不得出现**「预测」二字。理由是合规红线
 *   （设计书第 560 行）：MCP tool 的 description 与返回文本一旦出现指向未来的措辞，
 *   外部调用者就会把它读成「建议」。命令行里 `读数 分层` 的原始 desc 含该词
 *   （`commands.cjs:179`），所以本件**不转发 `cmd.desc`**，18 条描述全部在这里重写。
 *   `p1b/test/mcp-golden.test.cjs` 有一条断言把这条红线变成机械检查。
 * · **只描述已存在的判据**：描述里的每条口径都能在 `p1b/skill/SKILL.md` /
 *   `p1b/skill/references/*.md` 找到出处，不在本件里新增任何业务判据。
 */

const path = require('path');
const C = require(path.join(__dirname, '..', 'cli', 'commands.cjs'));

/**
 * 命令 → ASCII 工具名后缀。键是 `组key/中文命令名`（中文键是给人看的，值才是协议用的）。
 * 这 18 个后缀与设计书 §2.2 全表（`:138`–`:155`）逐条一致。
 */
const ASCII = {
  'doctor/看板': 'board',
  'doctor/跑批': 'exp_health',
  'doctor/泄漏': 'leak_scan',
  'doctor/文件全图': 'file_map',
  'doctor/欠账': 'matures_audit',
  'settle/语料': 'corpus',
  'read/G2门': 'g2_report',
  'read/分层': 'stage4',
  'read/校准': 'calibration',
  'read/列': 'u8_columns',
  'read/判词离散度': 'verdict_spread',
  'read/kind目录': 'kind_table',
  'audit/锚点': 'anchor_gate',
  'audit/契约': 'g2_contract',
  'audit/冻结哈希': 'prereg_freeze',
  'audit/抽检清单': 'g2_audit_build',
  'backup/异地': 'offsite',
  'backup/演练': 'restore_drill',
};

/**
 * 4 个位置参数的 ASCII 键与类型。
 * 类型全是 `string`：`commands.cjs` 的 4 个 `pos` 全是路径/文件名
 * （实测 `pos fields: ["name","desc"]`，恰好 4 条，与设计书第 120 行对上）。
 * 给它们编 `type:'number'` 或 `type:'array'` 只会让 schema 与 CLI 行为分家。
 */
const POS = {
  'audit/锚点': { key: 'candidates', desc: '出题器留痕件的路径（JSON，含 candidates[]，可选 drops[]）。喂一个 candidates 为空的文件会得到 exit 3。' },
  'audit/冻结哈希': { key: 'prereg_file', desc: '含「## 冻结登记」块的 markdown 文件路径。' },
  'backup/异地': { key: 'dest', desc: '异地备份的落点目录，如 D:/p1a-backup。★与生产库同盘时子脚本会直接拒。' },
  'backup/演练': { key: 'backup_dir', desc: '异地备份所在目录，如 D:/p1a-backup。' },
};

/**
 * 每条工具的 exit 3 到底意味着什么。
 * ★**为什么必须逐条写**：exit 3 在本项目不是一个统一语义。`p1b/skill/SKILL.md`
 * 第 263–270 行已经把这件事说死了：「绝不可笼统读成『门禁不通过』」——
 * 对 `门禁 锚点` 它是**裁决**（候选 0 条，防空集被读成通过），
 * 对 `门禁 冻结哈希` 它是**真崩溃**（`prereg-freeze.cjs:66` 的解析异常）。
 * 同一个码，一个是结论一个是故障。把它笼统映射成「门禁 FAIL」就是在造第四种读法。
 */
const EXIT3 = {
  'doctor/文件全图': { kind: 'GUARD', meaning: '生成物含 NUL 字节（防二进制内容泄漏进仓库产物）', where: 'p1b/scripts/file-map.cjs:185' },
  'audit/锚点': { kind: 'VERDICT', meaning: '候选 0 条 —— 这是「防空集被读成通过」的设计在说话，是裁决不是崩溃', where: 'p1b/scripts/anchor-gate.cjs:209' },
  'audit/冻结哈希': { kind: 'CRASH', meaning: '★解析文件时抛了异常 —— 这一次它**不是裁决**，是真崩溃，照常上报', where: 'p1b/scripts/prereg-freeze.cjs:66' },
  'backup/演练': { kind: 'VERDICT', meaning: '这份备份不可用（校验没过或核心表对不上）—— 不是 0', where: 'p1b/scripts/restore-drill.cjs:246' },
};

/**
 * 固定免责声明（设计书第 560 行红线 2：返回一律限定为「账本中已结算的历史统计事实」）。
 * 挂在每个工具返回的 `structuredContent` 上，不挂在描述里——描述是给模型挑工具看的，
 * 免责声明是给模型**转述**用的，位置不同。
 */
const DISCLAIMER = '本工具只返回账本中已结算的历史统计事实与机械门禁判定，不构成任何对未来结果的判断或建议。';

/**
 * 18 条工具描述（给 LLM 看）。
 * 写法固定三段：**何时用 → 返回怎么读 → 档位/门禁警示**。
 * 第二段是本件的重心：模型最容易在这里翻车（把 exit 3 当崩溃、把 0 当「有数据」、
 * 把 unverifiable 折进通过率），所以逐条把读法钉死。
 */
const DESC = {
  'p1b_doctor_board': [
    '读整体状态用这条：G2 五门、采信链、五层读数、账本计数，一页出。',
    '怎么读：stdout 是一页人读文本，第一行带生成时间戳（每次不同，比对内容请忽略该行）。',
    'R 档只读，零写盘零写库。',
  ].join('\n'),

  'p1b_doctor_exp_health': [
    '跑批体检用这条：进程、p1a.db 增长、队列陈旧度。',
    '怎么读：⚠ 判读口径「零增长 ≠ 卡死」—— 没有新写入可能是因为没有到期题，不代表跑批在动。',
    'R 档只读。',
  ].join('\n'),

  'p1b_doctor_leak_scan': [
    '要断言「账本里没有泄漏」时用这条（p1b/skill/references/leak.md 的口径）。',
    '怎么读：⚠ stdout 给**三个互相独立的计数**：pass / leak / unverifiable。',
    '**unverifiable（推不出）不等于通过，也不等于泄漏** —— 它是「没测到」。',
    '任何「无泄漏」的结论都必须同时报出 unverifiable 的数量，否则就是把「没测到」读成了「干净」。',
    'R 档只读。',
  ].join('\n'),

  'p1b_doctor_file_map': [
    '想知道这个项目有哪些文件、每个文件是干什么的时候用这条。',
    '怎么读：目录结构 + 每个相关文件一句话说明，缺省打 stdout 不落盘。',
    '⚠ exit 3 在这条命令上表示「生成物含 NUL 字节」（防二进制内容混进仓库产物），是守卫触发不是裁决。',
    'R 档只读。',
  ].join('\n'),

  'p1b_doctor_matures_audit': [
    '对账用这条：到期欠账 —— 逐行比对「已存的 matures_at」与「由 evidence 现推出的」。',
    '怎么读：stdout 先打契约到期口径覆盖表，再打欠账明细；两者是并列的，不要只抄明细。',
    'R 档只读。',
  ].join('\n'),

  'p1b_settle_corpus': [
    '⚠ 只读预览。**这条工具永远不会真的结算** —— 本 MCP 层在 spawn 之前永不带 --确认，',
    'CLI 的确认闸（p1b/cli/index.cjs 的 confirm 分支）会在子进程启动前就返回，所以你拿到的是',
    '一段完整的「将要执行什么」预览。',
    '怎么读：返回 `isError:false` ＋ `verdict.gate=\'NOT_CONFIRMED\'` ＋ `will_execute`（完整命令行）。',
    '**这不是失败，也绝不是重试信号 —— 任何情况下都不要重试本工具。**',
    '要真结算：把 `will_execute` 原样交给人类，让他在终端里亲自加 --确认 执行。',
    'W+N 档（写 p1a.db ＋ 打外网 6 个数据源），是 18 条里唯一的联网件。',
  ].join('\n'),

  'p1b_read_g2_report': [
    '看 G2 能力门月报（R4 口径）用这条。',
    '怎么读：stdout 是人读月报；缺省不写盘（落盘开关关着）。',
    'R 档只读。',
  ].join('\n'),

  'p1b_read_stage4': [
    '用户问「哪一层判得最差」「这几层的分数能不能比」时用这条：阶段 4 分层跑，逐层 Brier/ECE。',
    '怎么读：⚠ 两个量纲不许混 —— 某些层的 accuracy 与 Brier **不是同一个量纲**，引用时必须写清是哪一个。',
    '⚠ 样本不足的域格（n 小于阈值）只报方向、**不出结论**；看到「n/a」是样本不够，不是「测了没问题」。',
    '本工具只对**已结算**的题打分，不涉及任何尚未到期的题。',
    'R 档只读。',
  ].join('\n'),

  'p1b_read_calibration': [
    '分域格校准报告用这条（哪个题域判得偏、偏多少）。',
    '怎么读：产物落 .run-out/cli/<时间戳>/，`structuredContent.output_dir` 给出该目录。',
    'F 档：只写这个暂存目录，不写 p1a.db、不覆盖任何既有产物。',
  ].join('\n'),

  'p1b_read_u8_columns': [
    '用户问「这些判词/读数里到底有没有信息量」时用这条：KL 可预报性、Murphy 三分解、prequential 累计曲线。',
    '怎么读：产物落暂存目录，路径见 `structuredContent.output_dir`。',
    '⚠ 分数低不等于「有信息量但模型差」，也不等于「没信息量」—— 分解项要一起读。',
    'F 档，只写暂存目录。',
  ].join('\n'),

  'p1b_read_verdict_spread': [
    '同一道题有多路判词、想知道它们分歧多大时用这条。',
    '怎么读：产物落暂存目录，路径见 `structuredContent.output_dir`。',
    'F 档，只写暂存目录。',
  ].join('\n'),

  'p1b_read_kind_table': [
    '用户问「支持哪些题」「这个 kind 收不收」时用这条：resolve.kind 目录表。',
    '怎么读：产物落暂存目录（CLI 已把默认的 docs/specs/kind-目录表.md 落点改道过去，',
    '**不会覆盖仓库里那份**）；路径见 `structuredContent.output_dir`。',
    '⚠ 目录表里「登记」不等于「可达」：某个 kind 取不到数时会显示 not_reachable。',
    'F 档，只写暂存目录。',
  ].join('\n'),

  'p1b_audit_anchor_gate': [
    '出题之后要过拒收门三问（到期那天有没有不靠人不靠模型的第三方真值锚 / 冻结时答案还没公开吗 /',
    '换个实例答案会变吗）时用这条。',
    '怎么读：⚠ **exit 3 在这里是一个裁决，不是崩溃** —— 候选 0 条时它退出 3，',
    '因为「空集」绝不能被读成「通过」（p1b/skill/references/gate.md §2.1）。',
    '此时返回 `isError:false` ＋ `verdict.gate=\'FAIL\'`，**这是正确答案，不要重试，也不要报成「通过」**。',
    '⚠ 过锚率必须**两个口径并列报**：候选口径（分母＝已通过的候选）与严格口径',
    '（分母＝提议全集，含 drops）。只报候选口径等于报了一个构造性 100%。',
    '⚠ 「登记 ≠ 可达」：not_reachable 的 kind 在网络上永远取不到数。',
    'R 档只读。',
  ].join('\n'),

  'p1b_audit_g2_contract': [
    '契约表「源码派生」复现检查：全文件零 writeFileSync，用它确认契约表与源码没有分家。',
    '怎么读：stdout 逐条列派生结果；`--strict` 下有 missing_fn / frozen_not_read 时退出 1。',
    'R 档只读。',
  ].join('\n'),

  'p1b_audit_prereg_freeze': [
    '检查 PREREG 冻结块有没有被人改过时用这条（重算 sha256 并与冻结登记比对）。',
    '怎么读：⚠ 报告 MATCH=false 时**必须原样报告「冻结件已被修改」** —— 不要重试，',
    '不要改口径重算，更不要说成通过。',
    '⚠ exit 3 在这条命令上是**真崩溃不是裁决**（p1b/scripts/prereg-freeze.cjs:66 的解析异常），',
    '与 `p1b_audit_anchor_gate` 的 exit 3 语义相反，别把两者的读法互换。',
    'R 档只读（只有显式 --write 才会改文件，本层不给）。',
  ].join('\n'),

  'p1b_audit_g2_audit_build': [
    '构造抽检清单 v2 用这条。',
    '怎么读：产物落暂存目录，路径见 `structuredContent.output_dir`。',
    'F 档，只写暂存目录。',
  ].join('\n'),

  'p1b_backup_offsite': [
    '⚠ 只读预览。**这条工具永远不会真的备份** —— 同 W 档一样，本层永不带 --确认，',
    '确认闸在子进程启动前就返回了。',
    '怎么读：返回 `isError:false` ＋ `verdict.gate=\'NOT_CONFIRMED\'` ＋ `will_execute`（完整命令行）。',
    '**不要重试。** 要真备份：把 `will_execute` 交给人类在终端加 --确认 执行。',
    '⚠ 档位说明别搞错：这条是 F 档 —— 它**只写备份目录，不碰 p1a.db**；',
    '过确认闸不是因为它写库，是因为它真的在写盘。目标与生产库同盘时子脚本会直接拒。',
  ].join('\n'),

  'p1b_backup_restore_drill': [
    '想验证「备份真的能救回来」时用这条：从备份里挑一份恢复到临时件，校验 sha256、',
    'integrity_check、核心表行数与内容 sha256，然后报告能不能用。',
    '怎么读：⚠ exit 3 表示**这份备份不可用**（不是 0，也不是「演练失败」这种模糊说法），',
    '照实报告哪一份、哪一项校验没过。',
    '★**它绝不碰生产库** —— 只写 .run-out/ 下的临时件。产物路径见 `structuredContent.output_dir`。',
    'F 档，不经确认闸（它不写生产库）。',
  ].join('\n'),
};

/** 组 key → 人类可读组名，写进 tool title。 */
const GROUP_ZH = { doctor: '体检', settle: '结算', read: '读数', audit: '门禁', backup: '备份' };

/** 工具名 → 命令对象（在 `commands.cjs` 上直接查，不复述字段）。 */
const BY_NAME = new Map();
/** 命令 → 工具名，反向索引（`callTool` 用）。 */
const NAME_OF = new Map();

/** 全 ASCII 小写蛇形：MCP 工具名走 DNS-like 命名，中文与点号都不合法。 */
const NAME_RE = /^[a-z][a-z0-9_]*$/;

/**
 * 启动即断言：命令表与本表**双向**对得上。
 * 少一条 = 少暴露一个能力（模型永远不知道它存在）；多一条 = 凭空多一个工具面。
 * 两种都是对外契约破损，所以宁可拒绝启动。
 */
function assertCoverage() {
  const problems = [];
  // 由命令表机械推出的真实工具名集合，用于查「孤儿描述」与「缺描述」。
  const RAW_NAMES = new Set(C.allCommands().map((c) => 'p1b_' + c.group.key + '_' + ASCII[c.group.key + '/' + c.zh]));
  for (const c of C.allCommands()) {
    const k = c.group.key + '/' + c.zh;
    if (!ASCII[k]) problems.push('命令表有、本表没有：' + k);
  }
  for (const k of Object.keys(ASCII)) {
    const hit = C.allCommands().find((c) => c.group.key + '/' + c.zh === k);
    if (!hit) problems.push('本表有、命令表没有：' + k);
  }
  for (const n of Object.keys(DESC)) {
    if (!RAW_NAMES.has(n)) problems.push('描述指向不存在的工具（命令表里没这个工具名）：' + n);
  }
  for (const n of RAW_NAMES) {
    if (!DESC[n]) problems.push('工具没有描述（模型会挑不到它）：' + n);
  }
  const seen = new Map();
  for (const c of C.allCommands()) {
    const n = toolName(c);
    if (!NAME_RE.test(n)) problems.push('工具名不是全 ASCII 小写蛇形：' + n);
    if (seen.has(n)) problems.push('工具名撞车：' + n + '（' + seen.get(n) + ' 与 ' + c.group.key + '/' + c.zh + '）');
    seen.set(n, c.group.key + '/' + c.zh);
  }
  if (problems.length) throw new Error('[p1b/mcp] 工具表与 commands.cjs 对不上，拒绝启动：\n  - ' + problems.join('\n  - '));
}

/** 从工具名反查 ASCII 键（仅本表内部用）。 */
function kOf(name) {
  const m = /^p1b_([a-z]+)_([a-z0-9_]+)$/.exec(name);
  if (!m) return null;
  for (const k of Object.keys(ASCII)) {
    if (ASCII[k] === m[2] && k.split('/')[0] === m[1]) return k;
  }
  return null;
}

/** 命令 → 工具名。 */
function toolName(c) {
  return 'p1b_' + c.group.key + '_' + ASCII[c.group.key + '/' + c.zh];
}

assertCoverage();
for (const c of C.allCommands()) {
  const n = toolName(c);
  const k = c.group.key + '/' + c.zh;
  BY_NAME.set(n, c);
  NAME_OF.set(k, n);
}

/** 命令级元数据（含 `group`，`commands.cjs` 的 `allCommands()` 已经挂好了）。 */
function lookup(name) { return BY_NAME.get(name) || null; }
function nameOfCommand(c) { return NAME_OF.get(c.group.key + '/' + c.zh) || null; }
function allTools() { return Array.from(BY_NAME.keys()); }
function asciiMap() { return Object.assign({}, ASCII); }
function exit3Of(name) { const c = BY_NAME.get(name); return c ? (EXIT3[c.group.key + '/' + c.zh] || null) : null; }

/** 该命令的位置参数 → MCP inputSchema。 */
function posSchema(c) {
  const k = c.group.key + '/' + c.zh;
  const props = {};
  const required = [];
  for (const p of c.pos || []) {
    const s = POS[k];
    if (!s) throw new Error('[p1b/mcp] 命令有 pos 但本表没登记 schema：' + k);
    props[s.key] = { type: 'string', description: s.desc };
    required.push(s.key);
  }
  const schema = { type: 'object', properties: props, additionalProperties: false };
  if (required.length) schema.required = required;
  return schema;
}

module.exports = {
  ASCII, POS, EXIT3, DESC, DISCLAIMER, GROUP_ZH,
  lookup, nameOfCommand, allTools, asciiMap, exit3Of, posSchema, toolName, assertCoverage,
};

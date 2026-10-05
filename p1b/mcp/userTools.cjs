'use strict';
/**
 * p1b/mcp/userTools.cjs —— 「对外工具表」：三条**帮人用**的工具（2026-09-30 · MCP 缺口第 ①②③ 组）
 *
 * ── 为什么是第二张表，而不是往 commands.cjs 里加三条 ────────────────────────
 *   `toolTable.cjs` 那 18 条是 `p1b/cli/commands.cjs` 的**投影**（1:1，启动即断言）。
 *   这三条能力在 CLI 侧**没有对应命令**，硬塞进去要付三笔账：
 *     ① 「记一笔」的落账通路今天只有 HTTP 端点与网页（`web/src/api.ts:313` 记着这条病象）。
 *        为了让 CLI 能预览它就得新造一条**生产写路径**——那是账本不可变纪律的头号风险区，
 *        本批授权里没有它。
 *     ② 「我在哪类事上偏」原先只活在网页组件里（判据已于 2026-09-30 抽成
 *        `p1b/src/disclosure/habitRank.mjs`，另两轨在动 `routes/disclosure.js`）。
 *     ③ 「该归哪一类」的真源 `p1b/src/evidence/revealClass.js` 一直是内部件。
 *   而改 `commands.cjs` 还会连带牵动 `p1b/skill/SKILL.md` 的投影金样
 *   （`p1b/test/skill-projection.test.cjs`）与 CLI 档位金样。
 *   ⇒ 分开放：CLI 那张表**一个字都没动**（18 条仍 1:1），对外这三条单独立表、自己断言。
 *
 * ── 两条不可让步的边界 ──────────────────────────────────────────────────────
 *   ① **本层对 p1a.db 的权限仍然是零**：这三条全是 spawn 子进程或干脆不 spawn。
 *      本件不 require `p1b/src/**`、不 require `p1b/scripts/**`、不开任何 db 句柄
 *      （机械证明见 `p1b/test/mcp-no-ledger-write.test.cjs` 的静态扫描，它扫的是本目录全部 .cjs）。
 *   ② **写意图必须过确认闸，且闸永不打开**：`p1b_note_record` 是写意图工具，但它
 *      **一次子进程都不起**——与 `p1b_settle_corpus` 同构（`toolTable.cjs` 的 DESC 里
 *      「这条工具永远不会真的结算」是同一句话）。⇒ **真正能写库的 MCP 工具数仍然是 0。**
 *
 * ── 两条工具的判据单一真源（**不重写**）────────────────────────────────────
 *   `p1b_where_i_bias` → require `p1b/src/disclosure/habitRank.mjs`（与只读端点、网页组件同源）
 *   `p1b_which_layer`  → require `p1b/src/evidence/revealClass.js` + `resolveKind.js`
 *   两个子脚本自己去 require 它们的真源；本层只 spawn，不碰判据。
 *
 * ── 禁词 ────────────────────────────────────────────────────────────────────
 *   合规红线（设计书 :560）：发给外部的 description / title / inputSchema 里**不得出现**
 *   「预测」二字。本件的文案全部现写，且 `p1b/test/mcp-golden.test.cjs` ④ 照旧扫。
 */

const path = require('path');
const { spawnSync } = require('child_process');
// DISCLAIMER 住在 toolTable（18 条那份的唯一真源）；两处必须同一句话，否则对外文案会分叉。
const { DISCLAIMER } = require('./toolTable.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'p1b', 'scripts');

/** 本层构造的 argv 里永不出现的两个 token（与 `cliBridge.cjs` 的 CONFIRM_TOKENS 同源）。 */
const CONFIRM_TOKENS = ['--确认', '--confirm'];

/** CLI 的确认闸码（`p1b/cli/index.cjs:49`）。`p1b_note_record` 复用它，让模型读到的是同一个语义。 */
const GATE_EXIT_USAGE = 2;

/** 只读子进程的兜底超时（与 `cliBridge.cjs` 的 180s 同量级；这两个件都是纯读 JSON，秒回）。 */
const SPAWN_TIMEOUT_MS = 180000;

/** 新增的对外工具都是中文语义，注释与文案里的例子一律避开任何形似真端点的串。 */

/**
 * 三条工具的声明表。
 * `run` 决定调用形态：
 *   · 'spawn-script' —— spawn 一个**只读**子脚本，argv 由本件白名单式拼（调用方给的未知键进不去）
 *   · 'confirm-gate' —— 一个子进程都不起，返回确认闸预览（与 CLI 闸同构）
 */
const USER_TOOLS = [
  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'p1b_note_record',
    title: '记账 · 记一笔',
    run: 'confirm-gate',
    schema: {
      type: 'object',
      properties: {
        statement: {
          type: 'string',
          description: '用户要记的那道判断，一句话，把时间点和口径都写进去（例：「明天 上海 最高气温 > 35°C」）。★空字符串或纯空白按缺字段处理。',
        },
        prob: {
          type: 'number',
          description: '用户自己的确信度，**0 到 1 之间的数**（0.8 表示八成）。★不是 0-100 的百分数；必须来自用户填的那个数，不许替他取基率顶。区间是**闭区间 [0,1]**：0 是「我押它不发生」、1 是「我押它一定发生」，两者都是合法判断、不是没填。越界（<0 或 >1 或不是数）本工具会拒收并说清边界。',
        },
        kind: {
          type: 'string',
          description: '真值锚的 kind（答案去哪查），可省。★想知道哪些 kind 算数、能不能自动查，用 p1b_which_layer，本工具不替你判定它合不合法。',
        },
        date: {
          type: 'string',
          description: '这道题的到期日（YYYY-MM-DD），可省。★到期日由真值锚推导，本工具只把你给的原样带进落账草案，不替你推。',
        },
      },
      required: ['statement', 'prob'],
      additionalProperties: false,
    },
    annotations: {
      // 写意图 ⇒ 客户端可能想拦一下；本工具**结构上**写不了任何东西（不起子进程），
      // 所以 destructiveHint 诚实地是 false，不是默认的 true。
      readOnlyHint: false,
      destructiveHint: false,
      // 调两次与调一次的差别是零：它连子进程都不起，什么都不写。
      idempotentHint: true,
      openWorldHint: false,
    },
    desc: [
      '用户说「帮我记一道判断」「把这句话记下来，到期了替我核」时用这条。',
      '',
      '⚠ 只读预览。**这条工具永远不会真的记账** —— 它一个子进程都不起，账本一个字节都不动。',
      '   与 `p1b_settle_corpus` 同构：确认闸在动作之前就拦下了（`verdict.gate=\'NOT_CONFIRMED\'`）。',
      '   **这不是失败，也绝不是重试信号 —— 任何情况下都不要重试本工具。**',
      '',
      '怎么读：返回 `recorded:false` ＋ `verdict.gate=\'NOT_CONFIRMED\'` ＋ `write_plan`。',
      '  · `write_plan` 是**落账草案**：题面、你的 0-1 确信度、真值锚、以及**还缺哪几项**。',
      '    缺项会逐条列在 `write_plan.missing` 里 —— 本项目把「没填真值锚」判成备忘而不是账本行，',
      '    所以缺项不是本工具挑刺，是账本自己要的。',
      '  · `how_to_record` 是三条**已经存在**的落账通路（按名字列出，不含任何地址与令牌）。',
      '    要真记账：由人类自己选一条走。',
      '',
      '不能做什么（逐条，别替它圆过去）：',
      '  · **不预判未来**：它不查这道题会不会发生，也不给任何关于未发生之事的说法。',
      '  · **不给建议**：它不判断这个题该不该记、该不该改口径。',
      '  · **不碰私钥**：它不读、不存、不打印任何令牌或密钥。',
      '  · **不代你落账**：越权写账本的事它一律不做。',
      '',
      '越界时返回什么：',
      '  · `statement` 缺失/空白，或 `prob` 不是数、落在 [0,1] 之外 ⇒ `isError:true` ＋',
      '    `verdict.gate=\'INPUT\'`，逐条说清缺哪一项、合法范围是什么（照抄账本自己的口径，',
      '    不另立一套）。这是**用法错**，补齐后可以重试 —— 与上面的「不要重试」是两回事，别混。',
      '  · ★`prob` 恰好等于 0 **不是**缺填**（那是「我押它不发生」）；把 0 当成「没给」',
      '    会让一条真实判断凭空消失，而账本上再也找不回来。',
      '  · 其余一切情况（含正常调用）⇒ `isError:false` ＋ `NOT_CONFIRMED`，**照常不要重试**。',
    ].join('\n'),
  },

  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'p1b_where_i_bias',
    title: '打分 · 我在哪类事上偏',
    run: 'spawn-script',
    script: 'where-i-bias.cjs',
    scriptArgs: () => ['--json'],
    schema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    desc: [
      '用户问「我准不准」「我在哪类事上偏」「为什么我老在同一件事上错」时用这条：',
      '按题域归并的偏差榜（相对「一律报五成」的无信息线），只统计**已结算**的题。',
      '',
      '怎么读：`content[0].text` 是子进程原文（JSON），`structuredContent.data` 是同一份的解析结果：',
      '  · `data.habits` 是榜：`{domain, n, ok, delta}`，按 `|delta|` **降序**（偏得最厉害的排最前）。',
      '  · ⚠ **`delta` 的分母是「够样本的格数 ok」，不是题数 n** —— 引用时必须照实说这是格数。',
      '    同一行里 `n` 是题数、`ok` 是够样本的格数，两个数都在，别只挑一个报。',
      '  · `data.dropped_domains` 是**被剔掉**的域（一个够样本的格都没有 ⇒ 按 n<30 纪律只记方向、不给比例）。',
      '    ★**空榜不是「你没偏」**，是「还没测够」——两者必须分开说。',
      '  · `data.ranking` 是这套口径的人话版（跟着计算走，不另写一份解释）。',
      '',
      '不能做什么（逐条）：',
      '  · **不预判未来**：只报已结算题目的历史统计事实，尚未到期的题一件都不在里面。',
      '  · **不给建议**：不给总分、不给「你准不准」的裁决句，也不推荐下一步。裁决留给读的人。',
      '  · **不出总分**：跨域池化会造出一个谁都没算过的数，本工具刻意不给。',
      '  · **不碰私钥**：不读任何令牌或密钥。',
      '',
      '越界时返回什么：',
      '  · 缺披露件（`p1b/sim/out` 下没有校准报告）⇒ `isError:true` ＋ `verdict.gate=\'ERROR\'`，',
      '    stderr 里带生成命令。★这是环境问题，重试无用 —— **照实说「读不到」，不要报成「你没偏」**。',
      '  · `n` 不足 30 的格不在榜上、也不在 `dropped_domains` 的任何比例字段里：只记方向。',
    ].join('\n'),
  },

  // ────────────────────────────────────────────────────────────────────────────
  {
    name: 'p1b_which_layer',
    title: '裁决 · 这事该归哪一类',
    run: 'spawn-script',
    script: 'reveal-class-query.cjs',
    scriptArgs: (args) => (args && args.kind ? ['--kind', String(args.kind), '--json'] : ['--json']),
    schema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          description: '真值锚的 kind（例：`binance_daily_close`）。★省掉就给全表摘要。',
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    desc: [
      '用户问「这件事机器能自己查吗」「这个答案机器拿得到吗」「到期谁来结」「这类题归哪一类」时用这条：',
      '把揭晓分流那张表端出来 —— 每个 kind 归入**互斥且完备**的三类之一，并报它是否在支持表内。',
      '  · `ok`    机器能自动结（到期守护进程自己去查）—— **这不是用户的活**。',
      '  · `human` 要人答（机器拿不到，但人能答，例如要等官方开奖公告）。',
      '  · `stuck` 永远结不了（接口封禁／真值窗口已滑出）—— ★**不给假按钮**：给一个点了没反应的',
      '    按钮比不给更糟，用户会以为是 bug。',
      '',
      '怎么读：给了 `kind` 就返回 `data.one`（单条），不给就返回 `data.kinds`（全表）＋ `data.by_class` 计数。',
      '  · ⚠ **未登记的 kind 一律按 `human` 处理**（保守：宁可问一句，不给错按钮），',
      '    同时 `data.one.registered_in_reveal_class` 为假、`data.one.supported_kind` 为假 ——',
      '    ★**这两件事要原样报出来**：「按需人确认」和「它压根不在支持表里」不是一回事。',
      '  · 分类依据是 **kind 的固有属性**（登记的取数能力），不是某次运行日志 —— 后者没落库、查不到。',
      '',
      '不能做什么（逐条）：',
      '  · **不预判未来**：它只答「这类题的答案机器能不能自己拿到」，不答「结果会是什么」。',
      '  · **不给建议**：不替你挑一个 kind，也不替你判断该不该用这个题。',
      '  · **不替你归层**：把一句话归到 L1–L6 属于接题端点那条线，**本工具不做**，别假装它做了。',
      '  · **不碰私钥**：不读任何令牌或密钥。',
      '  · **不写任何东西**：零写盘、零写库、零网络。',
      '',
      '越界时返回什么：',
      '  · 冻结契约表读不到 ⇒ `isError:true` ＋ `verdict.gate=\'ERROR\'`，**不给任何「可达/不可达」结论**。',
      '    放行等于把今天的病原样留在库里，所以宁可整份不答。',
      '  · 传了本工具不认的 `kind` 之外的东西 ⇒ schema 层就拒（`additionalProperties:false`）。',
      '  · 传了一个没见过的 kind **不是错**，是 `human` ＋ 两处「未登记」标记，照实报。',
    ].join('\n'),
  },
];

const BY_NAME = new Map(USER_TOOLS.map((t) => [t.name, t]));

/** 全 ASCII 小写蛇形（与 `toolTable.cjs` 的 NAME_RE 同一条，防混进中文或点号）。 */
const NAME_RE = /^[a-z][a-z0-9_]*$/;

/**
 * 启动即断言这张表自己。
 * 理由与 `toolTable.assertCoverage` 相同：工具表是对外暴露面，多一条少一条都必须**当场**发现。
 * 这里额外钉住「写意图工具必须是不起子进程的那一种」——**这是本件最贵的不变量**：
 * 一旦有人给 `p1b_note_record` 配上 script，它就会从「预览」变成「写库」，
 * 而那种改动在 tools/list 里**看不出来**（名字、条数、描述都可能一个字没改）。
 */
function assertUserCoverage() {
  const problems = [];
  const seen = new Map();
  for (const t of USER_TOOLS) {
    if (!NAME_RE.test(t.name)) problems.push('工具名不是全 ASCII 小写蛇形：' + t.name);
    if (!t.name.startsWith('p1b_')) problems.push('工具名必须以 p1b_ 前缀开头：' + t.name);
    if (seen.has(t.name)) problems.push('工具名撞车：' + t.name);
    seen.set(t.name, 1);
    if (!t.desc) problems.push('工具没有描述：' + t.name);
    if (t.desc.indexOf('不能做什么') < 0) problems.push('描述里没有「不能做什么」段：' + t.name);
    if (t.desc.indexOf('越界时返回什么') < 0) problems.push('描述里没有「越界时返回什么」段：' + t.name);
    if (t.run === 'spawn-script') {
      if (!t.script) problems.push('spawn-script 工具没登记子脚本：' + t.name);
      if (t.annotations.readOnlyHint !== true) problems.push('子进程型工具必须自报 readOnlyHint=true：' + t.name);
      if (t.annotations.openWorldHint !== false) problems.push('子进程型工具本批一律不打网：' + t.name);
    } else if (t.run === 'confirm-gate') {
      // ★写意图工具的结构性保证：它**不许**有 script。
      if (t.script) problems.push('★confirm-gate 工具不许挂子脚本（那会让它从预览变成真写）：' + t.name);
      if (t.annotations.destructiveHint !== false) problems.push('confirm-gate 工具写不了任何东西，destructiveHint 必须是 false：' + t.name);
    } else {
      problems.push('未登记的 run 形态：' + t.name + ' → ' + t.run);
    }
  }
  if (problems.length) throw new Error('[p1b/mcp] 对外工具表自检不过，拒绝启动：\n  - ' + problems.join('\n  - '));
}

/** MCP `Tool` 形状（与 `tools.cjs` 的 toolDef 同形，字段一个不少）。 */
function toolDef(t) {
  return {
    name: t.name,
    description: t.desc,
    inputSchema: t.schema,
    annotations: {
      title: t.title,
      readOnlyHint: t.annotations.readOnlyHint,
      destructiveHint: t.annotations.destructiveHint,
      idempotentHint: t.annotations.idempotentHint,
      openWorldHint: t.annotations.openWorldHint,
    },
  };
}

function listUserTools() { return USER_TOOLS.map(toolDef); }
function allUserToolNames() { return USER_TOOLS.map((t) => t.name); }
function lookupUserTool(name) { return BY_NAME.get(name) || null; }

/**
 * 拼只读子进程的 argv。**白名单式**：只认本表登记的那几个键，其余一律进不去
 * （与 `cliBridge.buildArgv` 同一套纪律：调用方塞进来的 `--确认`／`--write` 到不了命令行）。
 */
function buildUserArgv(t, args) {
  const argv = (t.scriptArgs ? t.scriptArgs(args || {}) : []).map(String);
  for (const tok of CONFIRM_TOKENS) {
    if (argv.indexOf(tok) >= 0) throw new Error('[p1b/mcp] 拒绝执行：argv 里出现了确认 token ' + tok);
  }
  return argv;
}

/** spawn 一个只读子脚本，收回 stdout/stderr/退出码。**本层自己一个字节都不解析业务语义。 */
function spawnUserScript(t, args, opt) {
  const scriptPath = path.join(SCRIPTS, t.script);
  const argv = buildUserArgv(t, args);
  const res = spawnSync(process.execPath, [scriptPath].concat(argv), {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: (opt && opt.env) || process.env,
    timeout: SPAWN_TIMEOUT_MS,
  });
  if (res.error) {
    return { toolName: t.name, argv, exit: 1, stdout: '', stderr: '✗ spawn 失败：' + res.error.message, signal: null };
  }
  if (res.signal) {
    return { toolName: t.name, argv, exit: null, stdout: String(res.stdout || ''), stderr: String(res.stderr || ''), signal: res.signal };
  }
  return {
    toolName: t.name,
    argv,
    exit: res.status,
    stdout: String(res.stdout || ''),
    stderr: String(res.stderr || ''),
    signal: null,
  };
}

assertUserCoverage();

/**
 * 落账草案的三件必填（题面 / 真值锚 / 你的判断）——**照抄账本自己的口径，不另立一套**：
 *   · 必填三件与检查顺序：`p1b/web/src/lib/noteProb.ts` 的 `submitGuard`（先查没作答的、再查给了但不对的，
 *     好让用户一次只面对一件没做的事）。
 *   · `prob` 收 **闭区间 [0,1]**：`p1b/src/routes/predictions.js:75-81` 的 `requireProb` 就是这条。
 *     ★0 与 1 都是**合法判断**（押它不发生／押它一定发生），不是「没填」——
 *     把 0 当成缺填会让一条真实判断凭空消失，而账本不可变、找不回来。
 *   · 拒收分三种说法，因为它们要的下一步不同：没填 / 不是数 / 越界。
 *
 * ★本函数**不查账本、不查支持表**：真值锚合不合法归 `p1b_which_layer` 管，
 *   描述里已明说这一点（同一个问题出两个答案比一个答案更坏）。
 *
 * @returns {{ok:true, plan:object}|{ok:false, bad:Array<{field:string, why:string}>}}
 */
function buildNotePlan(args) {
  const a = args || {};
  const bad = [];
  const stmt = (a.statement === undefined || a.statement === null ? '' : String(a.statement)).trim();
  if (stmt === '') bad.push({ field: 'statement', why: '还没写这道题在问什么 —— 题面是必填的，空着记下来只是一条备忘，进不了账本。' });
  const kind = (a.kind === undefined || a.kind === null ? '' : String(a.kind)).trim();
  if (kind === '') bad.push({ field: 'kind', why: '还没选「答案去哪里查」—— 真值锚决定这道题到期时有没有地方能核对；没有它就不是账本行。想知道哪些 kind 算数，用 p1b_which_layer。' });

  const p = a.prob;
  let prob = null;
  if (p === undefined || p === null) {
    bad.push({ field: 'prob', why: '还没给出你的判断：这道题是拿来看你押得准不准的，不填就没有「当时押了多少」，到期后也无从知道自己偏在哪儿。' });
  } else if (typeof p !== 'number' || !Number.isFinite(p)) {
    bad.push({ field: 'prob', why: '看不懂这一项：写一个 0 到 1 之间的数就行，比如 0.62（表示你押六成二）。收到：' + JSON.stringify(p) });
  } else if (p < 0 || p > 1) {
    bad.push({ field: 'prob', why: '这个数不在 0 到 1 之间（收到 ' + p + '）：0 是「我押它不发生」，1 是「我押它一定发生」，两端都合法。' });
  } else {
    prob = p;
  }

  if (bad.length) return { ok: false, bad };
  return {
    ok: true,
    plan: {
      statement: stmt,
      // ★原样带用户那个数。不换算、不取整、不拿任何基率顶（`noteProb.ts` 纪律①：
      //   assigned_prob 记的是「人当时押多少」，被基率污染是不可见的）。
      assigned_prob: prob,
      resolve_spec: { kind: kind, date: (a.date === undefined || a.date === null ? null : String(a.date).trim()) || null },
      layer: null,
      secondary_layer: null,
      engine: null,
      gate: null,
    },
  };
}

/**
 * 确认闸路径：**一个子进程都不起**。
 *
 * 为什么不给 `will_execute` 一行命令行（`p1b_settle_corpus` 给了）：
 *   闸后面那件事在 CLI 侧**没有对应命令**（落账通路今天只有 HTTP 端点与网页，见文件头），
 *   硬编一行命令出来就是**编造一个不存在的执行路径** —— 模型会照着它去找，找不到就
 *   当成工具坏了。⇒ 如实给 `how_to_record`（三条真实通路，按名字列出），
 *   并且**不带任何地址与令牌**（本层不读、不存、不打印密钥）。
 *
 * @returns {{isError:boolean, structuredContent:object, content:Array}}
 */
function callConfirmGateTool(t, args) {
  const check = buildNotePlan(args);
  const base = { tool: t.name, exit: GATE_EXIT_USAGE, disclaimer: DISCLAIMER };

  if (!check.ok) {
    return {
      isError: true,
      content: [{ type: 'text', text: '✗ 记一笔草案没成形：' + check.bad.map((b) => b.field + ' —— ' + b.why).join('\n  ') }],
      structuredContent: Object.assign({}, base, {
        recorded: false,
        verdict: { gate: 'INPUT', bad_fields: check.bad.map((b) => b.field) },
        problems: check.bad,
        hint: '★这是用法错（草案没成形），**不是**确认闸拦下了执行：补齐上面列出的项后可以重试。'
          + '本工具永远不会真的记账，重试也不会让它记账。',
      }),
    };
  }

  const L = [];
  L.push('✗ 这是写账本的命令，确认闸默认只读 ⇒ **未执行**（子进程未启动，一个字节都没写）。');
  L.push('  工具　：' + t.name);
  L.push('  状态　：recorded=false（账本未动）');
  L.push('  落账草案：');
  L.push('    题面　　　：' + check.plan.statement);
  L.push('    你的判断　：' + check.plan.assigned_prob + '（0-1，原样带你的数，未做任何换算）');
  L.push('    真值锚　　：' + check.plan.resolve_spec.kind + (check.plan.resolve_spec.date ? '　到期日：' + check.plan.resolve_spec.date : '　到期日：未给（由真值锚推导）'));
  L.push('  缺的项　　：无（题面 / 真值锚 / 你的判断三件齐了）');
  L.push('  要真记账　：由人类自己选一条已存在的通路走 ——');
  L.push('    ① 网页「记一笔」页（人机同源，前端会替你做换算与提交）');
  L.push('    ② HTTP 落注端点（外部程序用；需共享令牌，本工具不读也不打印任何令牌）');
  L.push('    ③ HTTP 接题归层端点（先过拒收门三问再落账的那条路）');
  L.push('');
  L.push('★不要重试本工具：重试不会让它记账。要记账，请把上面这份草案交给人类。');

  return {
    isError: false,
    content: [{ type: 'text', text: L.join('\n') }],
    structuredContent: Object.assign({}, base, {
      recorded: false,
      gate_not_confirmed: true,
      verdict: { gate: 'NOT_CONFIRMED', do_not_retry: true },
      write_plan: check.plan,
      // ★没有 will_execute：闸后面没有一条现成的命令行（见本函数头注）。
      //   给一个不存在的执行路径比不给更坏 —— 模型会照着它去找，找不到就当成工具坏了。
      will_execute: null,
      will_execute_absent_why: '闸后面那件事在 CLI 侧没有对应命令（落账通路只有 HTTP 端点与网页），'
        + '所以这里没有可粘贴的命令行。编一行出来就是编造一个不存在的执行路径。',
      how_to_record: [
        '网页「记一笔」页（人机同源）',
        'HTTP 落注端点（需共享令牌；本工具不读也不打印任何令牌）',
        'HTTP 接题归层端点（先过拒收门三问的那条路）',
      ],
      hint: '确认闸拦下了这次调用，账本未动。不要重试本工具；要真记账，把 write_plan 交给人类走上面三条通路之一。',
    }),
  };
}

module.exports = {
  USER_TOOLS, CONFIRM_TOKENS, GATE_EXIT_USAGE, SPAWN_TIMEOUT_MS,
  listUserTools, allUserToolNames, lookupUserTool, toolDef,
  buildUserArgv, spawnUserScript, assertUserCoverage,
  buildNotePlan, callConfirmGateTool, DISCLAIMER,
};

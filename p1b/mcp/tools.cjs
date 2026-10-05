'use strict';
/**
 * p1b/mcp/tools.cjs —— `tools/list` 与 `tools/call`。
 *
 * ── 两张工具表，一个出口（2026-09-30 起）────────────────────────────────────
 *   · **18 条 CLI 投影**：`toolTable.cjs` ＝ `p1b/cli/commands.cjs` 的 1:1 投影，一个字没改。
 *   · **3 条对外工具**：`userTools.cjs`。它们在 CLI 侧**没有对应命令**
 *     （「记一笔」的落账通路只有 HTTP 与网页；「我在哪类事上偏」原先只在网页；
 *      「该归哪一类」的真源一直是内部件），硬塞进命令表要么新造一条生产写路径、
 *      要么复制判据，两者都越过本批授权 ⇒ 单独立表（理由见该件头注）。
 *   两张表**共用同一个 exit 码映射**（`exitMap.cjs`），所以模型读两种来源读到的是同一套
 *   退出码语义，不需要学两遍。启动时两张表各自断言（`assertCoverage` / `assertUserCoverage`）。
 *
 * ── 档位 → ToolAnnotations 是 1:1 抄写，不是重新设计 ────────────────────────
 *  `p1b/cli/commands.cjs` 已经把 18 条分成 R/F/W 三档并标了 net（实测 R10 / F7 / W1，
 *  net 唯一一条是 `settle/语料`）。这套分类是本项目「默认只读」纪律的载体，
 *  本层**照抄**成 MCP 的四个 hint。**不发明新分类**：一旦这里自己再分一次类，
 *  两套分类就会各说各话，而暴露给外部的是本层这一套。
 *
 * ── 逐条的对应与理由 ──────────────────────────────────────────────────────
 *   R（只读，零写盘零写库）  readOnlyHint:true  destructiveHint:false  idempotentHint:true   openWorldHint:false
 *   F（写盘不写库，只落暂存） readOnlyHint:false destructiveHint:false  idempotentHint:false  openWorldHint:false
 *   W（写 p1a.db）          readOnlyHint:false destructiveHint:TRUE   idempotentHint:true   openWorldHint:false
 *   N（打网络）             三项不变                                        openWorldHint:TRUE
 *  destructiveHint 的默认是 true（MCP 规范原文），所以 R/F 必须**显式写 false**，
 *  否则「只写暂存目录」会被客户端当成破坏性操作弹确认 —— 而它们不是。
 *
 *  ★**F 档 idempotentHint:false 的理由**：CLI 给每次调用生成新的时间戳暂存目录
 *  （`p1b/cli/index.cjs` 的 stamp()），连调两次会在磁盘上留下两批产物。
 *  「对环境无额外效果」在**生产账本**的意义上成立（它不碰 p1a.db），但在**磁盘**上不成立。
 *  写 true 就是在对客户端说谎。
 *
 *  ★**W 档 idempotentHint:true 的理由**：结算是把「已到期未结算」的题逐条 resolve，
 *  跑第二遍它们已经结算掉了，是空操作。
 *
 * ── 联机工具的环境闸 ──────────────────────────────────────────────────────
 *  `P1B_MCP_ALLOW_NET=0` 时不注册 net:true 的工具（默认注册）。
 *  默认开着是因为本层 18 条里唯一的联网件（W+confirm）**结构上就发不出网**：
 *  确认闸在 spawn 之前 return 了。要更严的部署把这个环境变量设成 0，
 *  tools/list 会从 18 掉到 17，测试里对这个行为有断言。
 */

const T = require('./toolTable.cjs');
const U = require('./userTools.cjs');
const { callCli } = require('./cliBridge.cjs');
const { mapExit } = require('./exitMap.cjs');

/** MCP 2026-07-28：服务端必须自报支持版本，客户端从里面挑一个。 */
const PROTOCOL_VERSION = '2026-07-28';

function netAllowed(env) {
  const e = env || process.env;
  return String(e.P1B_MCP_ALLOW_NET || '1') !== '0';
}

/** 档位 → ToolAnnotations（1:1 抄 commands.cjs，不重新设计）。 */
function annotationsOf(c) {
  const readOnly = c.tier === 'R';
  return {
    title: c.group.zh + ' · ' + c.zh,
    readOnlyHint: readOnly,
    // 默认值是 true，所以每个非只读档都要显式写出来，不能靠省略。
    destructiveHint: c.tier === 'W',
    idempotentHint: c.tier === 'R' ? true : (c.tier === 'W' ? true : false),
    openWorldHint: !!c.net,
  };
}

/** 某条命令的工具定义（MCP `Tool` 形状，schema.ts:Tool）。 */
function toolDef(c) {
  const name = T.toolName(c);
  return {
    name,
    description: T.DESC[name],
    // 不写 $schema：官方 Tool.inputSchema 的注释说「无 $schema 时缺省即 JSON Schema 2020-12」。
    inputSchema: T.posSchema(c),
    annotations: annotationsOf(c),
  };
}

/** tools/list 的 tools 数组 = 18 条 CLI 投影 ＋ 3 条对外工具。`allowNet=false` 时滤掉 net:true 的那一条。 */
function listTools(opt) {
  const allowNet = !opt || netAllowed(opt.env);
  const out = [];
  for (const name of T.allTools()) {
    const c = T.lookup(name);
    if (c.net && !allowNet) continue;
    out.push(toolDef(c));
  }
  // ★对外工具一律 net:false（三个都不打网），所以不受 allowNet 闸影响 ——
  //   「关掉联机」只该摘掉那条 W+confirm 的语料结算件，不该连只读能力一起摘。
  for (const t of U.listUserTools()) out.push(t);
  return out;
}

/**
 * 拼 `content` 文本块。
 * 只放**模型读得到的原文**，一条都不加工：改写 stdout 就是在 CLI 与 MCP 之间
 * 造第二套口径，本项目已经因日期算法分叉吃过一次实伤（设计书 §2.4 方案 ③ 否决的理由）。
 */
function contentBlock(text) { return { type: 'text', text: text }; }

/** 从 CLI 的「→ node p1b/scripts/… 」那一行里把暂存目录读回来（非 F 档为 null）。 */
function outDirOf(stderr) {
  const m = /[^\r\n]*?\.run-out[\\/]cli[\\/]\d{8}-\d{6}/.exec(stderr || '');
  return m ? m[0].trim() : null;
}

/**
 * tools/call：调 CLI → 映射退出码 → 拼 CallToolResult。
 *
 * 参数校验只做一件：**required 的位置参数在不在**。
 * 更深的校验交给 CLI 自己（它有更全的用法错信息，且那份信息已经写成人话了）。
 *
 * @param {string} name
 * @param {object} args
 * @param {object} [opt] {env}
 * @returns {{resultType:string, content:Array, structuredContent:object, isError?:boolean}}
 */
function callTool(name, args, opt) {
  const allowNet = !opt || netAllowed(opt.env);

  // ── 对外工具（3 条）：与 CLI 投影走**同一个 exit 码映射**，只有 spawn 方式不同 ──
  const u = U.lookupUserTool(name);
  if (u) {
    if (u.run === 'confirm-gate') {
      // ★写意图工具：一个子进程都不起。返回体与 CLI 确认闸同构（verdict.gate='NOT_CONFIRMED'），
      //   所以模型读这两种闸读到的是同一句话，不用学两套语义。
      return Object.assign({ resultType: 'complete' }, U.callConfirmGateTool(u, args || {}));
    }
    const urun = U.spawnUserScript(u, args || {}, opt);
    const umapped = mapExit(urun);
    const utext = urun.stdout + (urun.stderr ? urun.stderr : '');
    const usc = Object.assign({}, umapped.structuredContent, {
      argv: urun.argv,
      stdout_bytes: Buffer.byteLength(urun.stdout, 'utf8'),
      stderr_bytes: Buffer.byteLength(urun.stderr, 'utf8'),
    });
    // 两条只读子进程都带 --json：解析结果挂在 data 上，模型既能读原文也能读结构化字段。
    // 解析失败不抛 —— 原文已经逐字带回来了，解析只是**附加**的一份便利视图。
    if (urun.exit === 0) {
      try { usc.data = JSON.parse(urun.stdout); } catch (e) { usc.data = null; usc.data_parse_error = e.message; }
    }
    const uresult = { resultType: 'complete', content: [contentBlock(utext)], structuredContent: usc };
    if (umapped.isError) uresult.isError = true;
    return uresult;
  }

  const c = T.lookup(name);
  if (!c) {
    // 「找不到这个工具」是**本层**的错（模型叫错了名字），按官方 CallToolResult 的注释，
    // 这类「finding the tool」的错误才该走协议级 error。见 tools.js 的调用方。
    const e = new Error('未知工具：' + name);
    e.protocolError = true;
    throw e;
  }
  if (c.net && !allowNet) {
    const e = new Error('工具已按部署策略下线（不联网）：' + name);
    e.protocolError = true;
    throw e;
  }

  // required 位置参数缺失 ⇒ 交给 CLI 去报它自己的 exit 2（那边的话术是人写的）。
  // 这里**不**自己造一句错误：造了就是第二套用法提示。
  const run = callCli(name, args || {});
  const mapped = mapExit(run);

  const text = run.stdout + (run.stderr ? run.stderr : '');
  const structuredContent = Object.assign({}, mapped.structuredContent, {
    argv: run.argv,
    // F 档产物落在 CLI 自己生成的暂存目录（`.run-out/cli/<时间戳>/`）。本层不去算那个目录
    // —— 算了就等于把 stamp() 的口径抄一份，抄的那份迟早跟原的不一致。直接从 CLI 打印的
    // 「→ node p1b/scripts/… --out-dir <目录>」那一行里读回来，是它说什么就是什么。
    output_dir: outDirOf(run.stderr),
    stdout_bytes: Buffer.byteLength(run.stdout, 'utf8'),
    stderr_bytes: Buffer.byteLength(run.stderr, 'utf8'),
  });

  const result = { resultType: 'complete', content: [contentBlock(text)], structuredContent };
  if (mapped.isError) result.isError = true;   // 只在真错时写这个键：官方说「不写即视为 false」
  return result;
}

module.exports = { listTools, callTool, toolDef, annotationsOf, netAllowed, PROTOCOL_VERSION };

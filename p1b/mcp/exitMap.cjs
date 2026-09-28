'use strict';
/**
 * p1b/mcp/exitMap.cjs —— CLI 退出码 → MCP `CallToolResult`。**本层唯一不能做错的地方。**
 *
 * ── 唯一的核心裁决：exit 3 走成功通道 ──────────────────────────────────────
 *  `p1b/cli/index.cjs:18-20` 写死了这件事：3 是**门禁码，子进程原样透出，CLI 绝不抹平**；
 *  抹平成 1 等于把「防空集被读成通过」和「普通报错」归成同一类。本层把同一条纪律搬过来：
 *
 *      exit 3  ⇒  isError:false  +  verdict.gate = 'FAIL'  +  do_not_retry:true
 *
 *  为什么必须是 `isError:false`：MCP 客户端（和它背后的模型）把 `isError:true` 读成
 *  「这次调用失败了，换个参数重试」。而 exit 3 在 `门禁 锚点` 上恰恰是**一次成功的裁决**——
 *  程序正确地得出了「候选 0 条，不许被读成通过」。把它标成错误，模型就会去重试、
 *  会把它写进「工具报错」段落、会在摘要里消失。**一次成功的判定被标成失败，
 *  等于把结论从输出里删掉。**
 *
 *  为什么**不是** JSON-RPC 协议级 error（-32603，设计书 §2.5 的原方案）：官方
 *  `CallToolResult.isError` 字段自己的注释写着 ——「originate from the tool 的错误
 *  **SHOULD** 在 result 里用 `isError:true` 报，而不是协议级 error，否则 LLM 看不到错误
 *  发生过、无法自我纠正」。协议级 error 会让 `tools/call` 整条失败，模型拿不到 stdout。
 *  同一个道理反向也成立：**裁决更不能走协议级 error**。本层因此统一用
 *  `isError` ＋ `structuredContent` 表达，协议层只保留「找不到这个工具」这一种
 *  `-32602`（那是本层的错，不是工具的错）。
 *
 * ── 逐码表 ────────────────────────────────────────────────────────────────
 *   0  成功                    isError:false，无 verdict
 *   1  CLI 一般错误            isError:TRUE    verdict.gate='ERROR'
 *   2  用法错 / 缺 --确认      见下：**分两种读法**，靠内容嗅探分开
 *   3  门禁码                  isError:false   verdict.gate='FAIL'  ★本件的核心
 *   4  预检失败                isError:TRUE    verdict.gate='PRECHECK'
 *   其它 子进程原码            isError:TRUE    verdict.gate='CHILD_EXIT'
 *
 * ── exit 2 为什么必须再分一次 ──────────────────────────────────────────────
 *  CLI 的 `EXIT.USAGE` 有两个来源，语义完全相反（`p1b/cli/index.cjs:219` 与 `:245`）：
 *   · 「✗ 缺位置参数」  —— 调用方把参数给错了，是**用法错** ⇒ isError:true
 *   · 确认闸打印的「未执行（子进程未启动）」 —— 子进程**一次都没起**，
 *     是**一道设计好的闸在正常工作** ⇒ isError:false，并带上完整预览交给人类
 *  两者都是 2，光看码分不开。本件按 CLI 自己打印的那行确认标记
 *  （`p1b/cli/index.cjs:242` 的「确认执行请加」）嗅探，不用猜、不用改 CLI。
 *  宁可误判成用法错（模型会重试一次）也不能误判成闸放行（模型会以为要写库了）。
 */

const T = require('./toolTable.cjs');

/** CLI 的确认闸提示行（`p1b/cli/index.cjs:242`）。用它把 exit 2 的两种来源分开。 */
const CONFIRM_MARKER = '确认执行请加';

/** 与 `p1b/cli/index.cjs:49` 的 EXIT 表同源，改一处必须改两处。 */
const CLI_EXIT = { OK: 0, ERR: 1, USAGE: 2, GATE: 3, PRECHECK: 4 };

/** 从确认闸的 stderr 里抽出「将要执行什么」那一行，供人类原样复制。 */
function willExecuteOf(stderr) {
  const m = /将要执行：(.+)/.exec(stderr || '');
  return m ? m[1].trim() : null;
}

/**
 * 把一次 CLI 调用映射成 MCP 的 `isError` ＋ `structuredContent`。
 *
 * @param {object} r
 * @param {string} r.toolName  工具名（拿它去查逐命令的 exit 3 语义）
 * @param {number|null} r.exit 子进程退出码；null = 被信号杀
 * @param {string} r.stderr    子进程 stderr（确认闸的预览文本在这里）
 * @param {string} [r.signal]  被信号终止时的信号名
 * @returns {{isError:boolean, structuredContent:object}}
 */
function mapExit(r) {
  const code = r.exit;
  const stderr = r.stderr || '';
  const sc = {
    tool: r.toolName,
    exit: code,
    // 每条返回都带这句：返回体一律是「已结算的历史统计事实」，不是判断，不是建议。
    disclaimer: T.DISCLAIMER,
  };

  if (code === null) {
    return { isError: true, structuredContent: Object.assign(sc, {
      verdict: { gate: 'KILLED', signal: r.signal || null },
      hint: '子进程被信号终止，既不是裁决也不是通过。照实报告，不要重试。',
    }) };
  }

  if (code === CLI_EXIT.OK) {
    return { isError: false, structuredContent: sc };
  }

  if (code === CLI_EXIT.ERR) {
    return { isError: true, structuredContent: Object.assign(sc, {
      verdict: { gate: 'ERROR' },
      hint: 'CLI 一般错误（命令名写错 / spawn 失败）。这是本层的错，不是账本的结论 —— 不要把它当成账本有问题的证据。',
    }) };
  }

  if (code === CLI_EXIT.USAGE) {
    if (stderr.indexOf(CONFIRM_MARKER) >= 0) {
      // 闸在工作，子进程一次都没起。**这不是失败** —— 模型拿到的应当是一份完整预览。
      return { isError: false, structuredContent: Object.assign(sc, {
        gate_not_confirmed: true,
        verdict: { gate: 'NOT_CONFIRMED', do_not_retry: true },
        will_execute: willExecuteOf(stderr),
        hint: '确认闸拦下了这次调用，子进程未启动。★不要重试本工具；要真执行，把 will_execute 交给人类在终端里亲自加 --确认。',
      }) };
    }
    return { isError: true, structuredContent: Object.assign(sc, {
      verdict: { gate: 'USAGE' },
      hint: '用法错（多为缺位置参数）。照 stderr 里的「✗ 缺位置参数」补参数后重试。',
    }) };
  }

  if (code === CLI_EXIT.GATE) {
    // ★★★ 本层最关键的一行：门禁码走成功通道 ★★★
    const spec = T.exit3Of(r.toolName);
    return { isError: false, structuredContent: Object.assign(sc, {
      verdict: {
        gate: 'FAIL',
        do_not_retry: true,
        // exit 3 在不同命令上不是同一个意思（见 toolTable.EXIT3）。这里如实带上，
        // 免得模型把它笼统读成「门禁不通过」—— 对 `门禁 冻结哈希` 它是解析崩溃。
        kind: spec ? spec.kind : 'VERDICT',
        meaning: spec ? spec.meaning : '该命令的 exit 3 表示它自己文档里写的裁决（照该脚本头注读）',
        where: spec ? spec.where : null,
      },
      hint: '★这是门禁裁决，不是调用失败。isError 故意是 false：程序正确地得出了「不通过/不可用」的结论。'
        + '照实报告 verdict.meaning 里的那句话，不要重试，不要改口径重算，更不要报成「通过」。',
    }) };
  }

  if (code === CLI_EXIT.PRECHECK) {
    return { isError: true, structuredContent: Object.assign(sc, {
      verdict: { gate: 'PRECHECK' },
      hint: '预检失败：子脚本不存在或指向了显式排除件。这是环境问题，重试无用。',
    }) };
  }

  return { isError: true, structuredContent: Object.assign(sc, {
    verdict: { gate: 'CHILD_EXIT' },
    hint: '子进程以未登记的码 ' + code + ' 退出。照该脚本自己的文档读，不要猜。',
  }) };
}

module.exports = { mapExit, CLI_EXIT, CONFIRM_MARKER, willExecuteOf };

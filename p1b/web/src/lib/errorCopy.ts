/**
 * errorCopy —— 把后端的裁决翻译成人话 ＋ 一条能走的下一步（SPEC-error-ux · M1）
 *
 * 【病象：陌生人看到的是「HTTP 500」和「一个纯 JSON 字符串」】
 *   后端明明分得出「确认闸拦下了」「门禁判了不通过」「预检没通过」，
 *   前端一律显示 500。用户既不知道发生了什么，也不知道下一步该干什么。
 *
 * 【★本文件为什么不 import `p1b/mcp/exitMap.cjs`——两条都是实测结论】
 *   spec 说「复用 exitMap.cjs 那份数据，不另写一套」。想直接 import，试过，两条都撞墙：
 *     ① `tsc --noEmit` 报 **TS7016**（.cjs 无声明文件）⇒ 类型道 exit 2。
 *     ② vite 能把它打进包，但 `exitMap.cjs → toolTable.cjs → cli/commands.cjs`
 *        在模块顶层执行 `path.join(__dirname, …)`，浏览器里 `path` 被 vite 置成空对象
 *        ⇒ 实测产物 **import 即抛 `TypeError: path.join is not a function`**（白屏）。
 *   所以「数据源单一」不能靠 import，只能靠**分工 ＋ 测试锁死**：
 *     · **exitMap.cjs 独家拥有「码 → 什么裁决」**（哪个 gate、isError 是什么、要不要重试）；
 *     · 本文件只拥有「裁决 → 怎么跟人说」，**按 gate 键入**，不持有任何码 → 含义的表。
 *       按 gate 键入是关键：它让本文件在结构上**没有能力**与 exitMap 争「3 是什么意思」。
 *     · `errorCopy.test.mjs` 在 Node 里 import 真 exitMap，遍历整个码空间，
 *       断言 (a) exitMap 能产出的每个 gate 这里都有文案、(b) 一个都不空白、
 *       (c) `hint` **原样透传** exitMap 的那句、不由本文件另写一遍。
 *   ⇒ 改 exitMap 的分类而忘了这里 ⇒ 测试报红。这就是「单一数据源」在本项目的落地形态。
 *
 * 【★exit 3 那一行是本项目最重要的一句文案】
 *   它是「空集不许被读成通过」这个设计在说话。CLI 绝不抹平它（`p1b/cli/index.cjs:18-20`），
 *   Web 端也不许：所以 `FAIL` 的文案里明写「别重试」，`isError` 也照实传 false。
 *
 * 禁词：全文不得出现那个被禁的二字词（铁律①，见 `web/dist.test.mjs`）。
 *   ★这条注释本身也不许写出那两个字——`errorCopy.test.mjs` ⑥ 会连注释一起扫，
 *   第一版就是在这行上自己把自己判红的。
 */

/** exitMap.cjs `mapExit()` 里 `verdict.gate` 的取值。★这些字符串归 exitMap 所有，本文件只消费。 */
export type Gate =
  | 'OK' | 'ERROR' | 'USAGE' | 'NOT_CONFIRMED' | 'FAIL' | 'PRECHECK' | 'CHILD_EXIT' | 'KILLED'
  // 兜底：exitMap 以后新增 gate 时不至于让 tsc 把调用方判成错，运行时落到 UNKNOWN 文案
  | (string & {});

/** 一个 gate 对应的一屏文案。`hint` 为 null 时用「无补充说明」，但**绝不会**是空串。 */
export interface GateCopy {
  /** 一句话结论：发生了什么。 */
  title: string;
  /** 下一步：用户能做什么。★没有下一步时写清楚「没有」，不留空让人自己猜。 */
  next: string;
}

/** `mapExit()` 的 `structuredContent` 里本文件要读的那几个字段（其余原样透传，不关心）。 */
export interface MappedExit {
  verdict?: { gate?: Gate; do_not_retry?: boolean } | null;
  hint?: string;
}

/** `mapExit()` 的返回（只声明用得到的部分）。 */
export interface MappedResult {
  isError: boolean;
  structuredContent: MappedExit;
}

/** 一个 gate 都没有时的兜底。★与 spec 的「其它」行逐字一致。 */
const UNKNOWN: GateCopy = {
  title: '后端报错了。这不是你操作的问题。',
  next: '刷新一次；还不行就重启服务。',
};

/** 兜底标题导出：给测试断言「某个 gate 是不是悄悄落到了兜底」用。 */
export const ERROR_UNKNOWN_TITLE = UNKNOWN.title;

/**
 * gate → 人话。★键集合由 `errorCopy.test.mjs` 对着真 exitMap 校准：
 *   exitMap 能产出的每个 gate 都必须在这里有条目，且三者（title/next/hint）都不许空。
 */
const GATE_COPY: Record<string, GateCopy> = {
  // exit 0 成功通道：CLI/工具「跑完了」也是一句话，不该被前端当异常
  OK: { title: '这一步跑完了，没有发现问题。', next: '不用做什么。' },
  // exit 1：程序自己的错。★要区分于「结论不通过」——那一类不许落到这里
  ERROR: { title: '这一步没能跑完：程序自己出了错。', next: '看服务窗口里的报错；修好再跑一次。' },
  // exit 2 的「用法错」那一支（带位置参数缺失）
  USAGE: { title: '这一步缺参数，没能执行。', next: '照提示把缺的参数补上再试。' },
  // exit 2 的「确认闸」那一支：★子进程一次都没起，这不是失败
  NOT_CONFIRMED: {
    title: '这一操作会写账本，已被拦下，什么都没执行。',
    next: '要真执行，复制这行到终端加 --确认',
  },
  // exit 3 门禁码：本项目最重要的一句。★isError 故意是 false
  FAIL: {
    title: '门禁给出了结论：这一批不通过。这不是程序坏了。结论就是结论，别重试。',
    next: '照门禁说的处理；重试、改口径重算、或报成「通过」，都算错。',
  },
  // exit 4 预检失败
  PRECHECK: {
    title: '需要的脚本不存在或被列为不可用。重试没用。',
    next: '检查安装是否完整。',
  },
  // 未登记的子进程码
  CHILD_EXIT: {
    title: '后端报错了。这不是你操作的问题。',
    next: '刷新一次；还不行就重启服务。',
  },
  // 被信号杀掉：既不是裁决也不是通过
  KILLED: {
    title: '这一步被中断了，既不是通过也不是不通过。',
    next: '照实说明被中断了，不要重试后当成通过。',
  },
};

/** 某个 gate 的人话。没有登记的 gate 一律落到 UNKNOWN，绝不空白。 */
export function gateCopy(gate: Gate | null | undefined): GateCopy {
  if (typeof gate !== 'string' || gate === '') return UNKNOWN;
  return GATE_COPY[gate] || UNKNOWN;
}

/** 呈现后的结果。`hint` 恒为非空字符串。 */
export interface ErrorCopy extends GateCopy {
  /** exitMap 那句 hint **原样透传**；exitMap 没给时用一个兜底，绝不空串。 */
  hint: string;
  /** exitMap 判定的「这是不是错误」。★不覆写：exit 3 在这里是 false。 */
  isError: boolean;
  /** exitMap 判定的「别重试」。null 表示它没说，我们也不替它说。 */
  doNotRetry: boolean | null;
}

/**
 * 把 `exitMap.mapExit()` 的返回渲染成一屏文案。
 *
 * ★入参就是 exitMap 的产物——本函数**不做任何分类**，只做呈现。
 *   所以它不可能与 exitMap 对「某个码是什么意思」产生分歧：它压根不知道码是什么。
 *
 * @param mapped `mapExit()` 的返回；传 null/undefined 表示「后端没给结构化结果」
 */
export function copyForMapped(mapped: MappedResult | null | undefined): ErrorCopy {
  const sc = (mapped && mapped.structuredContent) || {};
  // ★「成功」在 exitMap 里是**不带 verdict** 的（`mapExit` 对 exit 0 只回 isError:false）。
  //   这里靠它自己的 isError 判成功，而不是靠「码是不是 0」——那等于在本文件里
  //   又抄了一遍码表，恰好是本模块要消灭的东西。
  const gate = sc.verdict && sc.verdict.gate
    ? sc.verdict.gate
    : (mapped && mapped.isError === false ? 'OK' : undefined);
  const base = gateCopy(gate);
  // ★hint 优先用 exitMap 自己写的那句（数据源在它那儿）。它没写才用本文件的兜底，
  //   兜底文案必须说清「这是兜底」，否则会被读成后端真这么说的。
  const hint = typeof sc.hint === 'string' && sc.hint.trim() !== ''
    ? sc.hint
    : '（后端没有给出更多说明。）';
  const doNotRetry = sc.verdict && typeof sc.verdict.do_not_retry === 'boolean'
    ? sc.verdict.do_not_retry
    : null;
  // 拿不到结构化结果时按错误处理，**不许假装没事**（`isError` 缺省 true 而不是 false）
  const isError = mapped && typeof mapped.isError === 'boolean' ? mapped.isError : true;
  return {
    title: base.title,
    next: base.next,
    hint,
    isError,
    doNotRetry,
  };
}

/**
 * 把一次 HTTP 失败渲染成一屏文案。
 *
 * ★为什么 HTTP 侧要单独一套，而不是把状态码塞进 `copyForMapped`：
 *   `exitMap` 的输入是**进程退出码**，Web 端拿到的是 **HTTP 状态码**——两者语义空间不同，
 *   而且 Web 端拿不到 `mapExit()` 的结构化裁决。把 404 硬映射成某个 gate，
 *   就是在本文件里重新发明「码意味着什么」，那恰好是本模块要消灭的东西。
 *   ⇒ 本函数只做「状态码 → 怎么跟人说」，**裁决那一层仍然只归 `exitMap`**。
 *
 * ★后端自己那条 message 按 `hint` **原样透传**（同纪律③：不由本文件另写一遍）。
 *
 * @param status HTTP 状态码；0 表示网络层不可达（由 `api.ts` 在更早的一层处理）
 * @param backendMessage 后端返回的那句人话（`data.error` / `data.message`）
 */
export function describeHttp(status: number, backendMessage: string): ErrorCopy {
  const spec = HTTP_SPECS[status] ?? HTTP_SPECS[0];
  const clean = typeof backendMessage === 'string' ? backendMessage.trim() : '';
  // 后端什么都没说 ⇒ 用本文件的兜底，且**必须说清这是兜底**，否则会被读成后端真这么讲
  const hint = clean !== '' ? clean : '（后端没有给出更多说明。）';
  return {
    title: spec.title,
    next: spec.next,
    hint,
    // HTTP 失败一律是真错：这里**没有** exit 3 那种「结论不是错误」的情形
    isError: true,
    doNotRetry: spec.doNotRetry,
  };
}

/**
 * 状态码 → 文案。`0` 是「网络层不可达」——它与「服务器答了但答错了」是两回事，
 * 文案必须分开，否则用户会去刷新一个根本连不上的页面。
 */
const HTTP_SPECS: Record<number, GateCopy & { doNotRetry: boolean }> = {
  0: {
    title: '连不上后端服务——请求根本没发出去，没有任何东西可以重试。',
    next: '确认后端已启动（默认 127.0.0.1:8787），再回来试一次。',
    doNotRetry: true,
  },
  400: {
    title: '这个请求没通过校验——服务器收到了但拒绝了，**不是程序坏了**。',
    next: '检查你填的内容：标识符格式、必填项、数值范围。',
    doNotRetry: false,
  },
  401: {
    title: '这个操作需要授权——服务器认得你，但没认可你有这个权限。',
    next: '到设置页补上对应的凭据；作者专用功能需要作者密钥。',
    doNotRetry: true,
  },
  403: {
    title: '这个操作被拒绝了——权限不够，或这条记录已被锁定。',
    next: '确认你登的是能改这条的标识。',
    doNotRetry: true,
  },
  404: {
    title: '你打开的地址不对——服务器没有这个地址。',
    next: '回到首页 `/` 再从导航进去。',
    doNotRetry: true,
  },
  409: {
    title: '这一操作会写账本，已被拦下，什么都没执行——账本不可变是硬边界，不是故障。',
    next: '要真执行，复制这行到终端加 `--确认` 标志。',
    doNotRetry: true,
  },
  413: {
    title: '这次请求太大了——服务器不收这么大的请求体。',
    next: '分批提交，别一次全传。',
    doNotRetry: false,
  },
  429: {
    title: '请求太密了——服务器在限流，不是在拒绝你这个人。',
    next: '等一会儿再试——**立刻重试只会更慢**。',
    doNotRetry: true,
  },
  500: {
    title: '后端报错了——**这不是你操作的问题**。',
    next: '刷新一次；还不行就重启后端服务。',
    doNotRetry: false,
  },
};

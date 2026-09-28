'use strict';
/**
 * p1b/src/evidence/verdictSchema.js —— 判词的**结构化形状**与**机械校验**（单一真源，零依赖纯函数）。
 *
 * 【为什么要有这个文件】
 * 判词的 implied_prob 一直是这么来的：让模型只写散文，路由再用正则从末行「P=0.xx」里猜。
 * 项目两次负结果（模型自由给数字 → 稳定地给错同一个数）是**真的**，但当时选的解法是
 * 「禁止模型给数字」——把**约束输出**换成了「约束输入 ＋ 事后猜」。猜的那一步读得懂
 * 「P=0.42」，读不懂「P=0.42 附近」，也分不清「模型声明的置信度」和「散文里碰巧出现的那个 0.42」
 * ——这两种东西在正则眼里长得一模一样。
 *
 * 正确的解法不是禁数字，是**约束它按结构给数字**：
 *   提示词要求模型吐一个固定围栏块 → 机械校验形状/类型/范围 → 越界即拒、缺失即拒，
 *   **绝不拿散文里的数字顶上**。取数闸（no_fallback ＋ 兼容开关）在 `routes/verdicts.js`；
 *   本文件只回答「结构长什么样」和「这份结构合不合格」，不碰 env、不碰 db、不碰网络。
 *
 * 【为什么 confidence（置信档位）与 p（概率）是两个字段，不是一个】
 *   它们是两种不同的断言：p 是「判定成立的概率」，confidence 是「模型自己认这口气有多硬」。
 *   把档位从 p 上推导出来，等于让模型对自己诚实度的声明变得无法证伪——它报 high 的时候，
 *   那只是 p 离 0.5 远，不说明它真的确信。两个字段各自独立，**不一致本身就是要被看见的事**
 *   （读侧可以拿 p 落在 0.5 附近却报了 high 的行去看模型是不是在虚报自信）。
 *
 * 【为什么 abstain（拒答标记）必须显式存在，而不是「不给 p 就当拒答」】
 *   「没给 p」有两种完全不同的成因：模型拒答（合法的结构化输出），和模型没按格式输出（坏数据）。
 *   合成一种之后，坏数据会伪装成一次体面的拒答，消融时按"模型不敢答"读，读出来的却是"模型坏了"。
 *   所以：abstain=true 且 p=null ⇒ 合法拒答；abstain=false 而 p 不是 [0,1] 数值 ⇒ 坏数据。
 *
 * 【为什么一字段不合格就整块作废，而不是"哪个字段能用就用哪个"】
 *   部分采用的判词比没有判词更坏：库里那行看起来有数、有方向，实际是一个残缺形状的产物，
 *   而消融时没人会去看它缺了哪一项。整块作废 ⇒ p 落 NULL ＋ 错因可机读，
 *   与"抽取失败"的既有纪律一致（不编数、如实留空）。
 *
 * 纪律：零新依赖（只用 node 内建；本文件连 require 都不需要）；不碰 db、不发网络；
 *   未知字段**不取也不拒**（取＝承认一份没校验过的形状；拒＝模型多写一个解释字段就丢整行数据）。
 */

/** 结构化块的围栏语言标记。与散文里可能出现的普通代码块区分开，认它一个。 */
const FENCE_TAG = 'verdict-json';

/** 视角 role：判词以哪一路的身份说话（照 ROUTES 三路，值名用语义而非数组下标）。 */
const ROLES = ['evidence_aggregation', 'skeptical', 'base_rate'];

/** 判断方向：论证本身往哪边倒。与 p 不必一致（可以两边都讲、最后落 0.5）。 */
const DIRECTIONS = ['for', 'against', 'mixed'];

/** 置信档位：模型自认的口气硬不硬，**不由 p 推导**（见文件头注）。 */
const CONFIDENCE_BANDS = ['low', 'mid', 'high'];

/** 理由段长度上限：判词是复盘参考，理由写成小作文就说明它没在做判断。 */
const REASON_MAX = 300;

/** 必填字段（六项一个都不能少；少一项即整块作废，见文件头注）。 */
const FIELDS = ['role', 'direction', 'confidence', 'p', 'reason', 'abstain'];

// ─────────────────────────────────────────────────────────────────────────────
// JSON Schema：**同源派生**，不是另抄一份
// ─────────────────────────────────────────────────────────────────────────────
// 这份是「给模型看的那份契约」：写进 system prompt，将来也可以原样作为
// `response_format: {type:'json_schema', json_schema:{schema}}` 发给供应商（RESPONSE_FORMAT 已备好）。
// ★**本文件不引入校验库**（零新依赖铁律）：真正被执行的是 `validateStructured`，两者逐条对齐靠的是
//   "下面的 JSON Schema 由同一批注册表程序化生成"，不是靠人记得同步。改枚举只需改一处。

const JSON_SCHEMA = {
  type: 'object',
  required: FIELDS.slice(),
  properties: {
    role: { type: 'string', enum: ROLES.slice() },
    direction: { type: 'string', enum: DIRECTIONS.slice() },
    confidence: { type: 'string', enum: CONFIDENCE_BANDS.slice() },
    p: { description: '判定成立的概率，[0,1] 数值；仅当 abstain=true 时为 null' },
    reason: { type: 'string', minLength: 1, maxLength: REASON_MAX },
    abstain: { type: 'boolean' },
  },
  // 「拒答必不带数、不拒答必给数」用条件表达：这两句是本文件的核心断言，
  // 写进 schema 才算对模型说了同一遍的话（写在注释里模型看不见）。
  allOf: [{
    if: { properties: { abstain: { const: true } }, required: ['abstain'] },
    then: { properties: { p: { type: 'null' } }, required: ['p'] },
    else: { properties: { p: { type: 'number', minimum: 0, maximum: 1 } }, required: ['p'] },
  }],
};

/**
 * 供应商侧 `response_format` 载荷（本批**未接线**）。
 * 为什么没接：`chatText`（`src/lib/llmChat.js`）是本批禁改面外的文件，接线要改它。
 * 先把载荷落在这里并测住形状，下一批只需把它塞进请求体，不必重新推导契约。
 */
const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: { name: 'verdict', strict: true, schema: JSON_SCHEMA },
};

// ─────────────────────────────────────────────────────────────────────────────
// 取块：从响应文本里**机械地**挖出结构化块
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 找结构化块。两种形态：
 *   ① 显式围栏 ` ```verdict-json … ``` `（本项目契约，提示词要求模型这么写）；
 *   ② 整段文本**本身就是**一个 JSON 对象（留给将来 response_format=json_object 的形态）。
 *
 * 多个围栏块时取**最后一个**：与既有 `extractImpliedProb` 同款口径（从后往前找）——
 * 尾部那份才是模型的最终声明，前面的按正文处理。块数照实返回，不静默吞。
 *
 * ★围栏语言标记只认 FENCE_TAG 一个：模型写成 ` ```json ` 时**判为"没有块"**（→ 上层拒），
 *   而不是去猜哪一个更像——猜出来的块和正文里的示例代码块分不开，那道分界线一旦模糊，
 *   整道闸就退化成"在散文里找一段像 JSON 的东西"，那正是它要取代的东西。
 *
 * @param {string} text LLM 响应文本
 * @returns {{found:boolean, payload:object|null, raw:string|null, parseError:string|null, blocks:number}}
 */
function parseStructured(text) {
  const miss = { found: false, payload: null, raw: null, parseError: null, blocks: 0 };
  if (typeof text !== 'string' || !text.trim()) return miss;
  const fenceRe = new RegExp('```' + FENCE_TAG + '[ \\t]*\\r?\\n([\\s\\S]*?)```', 'gi');
  let m = null;
  let last = null;
  let n = 0;
  while ((m = fenceRe.exec(text)) !== null) { last = m; n++; }
  let raw = last ? last[1] : null;
  if (raw === null) {
    const t = text.trim();
    if (t.charAt(0) !== '{') return miss;  // 整段不是 JSON 对象 ⇒ 没有结构化块
    raw = t;
  }
  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    // ★围栏在、块坏了 ⇒ found=true 而非 false：找到了 ≠ 合格。上层据此区分
    // 「压根没输出结构」与「输出了但不合格」，两者拒因短码不同。
    return { found: true, payload: null, raw: raw, parseError: e.message, blocks: n };
  }
  return { found: true, payload: payload, raw: raw, parseError: null, blocks: n };
}

// ─────────────────────────────────────────────────────────────────────────────
// 校验：形状/类型/范围，逐条给错因
// ─────────────────────────────────────────────────────────────────────────────

/** 一处小工具：把「必须是白名单里的字符串」这类断言收成一行（错因里带字段名与实收值）。 */
function checkEnum(errors, payload, field, table) {
  const v = payload[field];
  if (typeof v !== 'string' || table.indexOf(v) === -1) {
    errors.push(field + ' 必须是 ' + table.join('|') + ' 之一，收到: ' + JSON.stringify(v));
    return null;
  }
  return v;
}

/**
 * 机械校验（**纯函数**：不吃 env、不碰 db、不发网络）。
 * 任一条不过 ⇒ `{ok:false, errors:[...]}`，调用方据此落 NULL（不编数）。
 *
 * @param {*} payload parseStructured 挖出来的原始值（什么都可能是）
 * @returns {{ok:boolean, value:object|null, errors:string[]}}
 */
function validateStructured(payload) {
  const errors = [];
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, value: null, errors: ['结构化块必须是 JSON 对象，收到: ' + (Array.isArray(payload) ? '数组' : typeof payload)] };
  }
  const role = checkEnum(errors, payload, 'role', ROLES);
  const direction = checkEnum(errors, payload, 'direction', DIRECTIONS);
  const confidence = checkEnum(errors, payload, 'confidence', CONFIDENCE_BANDS);

  const reason = payload.reason;
  if (typeof reason !== 'string' || !reason.trim()) {
    errors.push('reason 必须是非空字符串，收到: ' + JSON.stringify(reason));
  } else if (reason.length > REASON_MAX) {
    errors.push('reason 超过 ' + REASON_MAX + ' 字（判词是复盘参考，理由写成小作文说明它没在做判断），收到 ' + reason.length + ' 字');
  }

  const abstain = payload.abstain;
  if (typeof abstain !== 'boolean') {
    errors.push('abstain 必须是布尔（拒答标记），收到: ' + JSON.stringify(abstain));
  }

  // p 的三段判：拒答必不带数 / 不拒答必给 [0,1] 数值。分开的理由见文件头注。
  let p = null;
  if (abstain === true) {
    if (payload.p !== undefined && payload.p !== null) {
      errors.push('abstain=true 时 p 必须是 null（拒答不许带数），收到: ' + JSON.stringify(payload.p));
    }
  } else {
    const raw = payload.p;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      errors.push('p 必须是 [0,1] 区间内的**数值**（不是数字串、不是文字档位），收到: ' + JSON.stringify(raw));
    } else if (raw < 0 || raw > 1) {
      errors.push('p 越界（必须在 [0,1]），收到: ' + raw);
    } else {
      p = raw;
    }
  }

  if (errors.length) return { ok: false, value: null, errors: errors };
  // 未知字段既不取也不拒（见文件头注）⇒ 返回值只带这六项，多余的键进不了库。
  return {
    ok: true, errors: [],
    value: {
      role: role, direction: direction, confidence: confidence,
      p: p, reason: reason.trim(), abstain: abstain,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 渲染：提示词用的契约段 ＋ 夹具/MOCK 用的块渲染
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 提示词里的结构化契约段（供 `routes/verdicts.js` 的 buildSystemPrompt 拼进去）。
 * 为什么要把枚举**逐个列出来**而不是只说"合法即可"：模型面对开放式的"给个 role"会自创
 * （我们见过的自创值：astrologer / 天气先生）。列出来才能把它按在同一套词上。
 * @returns {string}
 */
function describeContract() {
  return [
    '结构化输出（必须）：正文之后、Range 行之前，给出一个用 ' + FENCE_TAG + ' 围栏包住的 JSON 对象，内含且仅含这六项：',
    '  "role"：视角，只能是 ' + ROLES.join(' | '),
    '  "direction"：判断方向，只能是 ' + DIRECTIONS.join(' | ') + '（mixed = 两边都讲、最后落中间）',
    '  "confidence"：置信档位，只能是 ' + CONFIDENCE_BANDS.join(' | ') + '（你自己认这口气有多硬，不要照抄 p 的远近）',
    '  "p"：判定成立的概率，必须是 0 到 1 之间的**数值**（写 0.42，不写 42%、不写「大概率」、不写区间）',
    '  "reason"：理由段，' + '不超过 ' + REASON_MAX + ' 字',
    '  "abstain"：布尔。答不了就填 true，此时 "p" 必须是 null（不许同时给数——拒答就是拒答）',
    'p 越界、p 写成文字、或缺任何一项，这一路都会被判为不合格并如实留空：宁可空着，也不要给一个来路不明的数。',
  ].join('\n');
}

/**
 * 渲染结构化块（MOCK 判词与测试夹具共用一个渲染器 ⇒ 围栏标记不会两处各敲一个）。
 * 用紧凑单行 JSON：既好读，又保证块内不会出现形如「P=0.42」的整行（那会污染文本抽取的老路）。
 * @param {object} payload
 * @returns {string} 含围栏的多行文本
 */
function buildBlock(payload) {
  return '```' + FENCE_TAG + '\n' + JSON.stringify(payload) + '\n```';
}

module.exports = {
  FENCE_TAG, ROLES, DIRECTIONS, CONFIDENCE_BANDS, REASON_MAX, FIELDS,
  JSON_SCHEMA, RESPONSE_FORMAT,
  parseStructured, validateStructured, describeContract, buildBlock,
};

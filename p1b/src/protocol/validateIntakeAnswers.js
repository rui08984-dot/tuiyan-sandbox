'use strict';
/**
 * p1b/src/protocol/validateIntakeAnswers.js —— 答案的**机械校验器**（2026-09-29）
 *
 * 【它做什么】
 *   给一份「模型返回的答案」，纯函数地判三件事，逐条给代码：
 *     ① 取值域（在不在域内）  ② 必答（漏没漏）  ③ 拒收后果（过了会落到哪／会被拒在哪）
 *   外加一条纪律③的落实：把「用 unknown 逃过拒收门」这种答法**点名**出来。
 *
 * 【它绝不做什么 —— 零新依赖 · 零网络 · 零 LLM · 零写库】
 *   本件只用 node: 内建，且函数体内不做任何 I/O：
 *   不 require 应用代码、不开数据库、不调 LLM、不写文件。
 *   （`test/intake-protocol.test.cjs` ③ 是它的**零副作用源码锁**，逐条扫这四个面。）
 *   理由很硬：这道门要是自己会去调模型或写库，它就成了「自己给自己判卷」——
 *   而纪律②要的就是**模型的产物必须过机械门**，机械门自己必须比模型更笨、更死。
 *
 * 【★协议自检：不信任传进来的协议】
 *   本件**不把传入的协议当圣旨**。它拿 `protocol.projection`（那份从冻结件投影来的常量）
 *   **独立重算**一遍「应该有哪些问、每问必不必答、在第几位」，再与 `protocol.questions` 逐项比对。
 *   对不上 ⇒ 直接判红 `E_PROTOCOL_DRIFT`。
 *   为什么要多这一层：投影的价值全在「协议等于冻结件」这条不变量上。
 *   只在**装配时**对账不够——装配完到校验之间，协议对象是可以被改的（测试里就能改）。
 *   有了自检，**从协议里删掉一道必答项，校验器立刻红**：缺的那一问重算得出来、协议里没有，
 *   对不上 ⇒ 红。反过来，校验器也不可能被一份「少了一问的协议」骗过。
 *
 * 【三态与「答不出」】
 *   投影的取值域来自冻结件的三态归一（真词表/假词表/未知词表）。归一逻辑在本件里**复刻**了
 *   冻结件那份 `normTri`——它没有导出，没法直接引。复刻就有漂的风险，对冲办法是
 *   `test/intake-protocol.test.cjs` ②：拿活模块端到端对拍（真词/假词/未知词/布尔/0|1/垃圾值
 *   各打一遍，比对本件算出的与真端点行为）。复刻与漂移的账在那条测试里，不靠嘴说。
 *
 * 【★本件比冻结件更严的一处，如实登记】
 *   冻结件的层答案接受**对象**形式（`layerGreen` 的 object 分支），而那个分支**不校验长度**——
 *   也就是说 `L2: {a: true}` 会以「一票」判成全绿，四问的层用一问蒙过去。
 *   本协议**只收定长数组**，对象形式判 `E_SHAPE`。
 *   这不是「改了判据」：primary 仍是冻结件的决策树算的，本件只是**不许**用那条漏检的形状提交。
 *   收紧的理由与方向已在此登记（收紧为拒，绝不放松成放行）。
 */

const { getProtocol, BLOCK } = require('./intakeProtocol');

/** 错误码表（机器判、字符串稳定；文案给人看，判据看 code）。 */
const CODES = {
  E_ENVELOPE: '提交体形状非法（必须是 {checklist:{…}}）',
  E_PROTOCOL_DRIFT: '协议与冻结件投影对不上（协议被改过或装配错了）',
  E_MISSING_REQUIRED: '漏答必答项',
  E_SHAPE: '答案形状非法（层内必须定长数组）',
  E_DOMAIN: '取值越界',
  E_DECIDED_LAYER: 'decided_layer 越界',
  E_SECONDARY: 'secondary 越界',
  W_GATE_UNKNOWN_REJECTS: '拒收门填了「答不出」——它不是豁免，是与「否」同一条拒收路',
  W_UNKNOWN_KEY: 'checklist 里有协议不认识的键（冻结件会静默忽略，但拼错的键等于没答那一问）',
  W_UNKNOWN_ESCAPE_TOTAL: '★全部必答项都答「答不出」：这是一份合法提交，但一个判断都没做',
  W_LAYER_UNKNOWN: '五层皆非全绿 ⇒ 落 layer=unknown（合法入账，但不是一次归层）',
  W_LAB_BOUNDARY_UNCHECKED: '提交带了 game_id/game_type ⇒ 第 -1 步实验场域门会先于拒收门跑，本校验器不评它',
};

/** 一条 finding。 */
function finding(code, key, message) {
  return { code: code, code_meaning: CODES[code] || null, key: key, message: message };
}

/**
 * 三态归一（复刻冻结件的 normTri；词表由协议投影，不写死）。
 * 返回 {ok:true, value:true|false|'unknown'} 或 {ok:false, raw}。
 */
function normalizeTri(v, domain) {
  if (typeof v === 'boolean') return { ok: true, value: v };
  if (typeof v === 'number' && (v === 0 || v === 1)) return { ok: true, value: v === 1 };
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (domain.accepts.true_words.indexOf(s) !== -1) return { ok: true, value: true };
    if (domain.accepts.false_words.indexOf(s) !== -1) return { ok: true, value: false };
    if (domain.accepts.unknown_words.indexOf(s) !== -1) return { ok: true, value: 'unknown' };
  }
  return { ok: false, raw: v };
}

/**
 * 协议自检：拿 projection 独立重算应有问卷，与协议里的逐项比对。
 * @returns {Array<{code,key,message}>} 空数组 = 自检通过
 */
function protocolSelfCheck(p) {
  const drift = [];
  const proj = p.projection;
  const expected = [];

  // ★拒收门：独立从 projection.gate_questions 重算。
  //   这里**不能**从 p.questions 里数门问——那正是被改动的地方，从那里取等于让嫌疑人自己作证。
  //   （初版就是这么写的，结果「删掉一道门问」测不出漂移：门问集合跟着协议一起少了，自检看不见。
  //     反向锁 test ⑤-1/⑤-6 就是照这个洞写的。）
  if (!Array.isArray(proj.gate_questions) || !proj.gate_questions.length) {
    drift.push(finding(CODES.E_PROTOCOL_DRIFT, 'projection.gate_questions', '投影里没有拒收门三问 ⇒ 无法独立自检，直接判红。'));
  } else {
    proj.gate_questions.forEach((gq) => {
      expected.push({ key: gq.key, checklist_key: gq.key, block: BLOCK.REJECT_GATE, required: true, rank: null, reason: gq.reason });
    });
  }

  // 决策树 + 叠加层：由 decision_order / question_count 重算（这两者同样只从 projection 取）
  for (const layer of proj.decision_order) {
    for (let i = 0; i < proj.question_count[layer]; i++) {
      expected.push({ key: layer + '[' + i + ']', checklist_key: layer, block: BLOCK.DECISION, required: true, rank: proj.decision_order.indexOf(layer), reason: null });
    }
  }
  for (const layer of Object.keys(proj.question_count)) {
    if (proj.decision_order.indexOf(layer) !== -1) continue;
    for (let i = 0; i < proj.question_count[layer]; i++) {
      expected.push({ key: layer + '[' + i + ']', checklist_key: layer, block: BLOCK.OVERLAY, required: false, rank: null, reason: null });
    }
  }

  // 逐项比对（key 集合 + 必答性 + 块 + 拒收原因）
  const expByKey = {};
  for (const e of expected) expByKey[e.key] = e;
  for (const e of expected) {
    const got = p.by_key ? p.by_key[e.key] : null;
    if (!got) { drift.push(finding(CODES.E_PROTOCOL_DRIFT, e.key, '协议里缺这一问（按冻结件投影它必答/应当存在）。')); continue; }
    if (got.required !== e.required) drift.push(finding(CODES.E_PROTOCOL_DRIFT, e.key, '必答性对不上：投影要求 ' + e.required + '，协议写 ' + got.required + '。'));
    if (got.block !== e.block) drift.push(finding(CODES.E_PROTOCOL_DRIFT, e.key, '所属块对不上：投影 ' + e.block + '，协议 ' + got.block + '。'));
    if (e.reason !== null && got.reason_on_fail !== e.reason) {
      drift.push(finding(CODES.E_PROTOCOL_DRIFT, e.key, '拒收原因对不上：投影 ' + e.reason + '，协议 ' + got.reason_on_fail + '。'));
    }
    if (e.reason !== null && proj.reject_reasons.indexOf(got.reason_on_fail) === -1) {
      drift.push(finding(CODES.E_PROTOCOL_DRIFT, e.key, '拒收原因 ' + got.reason_on_fail + ' 不在 reject_reasons 枚举内。'));
    }
  }
  for (const q of p.questions) {
    if (!expByKey[q.key]) drift.push(finding(CODES.E_PROTOCOL_DRIFT, q.key, '协议里有这一问，冻结件投影里没有。'));
  }
  return drift;
}

/** 取某题的答案位（层内题读数组下标；拒收门直接读键）。 */
function pick(checklist, q) {
  if (q.block === BLOCK.REJECT_GATE) return checklist[q.checklist_key];
  const arr = checklist[q.checklist_key];
  if (!Array.isArray(arr)) return undefined;
  return arr[q.array_index];
}

/**
 * 校验一份答案。**纯函数**：只读入参与协议，不做 I/O、不改入参。
 * @param {Object} submission {checklist, decided_layer?, secondary?, game_id?, game_type?}
 * @param {Object} [protocol]  默认用进程内缓存那份（可用另一份做变异测试）
 * @returns {Object} 判定书
 */
function validateIntakeAnswers(submission, protocol) {
  const p = protocol || getProtocol();
  const errors = [];
  const warnings = [];
  const perQuestion = {};
  const domain = p.value_domain;

  // 0) 协议自检先行：协议本身不可信时，后面所有判定都没有意义
  const drift = protocolSelfCheck(p);
  errors.push.apply(errors, drift);

  const sub = (submission && typeof submission === 'object' && !Array.isArray(submission)) ? submission : null;
  const checklist = (sub && sub.checklist && typeof sub.checklist === 'object' && !Array.isArray(sub.checklist)) ? sub.checklist : null;
  if (!checklist) {
    errors.push(finding(CODES.E_ENVELOPE, 'checklist', '提交体必须是 {checklist:{…}} 的对象；checklist 缺省或不是对象。'));
    return {
      ok: false, errors, warnings, per_question: perQuestion,
      outcome: { rejected: null, reason: null, layer: null, computed_layer: null, secondary: null, gate_eligibility: null },
      summary: '提交体形状非法，后端会在 400 处停下（checklist 必填）。',
    };
  }

  // 1) 逐层先判形状：数组 / 定长 / 缺键。
  //    ★顺序要紧——形状必须**先于**逐问取值判。否则给一个对象形式时，下标取不到值，
  //    会被误报成「漏答 4 次」，而真正的问题是「形状不对」——报错指错地方，
  //    发送方就会去补答而不是改形状。
  const layerShape = {};   // layer → 'absent' | 'not_array' | 'bad_length' | 'ok'
  for (const layer of Object.keys(p.projection.question_count)) {
    const v = checklist[layer];
    const want = p.projection.question_count[layer];
    const required = p.required_keys.indexOf(layer) !== -1;
    if (v === undefined || v === null) {
      layerShape[layer] = 'absent';
      if (required) {
        const anyQ = p.questions.filter((q) => q.checklist_key === layer)[0];
        errors.push(finding(CODES.E_MISSING_REQUIRED, layer, '漏答必答层 ' + layer + '（' + want + ' 问）。后端后果：'
          + (anyQ ? anyQ.omission.effect + '——' + anyQ.omission.detail : 'http_400')));
      }
      continue;
    }
    if (!Array.isArray(v)) {
      layerShape[layer] = 'not_array';
      errors.push(finding(CODES.E_SHAPE, layer, '层 ' + layer + ' 的答案必须是**定长数组**（长度 ' + want + '），收到 '
        + (Array.isArray(v) ? '数组' : typeof v) + '。本协议不收对象形式——冻结件的对象分支不校验长度，'
        + '一个单键对象就能把 ' + want + ' 问的层判成全绿。'));
      continue;
    }
    if (v.length !== want) {
      layerShape[layer] = 'bad_length';
      errors.push(finding(CODES.E_SHAPE, layer, '层 ' + layer + ' 要 ' + want + ' 个回答，收到 ' + v.length + ' 个。'));
      continue;
    }
    layerShape[layer] = 'ok';
  }

  // 2) 逐问：必答 → 形状 → 取值域
  for (const q of p.questions) {
    const rec = { key: q.key, block: q.block, required: q.required, given: null };

    // 层内问：形状已在上面按层判过；形状不过 ⇒ 逐问只记后果，不重复报错
    if (q.block !== BLOCK.REJECT_GATE && layerShape[q.layer] !== 'ok') {
      rec.given = null;
      rec.normalized = null;
      rec.effect = layerShape[q.layer] === 'absent' ? q.omission.effect : 'http_400';
      perQuestion[q.key] = rec;
      continue;
    }

    const given = pick(checklist, q);
    rec.given = given === undefined ? null : given;

    if (given === undefined || given === null) {
      rec.normalized = null;
      if (q.required) {
        errors.push(finding(CODES.E_MISSING_REQUIRED, q.key, '必答项漏答。后端后果：' + q.omission.effect + '——' + q.omission.detail));
      }
      rec.effect = q.omission.effect;
      perQuestion[q.key] = rec;
      continue;
    }

    const norm = normalizeTri(given, domain);
    if (!norm.ok) {
      errors.push(finding(CODES.E_DOMAIN, q.key, '取值越界：' + JSON.stringify(given)
        + '。域内写法＝' + JSON.stringify(domain.accepts)));
      rec.normalized = null;
      rec.effect = 'http_400';
      perQuestion[q.key] = rec;
      continue;
    }
    rec.normalized = norm.value;
    rec.effect = q.consequence[String(norm.value)] ? q.consequence[String(norm.value)].effect : null;
    perQuestion[q.key] = rec;
  }

  // 2) 可选覆盖字段的取值域
  const decided = sub.decided_layer;
  if (decided !== undefined && decided !== null && decided !== '') {
    if (p.projection.primary_layers.indexOf(String(decided)) === -1) {
      errors.push(finding(CODES.E_DECIDED_LAYER, 'decided_layer', '必须是 ' + p.projection.primary_layers.join('|')
        + '（L4 是叠加层不作 primary）；收到: ' + JSON.stringify(decided)));
    }
  }
  const secondary = sub.secondary;
  if (secondary !== undefined && secondary !== null && secondary !== '') {
    if (p.projection.all_layers.indexOf(String(secondary)) === -1) {
      errors.push(finding(CODES.E_SECONDARY, 'secondary', '必须是 ' + p.projection.all_layers.join('|') + ' 或 null；收到: ' + JSON.stringify(secondary)));
    }
  }

  // 3) 拒收后果投影（镜像冻结件的判定顺序，供调用方发请求前对拍）
  const outcome = { rejected: null, reason: null, first_failing_question: null, computed_layer: null, layer: null, secondary: null, gate_eligibility: null };
  const gateVals = p.questions.filter((q) => q.block === BLOCK.REJECT_GATE).map((q) => perQuestion[q.key] ? perQuestion[q.key].normalized : null);
  const gateSpecs = p.questions.filter((q) => q.block === BLOCK.REJECT_GATE);
  for (let i = 0; i < gateSpecs.length; i++) {
    if (gateVals[i] !== true) {
      outcome.rejected = true;
      outcome.reason = gateSpecs[i].reason_on_fail;
      outcome.first_failing_question = gateSpecs[i].key;
      break;
    }
  }
  if (!outcome.rejected) {
    outcome.rejected = false;   // 显式 false，不留 null（省略即静默出域，与本项目 #2 纪律同源）
    // 首个全绿层
    const greens = {};
    for (const layer of p.projection.decision_order) {
      const items = p.questions.filter((q) => q.block === BLOCK.DECISION && q.layer === layer);
      const vals = items.map((q) => (perQuestion[q.key] ? perQuestion[q.key].normalized : null));
      greens[layer] = vals.length === items.length && vals.every((v) => v === true);
    }
    let computed = null;
    for (const layer of p.projection.decision_order) { if (greens[layer]) { computed = layer; break; } }
    if (!computed) computed = 'unknown';
    outcome.computed_layer = computed;
    // decided_layer 覆盖：合法值时优先，否则（越界已记错）用决策树结果
    outcome.layer = (decided !== undefined && decided !== null && decided !== ''
      && p.projection.primary_layers.indexOf(String(decided)) !== -1) ? String(decided) : computed;
    // secondary：显式优先，否则 L4 全绿
    const l4Items = p.questions.filter((q) => q.block === BLOCK.OVERLAY);
    const l4Vals = l4Items.map((q) => (perQuestion[q.key] ? perQuestion[q.key].normalized : null));
    const l4Green = l4Items.length > 0 && l4Vals.length === l4Items.length && l4Vals.every((v) => v === true);
    outcome.secondary = (secondary !== undefined && secondary !== null && secondary !== ''
      && p.projection.all_layers.indexOf(String(secondary)) !== -1) ? String(secondary) : (l4Green ? 'L4' : null);
    // gate 资格：scored 还需引擎 ok，本件不跑引擎，只判「够不够格进 scored 通道」
    const L = outcome.layer;
    const built = !!(p.projection.engine_table[L] && p.projection.engine_table[L].built);
    const scorable = p.projection.scorable_layers.indexOf(L) !== -1;
    outcome.gate_eligibility = (scorable && built && p.projection.g2.passed) ? 'scored_eligible' : 'descriptive_only';
    if (outcome.computed_layer === 'unknown') {
      warnings.push(finding(CODES.W_LAYER_UNKNOWN, 'decision_tree', '五层皆非全绿 ⇒ 落 layer=unknown（合法入账，但不是一次归层）。'));
    }
  } else {
    // 拒收时，拒收门填「答不出」要点名——纪律③说的就是这件事
    for (let i = 0; i < gateSpecs.length; i++) {
      if (gateVals[i] === 'unknown') {
        warnings.push(finding(CODES.W_GATE_UNKNOWN_REJECTS, gateSpecs[i].key,
          'Q0 填「答不出」= 与「否」同一条拒收路（判据是 !== true），reason=' + gateSpecs[i].reason_on_fail
          + '。要表达「判不了」就**不提交**（400），不要用 unknown 顶。'));
      }
    }
  }

  // 4) 纪律③的逃逸检测：全部必答都答「答不出」= 合法但零判断
  const requiredVals = p.questions.filter((q) => q.required).map((q) => (perQuestion[q.key] ? perQuestion[q.key].normalized : null));
  if (errors.length === 0 && requiredVals.length > 0 && requiredVals.every((v) => v === 'unknown')) {
    warnings.push(finding(CODES.W_UNKNOWN_ESCAPE_TOTAL, 'checklist',
      '全部 ' + requiredVals.length + ' 个必答项都答「答不出」。这份提交**不会**被拒收门挡住（拒收门与「否」同路），'
      + '会一路走到决策树、全层非全绿、落 layer=unknown 入账——合法，但一个判断都没做。'
      + '这就是「用「不知道」逃过拒收门」的确切成法。'));
  }

  // 5) 第 -1 步实验场域门不归本件评（game_id 要查库），但要点名它先跑
  if ((sub.game_id !== undefined && sub.game_id !== null && sub.game_id !== '')
    || (sub.game_type !== undefined && sub.game_type !== null && sub.game_type !== '')) {
    warnings.push(finding(CODES.W_LAB_BOUNDARY_UNCHECKED, 'game_id/game_type',
      '带了局标识 ⇒ 第 -1 步实验场域门会**先于**拒收门跑（真实局 → reason=\'other\', scope=\'not_prediction_lab\'）。'
      + '本校验器不评这一门（game_id 需查 games 表），它的判定不在本协议内。'));
  }

  // 6) 不认识的键：冻结件会静默忽略，但「拼错的键」在账本上等于「没答那一问」——
  //    而发送方以为自己答了。这是本项目明令禁止的宽松匹配（照 noteChecklist.ts 的层名白名单纪律）。
  const knownKeys = [];
  for (const q of p.questions) if (knownKeys.indexOf(q.checklist_key) === -1) knownKeys.push(q.checklist_key);
  const stray = Object.keys(checklist).filter((k) => knownKeys.indexOf(k) === -1);
  for (const k of stray) {
    warnings.push(finding(CODES.W_UNKNOWN_KEY, k,
      'checklist 里的 `' + k + '` 不在协议键表 ' + JSON.stringify(knownKeys) + ' 内。'
      + '冻结件会静默忽略它——若这是拼错（例如 L1 写成 L1_），账本上就是「没答 L1」而你以为答了。'));
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    per_question: perQuestion,
    outcome,
    summary: errors.length === 0
      ? ('通过：' + p.counts.total + ' 问取值域/必答全合，' + (warnings.length ? warnings.length + ' 条告警待看。' : '无告警。'))
      : (errors.length + ' 条不合规（' + errors.slice(0, 3).map((e) => e.key + ':' + e.code).join(', ') + (errors.length > 3 ? ' …' : '') + '）'),
  };
}

module.exports = { validateIntakeAnswers, normalizeTri, protocolSelfCheck, CODES };

'use strict';
/**
 * p1b/src/protocol/intakeProtocol.js —— 接题问卷的**结构化协议**（2026-09-29）
 *
 * 【它是什么】
 *   `p1b/src/routes/intake.js` 里那 22+3 问，现在是**给人答的**：label 写的是
 *   「Q0-1 存在可机检/第三方可复核的真值锚」这种人话，模型读它没法判定自己答对没有。
 *   本件把同一份问卷投影成**逐问可机械判定**的描述：每问带 key / 题面 / 取值域 /
 *   必答性 / 三态各自的后果 / 判据来源（哪个文件哪一行、哪个函数、哪个可执行判据）。
 *
 * 【投影，不是抄写 ★本件最要紧的一条】
 *   本文件**不写死任何一个数字**。问数、决策树顺序、拒收原因、三态词表、primary 合法值、
 *   gate 状态机转移表——全部由 `intakeSource.js` 在加载时从冻结件里**读**出来；
 *   题面原文从冻结清单 `docs/specs/万物分类清单-v2.md` 里**读**出来。
 *   理由有实测分量：`web/src/lib/noteChecklist.ts:36` 已经手抄了一份 QUESTION_COUNT，
 *   和 `intake.js:116` 并排躺着。那份今天还对，但**没有机制拦着它漂**——
 *   一处口径两套实现正是这个项目反复吃亏的地方。
 *
 * 【双源对账：读不出来就响，不猜】
 *   问数有两个出处（代码的 QUESTION_COUNT、清单标题里声明的「（N 问全「是」）」）。
 *   本件在 build 时逐层对账，对不上**直接抛**。清单自己写着「任何改动=新版本号」，
 *   代码与清单不同步属于版本事故，不是可以就近取一个的小出入。
 *
 * 【问数到底是几】
 *   拒收门 3 + 决策树五层 (3+4+4+4+4=19) = **22**；再加 L4 后置叠加 3 = **25**。
 *   22 是「必答的那些」，25 是「协议描述的全部」。别把两个数混着说。
 *
 * 【零副作用】
 *   只读三个文件（intake.js / 万物分类清单-v2.md / intakeStore.js）+ 一个名字清单（anchor-gate.cjs）。
 *   不 require 应用代码、不连数据库、不连 LLM、不写任何东西。
 */

const src = require('./intakeSource');

/** 协议自身的版本号（**协议层**的版本，与清单的 checklist_hash 是两回事，别混）。 */
const PROTOCOL_VERSION = 'intake-protocol/1';

/** 三个块：拒收门 / 决策树 / 后置叠加。决定同一道题的「答错会怎样」。 */
const BLOCK = {
  REJECT_GATE: 'reject_gate',   // 任一非 true ⇒ 拒收并落 intake_rejects
  DECISION: 'decision',         // 逐层必填；首个全绿层即 primary
  OVERLAY: 'overlay',           // L4 后置叠加，只记 secondary，永不作 primary
};

/** 三态的规范名。取值域本身（哪些词算 true/false/unknown）由冻结件投影，这里只是名字。 */
const TRI = ['true', 'false', 'unknown'];

/** 题块 → 键的构造规则。决策树/叠加层用 `层[0起下标]`，拒收门沿用 checklist 原键。 */
function questionKey(block, layer, arrayIndex) {
  if (block === BLOCK.REJECT_GATE) return layer === null ? null : layer;
  return layer + '[' + arrayIndex + ']';
}

/** 组装某一类题的「答了各值会怎样」——按块**算**出来，不逐题手写（手写就会漂）。 */
function consequencesFor(block, reason) {
  if (block === BLOCK.REJECT_GATE) {
    return {
      true: { effect: 'pass', detail: '过本问，继续下一问。' },
      false: {
        effect: 'reject',
        detail: '拒收，reason=' + reason + '。reason 取**首个**未过门问的（不是本问的）——'
          + '三问都不过时，落库的是 Q0-1 的 reason，后面两问只在 detail.failures 里留名。',
      },
      unknown: {
        effect: 'reject',
        detail: '★同样拒收，reason=' + reason + '。判据是 `!== true`，'
          + '「答不出」在这一问**不是**豁免，是与「否」同一条路。'
          + '要表达「这道题我判不了」，正确做法是**不提交**（走 400），不是填 unknown。',
      },
    };
  }
  if (block === BLOCK.DECISION) {
    return {
      true: { effect: 'green_vote', detail: '记一票「是」；本层全 true 才算全绿。' },
      false: { effect: 'not_green', detail: '记一票「否」⇒ 本层非全绿，决策树继续往下一层走。' },
      unknown: {
        effect: 'not_green',
        detail: '★算「非全绿」（层绿判定是 `=== true` 逐项比）。与 false 在**落层结果**上相同，'
          + '在**账本是否诚实**上不同：false 是「判了，不满足」；unknown 是「判不了」。'
          + '两者结果相同 ⇒ 模型可以拿 unknown 把自己摘干净而不留痕，本协议把这种用法单列为告警。',
      },
    };
  }
  return {
    true: { effect: 'overlay_vote', detail: '记一票「是」；L4 三问全 true ⇒ secondary=\'L4\'。' },
    false: { effect: 'no_overlay', detail: '本层非全绿 ⇒ 不记 secondary（secondary 留空）。不影响 primary。' },
    unknown: { effect: 'no_overlay', detail: '同上：不记 secondary。**不影响 primary**（L4 永不作 primary）。' },
  };
}

/** 漏答（键缺省 / 值为 undefined 或 null）的后果——按块算。 */
function omissionFor(block) {
  if (block === BLOCK.REJECT_GATE) {
    return {
      effect: 'http_400',
      detail: '三态归一遇到 undefined 直接抛 400（不是拒收，是请求非法）。'
        + '★拒收门没有「不答」这个选项：要么给出 true/false 之一，要么不提交。',
    };
  }
  if (block === BLOCK.DECISION) {
    return {
      effect: 'http_400',
      detail: '★决策树逐层必填：层绿判定对缺键返回 null，调用方当场 400（`checklist.<层> 必填`）。'
        + '这正是「禁答与答不出必须分开」在代码里的落点——'
        + '**键缺省 = 400（诚实）**，**填 unknown = 合法提交（把判断摘了出去）**。',
    };
  }
  return {
    effect: 'no_overlay',
    detail: 'L4 可选：不发这一键，后端对缺键返回 null，secondary 留空，**不误标**、不报错。',
  };
}

/**
 * 组装协议。**每次调用都重新从冻结件读一遍**（便宜：三个小文件），
 * 便于测试临时投影出一份改过的协议来做变异测试。
 * @returns {Object} 协议对象
 */
function buildProtocol() {
  const c = src.readIntakeConstants();
  const K = c.constants;
  const L = c.lines;
  const spec = src.readChecklistSpec();
  const store = src.readStoreEnums();
  const ag = src.readAnchorGateExports();

  // ── 双源对账：问数（代码）＝ 问数（清单标题）＝ 题面条数 ──────────────────
  for (const layer of Object.keys(K.QUESTION_COUNT)) {
    const Lspec = spec.layers[layer];
    if (!Lspec) throw new Error('intakeProtocol: 代码里有 ' + layer + ' 的问数，冻结清单第 1 步却没这一层。');
    const codeN = K.QUESTION_COUNT[layer];
    if (codeN !== Lspec.declared_count || codeN !== Lspec.items.length) {
      throw new Error('intakeProtocol: ' + layer + ' 问数三方对不上——代码 QUESTION_COUNT=' + codeN
        + '、清单标题声明=' + Lspec.declared_count + '、清单正文条目=' + Lspec.items.length
        + '。清单改动=新版本号，这里响是故意的。');
    }
  }

  // ── 拒收门三问：代码的 key/reason 与清单的 Q0-N 一一对应，且 reason 在落库枚举内 ──
  if (K.GATE_QUESTIONS.length !== spec.gate.length) {
    throw new Error('intakeProtocol: 拒收门代码 ' + K.GATE_QUESTIONS.length + ' 问、清单 ' + spec.gate.length + ' 问。');
  }
  for (let i = 0; i < K.GATE_QUESTIONS.length; i++) {
    const codeQ = K.GATE_QUESTIONS[i];
    const specQ = spec.gate[i];
    const wantSpecKey = 'Q0-' + (i + 1);
    if (specQ.key !== wantSpecKey || codeQ.key !== wantSpecKey.replace('-', '_')) {
      throw new Error('intakeProtocol: 第 ' + (i + 1) + ' 问的键对不上：代码=' + codeQ.key + '、清单=' + specQ.key + '。');
    }
    if (store.enums.REASONS.indexOf(codeQ.reason) === -1) {
      throw new Error('intakeProtocol: 拒收原因 ' + codeQ.reason + ' 不在 intakeStore.REASONS 里——落库会被 CHECK 拒掉。');
    }
    // 可执行判据：anchor-gate.cjs 导出 q0<N>，按序对位。缺了就说明判据本体被搬走了。
    const wantExec = 'q0' + (i + 1);
    if (ag.names.indexOf(wantExec) === -1) {
      throw new Error('intakeProtocol: anchor-gate.cjs 不再导出 ' + wantExec + '——Q0-' + (i + 1) + ' 的可执行判据失踪。');
    }
  }

  // ── 决策树 / 叠加层 / primary 的形状自洽 ─────────────────────────────────
  for (const layer of K.DECISION_ORDER) {
    if (K.QUESTION_COUNT[layer] === undefined) throw new Error('intakeProtocol: 决策树层 ' + layer + ' 没有问数。');
    if (K.PRIMARY_LAYERS.indexOf(layer) === -1) throw new Error('intakeProtocol: 决策树层 ' + layer + ' 不在 primary 合法值里。');
  }
  for (const layer of K.SCORABLE_LAYERS) {
    if (K.DECISION_ORDER.indexOf(layer) === -1) throw new Error('intakeProtocol: 可 scored 层 ' + layer + ' 不在决策树里。');
  }
  const overlays = Object.keys(K.QUESTION_COUNT).filter((x) => K.DECISION_ORDER.indexOf(x) === -1);
  if (overlays.length !== 1) {
    throw new Error('intakeProtocol: 决策树外的层应有且仅有 1 个（后置叠加），实得 ' + overlays.join(',') + '。');
  }
  if (K.PRIMARY_LAYERS.indexOf(overlays[0]) !== -1) {
    throw new Error('intakeProtocol: 叠加层 ' + overlays[0] + ' 竟在 primary 合法值里——它永不作 primary。');
  }

  const valueDomain = {
    canonical: TRI.slice(),
    accepts: {
      boolean: 'true / false（原生布尔）',
      number: '0 / 1（仅这两个数，其它数字非法）',
      true_words: K.TRUE_WORDS.slice(),
      false_words: K.FALSE_WORDS.slice(),
      unknown_words: K.UNKNOWN_WORDS.slice(),
    },
    note: '以上词表逐项投影自冻结件的三个词常量与三态归一函数；'
      + '**未列出的写法一律非法**（不是「当成 unknown」，是 400）。'
      + '归一时按 trim + 小写比较，所以 \'Yes\'/\' YES \' 都收。',
  };

  const questions = [];

  // 拒收门三问
  K.GATE_QUESTIONS.forEach((q, i) => {
    const specQ = spec.gate[i];
    questions.push({
      key: questionKey(BLOCK.REJECT_GATE, q.key, 0),
      checklist_key: q.key,
      array_index: null,
      spec_number: i + 1,
      block: BLOCK.REJECT_GATE,
      layer: null,
      decision_rank: null,
      label: q.label,                                   // 投影：冻结件里给人看的短 label
      prompt: specQ.text,                              // 投影：冻结清单里的题面原文（含判据细则）
      reason_on_fail: q.reason,                        // 投影：拒收原因
      value_domain: valueDomain,
      required: true,
      omission: omissionFor(BLOCK.REJECT_GATE),
      consequence: consequencesFor(BLOCK.REJECT_GATE, q.reason),
      criteria_source: {
        spec: { path: spec.path, line: specQ.line },
        code: { path: c.path, line: L.GATE_QUESTIONS, fn: 'normTri + classifyIntake 的第 0 步' },
        executable: { path: ag.path, line: ag.line, export: 'q0' + (i + 1) },
      },
    });
  });

  // 决策树五层（逐层逐问）
  K.DECISION_ORDER.forEach((layer, rank) => {
    const Lspec = spec.layers[layer];
    Lspec.items.forEach((item) => {
      const idx = item.index - 1;
      questions.push({
        key: questionKey(BLOCK.DECISION, layer, idx),
        checklist_key: layer,
        array_index: idx,
        spec_number: item.index,
        block: BLOCK.DECISION,
        layer: layer,
        decision_rank: rank,
        label: null,                                   // 代码里没有层的短 label（那是 UI 侧的事）
        prompt: item.text,
        reason_on_fail: null,                          // 非全绿不拒收，只是这层不选
        value_domain: valueDomain,
        required: true,
        omission: omissionFor(BLOCK.DECISION),
        consequence: consequencesFor(BLOCK.DECISION, null),
        criteria_source: {
          spec: { path: spec.path, line: item.line, heading: Lspec.title },
          code: { path: c.path, line: L.QUESTION_COUNT, fn: 'layerGreen（长度与逐项 true 判定）' },
          executable: null,                            // 决策层没有可执行判据件，如实留空
        },
      });
    });
  });

  // L4 后置叠加（可选）
  overlays.forEach((layer) => {
    const Lspec = spec.layers[layer];
    Lspec.items.forEach((item) => {
      const idx = item.index - 1;
      questions.push({
        key: questionKey(BLOCK.OVERLAY, layer, idx),
        checklist_key: layer,
        array_index: idx,
        spec_number: item.index,
        block: BLOCK.OVERLAY,
        layer: layer,
        decision_rank: null,
        label: null,
        prompt: item.text,
        reason_on_fail: null,
        value_domain: valueDomain,
        required: false,
        omission: omissionFor(BLOCK.OVERLAY),
        consequence: consequencesFor(BLOCK.OVERLAY, null),
        criteria_source: {
          spec: { path: spec.path, line: item.line, heading: Lspec.title },
          code: { path: c.path, line: L.QUESTION_COUNT, fn: 'classifyIntake 第 1.5 步的 layerGreen(\'L4\', …)' },
          executable: null,
        },
      });
    });
  });

  // 键唯一性：协议键重复 = 装配写错了，红在这里比红在模型手里强
  const byKey = {};
  for (const q of questions) {
    if (byKey[q.key]) throw new Error('intakeProtocol: 协议键重复：' + q.key);
    byKey[q.key] = q;
  }

  // 必答的 **checklist 键**（去重：层内多问共用一个键，是同一个键位）
  const requiredKeys = [];
  for (const q of questions) {
    if (q.required && requiredKeys.indexOf(q.checklist_key) === -1) requiredKeys.push(q.checklist_key);
  }

  return {
    protocol_version: PROTOCOL_VERSION,
    // 协议读的是哪几个文件、各自的常量在第几行（行号也是投影来的，不是手写的）
    sources: {
      intake_js: { path: c.path, lines: L },
      checklist_spec: { path: spec.path, version: K.CHECKLIST_HASH },
      intake_store: { path: store.path, lines: store.lines },
      anchor_gate: { path: ag.path, line: ag.line, exports: ag.names },
    },
    projection: {
      checklist_hash: K.CHECKLIST_HASH,
      gate_questions: K.GATE_QUESTIONS.slice(),        // ★校验器自检的独立依据（见 validator 的 protocolSelfCheck）
      decision_order: K.DECISION_ORDER.slice(),
      question_count: Object.assign({}, K.QUESTION_COUNT),
      primary_layers: K.PRIMARY_LAYERS.slice(),
      all_layers: K.ALL_LAYERS.slice(),
      gate_transitions: K.GATE_TRANSITIONS.slice(),
      engine_table: K.ENGINE_TABLE,
      scorable_layers: K.SCORABLE_LAYERS.slice(),
      g2: K.G2,
      reject_reasons: store.enums.REASONS.slice(),
      intake_layers: store.enums.INTAKE_LAYERS.slice(),
      gates: store.enums.GATES.slice(),
    },
    value_domain: valueDomain,
    counts: {
      gate: K.GATE_QUESTIONS.length,
      decision: K.DECISION_ORDER.reduce((a, l) => a + K.QUESTION_COUNT[l], 0),
      overlay: overlays.reduce((a, l) => a + K.QUESTION_COUNT[l], 0),
      total: questions.length,
      note: '必答 = gate + decision；overlay 可选，不计入必答。',
    },
    required_keys: requiredKeys,
    questions: questions,
    by_key: byKey,
  };
}

let _cached = null;
/** 取进程内缓存的那份协议（同一进程只装配一次）。 */
function getProtocol() {
  if (_cached === null) _cached = buildProtocol();
  return _cached;
}

module.exports = { buildProtocol, getProtocol, PROTOCOL_VERSION, BLOCK, TRI };

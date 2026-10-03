'use strict';
/**
 * 局鉴 · bench/extract-claims.cjs —— 档案声称抽取（**仅供 bench 用**）
 *
 * ══ 先说清它测什么、不测什么 ════════════════════════════════════════════
 *   它把档案里**显式写出的**声称语句转成局鉴的声称行，好让矛盾检测引擎
 *   在真实对局上跑起来。
 *
 *   ★**它不测抽取质量。** 产品的抽取路径是 LLM（`src/llm/engine.js` 的
 *   extractEvent），需要网络、且每次措辞不同——那不是可复跑评测能容纳的。
 *   本文件是**档案格式适配器**：档案本来就把「谁宣称了什么角色」写在明面上，
 *   这里只是把它读成结构化行。
 *
 *   ⇒ bench 的结论只覆盖：矛盾检测引擎 ＋ 存储层 ＋ RD1 纪律。
 *     **不覆盖**：抽取准确率、LLM 推理质量、嫌疑排序优于基线（后者已被预注册协议判负）。
 *
 * ══ 为什么不让它「顺便」也用 LLM 抽 ══════════════════════════════════════
 *   因为一旦允许，bench 的读数就会随模型版本、温度、网络状态漂移。
 *   **不可复跑的评测不是评测，是许愿。**
 *   真要测 LLM 那条路，得另立一个协议（冻结模型、固定温度、逐条落盘原始输出），
 *   那是另一件事，不该混进这个「零网络、逐条可复核」的 bench。
 */

// ── 角色词 → 局鉴的 claims_role 归一口径 ─────────────────────────────────
// 与 kernel/botc/roles.js 的解析同源思路，但这里不查 130 角色表：
// 档案里出现的是中文俗语角色名（「预言家」「女巫」「猎人」…），逐个映射即可。
// 未识别的角色**原样保留**在 object 里（降级 said），不丢弃、不编造。
const ROLE_ALIASES = {
  预言家: 'seer', 女巫: 'witch', 守卫: 'protection', 猎人: 'hunter',
  白痴: 'idiot', 丘比特: 'cupid', 丘比特恋人: 'cupid_lover',
  警长: 'sheriff', 小天使: 'virgin', 村民: 'villager', 平民: 'villager',
};

/**
 * 抽一条事件里的声称。
 *
 * 识别三类（都是档案里**明写**的，不是推断）：
 *   ① `N 号…宣称身份=ROLE`      → claims_role(N, N, ROLE)
 *   ② `N 号…查杀 M 号`／`M 号是狼人` → is_wolf(N, M)
 *   ③ `N 号…给 M 号发金水`／`M 号是好人` → is_good(N, M)
 *
 * 抽不出来的**一条都不补** —— 补全会让评测结果变好看，而变好看正是预注册要防的那件事。
 *
 * @returns {Array<{seat, subject_seat, predicate, object}>}
 */
function extractClaims(ev) {
  const out = [];
  const t = ev.text;

  // ① 宣称身份：3号公开宣称身份=预言家 / 8号 Sol 上警竞选，跳预言家
  const role = t.match(/(\d{1,2})\s*号[^。；;]{0,20}?(?:宣称身份|自称|跳|声称自己是|公开宣称)\s*(?:身份)?\s*[=＝]?\s*([一-龥A-Za-z]{2,8})/);
  if (role) {
    const seat = Number(role[1]);
    const raw = role[2].trim();
    // ★否定/疑问守卫 —— 这是**正确性**修复，不是为了让数字好看。
    //   实测踩到的原文：「看 12号 跳不跳预言家」（11号在问别人跳不跳，不是自己宣称）。
    //   不加守卫会把它记成「12号声称不跳预言家」——
    //   **否定被读成肯定**，而这正是会毒害复盘工具的那类错：
    //   它制造一条不存在的声称，然后所有基于它的矛盾推理都建立在谎话上。
    const between = t.slice(t.indexOf(role[0]), t.indexOf(role[0]) + role[0].length);
    const NEGATED = /不跳|跳不跳|不是|未跳|认预言家|质疑|是否|看\s*\d+\s*号\s*跳/;
    if (!NEGATED.test(between) && !/^不/.test(raw)) {
      // ★角色必须落在已知词表内，否则**降级 said**（与局鉴 BOTC 路径同语义）。
      //
      //   为什么不「宽松保留原文当角色名」：那样会抽出
      //   `claims_role 枪牌`、`claims_role 预言家中的任何一` 这类超捕获，
      //   它们看着像角色，实际是散文片段。留着会让「这一局有多少条角色声称」这个数虚高，
      //   也会让对跳检测在噪声上比对。
      //   ⇒ 宁可少抽，也不留看不懂的东西；少抽的部分由覆盖率如实报出来。
      const known = ROLE_ALIASES[raw];
      out.push({
        seat, subject_seat: seat,
        predicate: known ? 'claims_role' : 'said',
        object: known || raw,
        _raw: raw,
        _degraded: !known,
      });
    }
  }

  // ② 查杀：9号公布查验信息："6号是狼人" / 3号查杀5号
  const wolf = t.match(/(\d{1,2})\s*号[^。；;]{0,30}?(?:查杀|查杀了|验出|验的是|验了)\s*[^0-9]{0,6}(\d{1,2})\s*号[^。；;]{0,12}(?:是狼|为狼|是狼人)/)
    || t.match(/(\d{1,2})\s*号[^。；;]{0,30}?(\d{1,2})\s*号\s*(?:是狼人|是狼|为狼人)/);
  if (wolf) {
    out.push({
      seat: Number(wolf[1]), subject_seat: Number(wolf[2]),
      predicate: 'is_wolf', object: '查杀',
    });
  }

  // ③ 金水：9号验的4号是好人 / 7号给5号发金水
  const good = t.match(/(\d{1,2})\s*号[^。；;]{0,30}?(?:验|验了|验的|发了?)\s*[^0-9]{0,6}(\d{1,2})\s*号[^。；;]{0,12}(?:是好人|是金水|为好人|是民)/)
    || t.match(/(\d{1,2})\s*号[^。；;]{0,20}?给\s*(\d{1,2})\s*号[^。；;]{0,12}(?:发金水|金水)/);
  if (good) {
    out.push({
      seat: Number(good[1]), subject_seat: Number(good[2]),
      predicate: 'is_good', object: '好人',
    });
  }

  return out;
}

module.exports = { extractClaims, ROLE_ALIASES };
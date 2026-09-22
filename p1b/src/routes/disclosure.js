'use strict';
/**
 * p1b/src/routes/disclosure.js —— 披露件只读端点（P0-U7/U8 · 2026-09-16）
 *
 * GET /api/disclosure/calendar    → 最新 p1b/sim/out/forecast-calendar-YYYYMMDD.json
 * GET /api/disclosure/calibration → 最新 p1b/sim/out/calibration-report-YYYYMMDD.json
 * GET /api/disclosure/negative-results → 最新 p1b/sim/out/negative-results-ledger-YYYYMMDD.json（第 4 期 I2）
 * GET /api/disclosure/bayes-lens  → 最新 p1b/sim/out/stage4-run-five-layers-YYYYMMDD[a-z].json 的**精简投影**（第 4 期 I6）
 * 纪律：只读落盘件（latestByPattern 同款取最新日期件）；缺件 404 + 生成命令提示（不静默、不编数）；
 *   零 LLM、零写库、零引擎重跑。additive：既有端点零改动。
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '..', 'sim', 'out');

function latest(re) {
  try {
    const c = fs.readdirSync(OUT).filter((f) => re.test(f)).sort();
    if (c.length) return path.join(OUT, c[c.length - 1]);
  } catch (e) { /* 目录不可读 ⇒ 视为缺件 */ }
  return null;
}
// ★2026-09-21：日期后允许可选小写字母后缀（同日重跑的 `…-20260921c.json` 此前被忽略 ⇒ 静默读旧件）。
//   与 board.cjs / calibration-report.cjs 同批修（三处同一缺陷）。
function serve(pattern, hint, reply) {
  const p = latest(pattern);
  if (!p) return reply.code(404).send({ error: 'n/a：缺披露件（未生成或尚未跑脚本）', hint: hint });
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {
    return reply.code(500).send({ error: '披露件不可解析: ' + path.basename(p) });
  }
}

function register(app) {
  app.get('/api/disclosure/calendar', async (req, reply) =>
    serve(/^forecast-calendar-(\d{8})([a-z]?)\.json$/, 'node p1b/scripts/forecast-calendar.cjs', reply));
  app.get('/api/disclosure/calibration', async (req, reply) =>
    serve(/^calibration-report-(\d{8})([a-z]?)\.json$/, 'node p1b/scripts/calibration-report.cjs', reply));

  // ── 第 4 期 I2：负结果账本对外（15 号件 §I2「第 1 期末即可上，成本近零」）──
  app.get('/api/disclosure/negative-results', async (req, reply) =>
    serve(/^negative-results-ledger-(\d{8})([a-z]?)\.json$/, 'node p1b/scripts/negative-results.cjs', reply));

  // ── 2026-09-22 前端全方面重构：判词离散度（9 路单时刻横截面）──
  //   additive 只读端点：fs.readFileSync 落盘件，零写库、零 LLM、不碰 p1a.db 契约。
  //   ★ 件内自带 discipline/no_time_axis 声明——它度量重测信度，不是「信念随时间更新」；
  //     前端必须原文披露，不得据此画折线（详见 p1b/scripts/verdict-spread.cjs 头注）。
  app.get('/api/disclosure/verdict-spread', async (req, reply) =>
    serve(/^verdict-spread-(\d{8})([a-z]?)\.json$/, 'node p1b/scripts/verdict-spread.cjs', reply));

  // ── 第 4 期 I6：贝叶斯语义透镜（**精简投影**：只返回页面需要的字段，不透传整件）──
  app.get('/api/disclosure/bayes-lens', async (req, reply) => {
    const p = latest(/^stage4-run-five-layers-(\d{8})([a-z]?)\.json$/);
    if (!p) return reply.code(404).send({ error: 'n/a：缺读数件（未生成或尚未跑脚本）', hint: 'node p1b/scripts/stage4-run.cjs --text <out> --json <out>' });
    let j;
    try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {
      return reply.code(500).send({ error: '读数件不可解析: ' + path.basename(p) });
    }
    // 只投影页面需要的既有列（零新算；缺键如实 null）
    const layers = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
    const report = j.report || {};
    const domains = Array.isArray(j.by_domain) ? j.by_domain : [];
    return {
      source_file: path.basename(p),
      generated_at: j.generated_at || null,
      bayes_legend: j.bayes_legend || null,
      layers: layers.map((L) => {
        const r = report[L] || {};
        return { layer: L, ledger_rows: r.ledger_rows === undefined ? null : r.ledger_rows, scored_n: r.scored_n === undefined ? null : r.scored_n, brier_engine: r.brier_engine === undefined ? null : r.brier_engine };
      }),
      domains: domains.map((d) => ({
        layer: d.layer, domain: d.domain, scored_n: d.scored_n, conclusion_allowed: d.conclusion_allowed,
        mean_p: d.mean_p === undefined ? null : d.mean_p, obs_rate: d.obs_rate === undefined ? null : d.obs_rate,
        brier_engine: d.brier_engine === undefined ? null : d.brier_engine,
      })),
      cells_total: j.domain_cells_total === undefined ? null : j.domain_cells_total,
      cells_with_conclusion: j.domain_cells_with_conclusion === undefined ? null : j.domain_cells_with_conclusion,
    };
  });

  // ── 第 4 期 A9：三行对比榜（我方 vs 市场参照 vs 人类基线）──
  // ★口径纪律（本端点最重要的设计决定）：
  //   ①**不做「直接比 Brier」**——三行题集不同、horizon 不同 ⇒ 直接并列是**跨题集比较**，错。
  //   ②榜只展示**同口径可比项**，并**显式标注不可比原因**（题集/horizon/状态）。
  //   ③市场价仅作**对手参照**（蓝图 07 号件原文），不得塞进我方 baseRate。
  //   ④人类基线引用 `forecastbench-baseline.json`，该件自声明「转载级，引用前建议人工核对」⇒ 页内如实标注。
  app.get('/api/disclosure/arena', async (req, reply) => {
    const s4p = latest(/^stage4-run-five-layers-(\d{8})([a-z]?)\.json$/);
    const fbp = path.join(OUT, 'forecastbench-baseline.json');
    if (!s4p) return reply.code(404).send({ error: 'n/a：缺读数件（未生成或尚未跑脚本）', hint: 'node p1b/scripts/stage4-run.cjs --text <out> --json <out>' });
    let s4, fb = null;
    try { s4 = JSON.parse(fs.readFileSync(s4p, 'utf8')); } catch (e) { return reply.code(500).send({ error: '读数件不可解析: ' + path.basename(s4p) }); }
    try { fb = JSON.parse(fs.readFileSync(fbp, 'utf8')); } catch (e) { fb = null; }

    // 我方行：按层聚合（引擎重放口径；n<30 的格不出结论）
    const report = s4.report || {};
    const layers = ['L1', 'L2', 'L3', 'L5', 'L6'];
    const mine = layers.map((L) => {
      const r = report[L] || {};
      return { layer: L, scored_n: r.scored_n === undefined ? null : r.scored_n, brier: r.brier_engine === undefined ? null : r.brier_engine, note: r.note ? String(r.note).slice(0, 120) : null };
    });

    // 人类行：ForecastBench 基线（如实标注来源与核验状态）
    const human = fb ? {
      source: fb.source || null,
      status: fb.status || null,
      metric: fb.metric || null,
      usage_rule: fb.usage_rule || null,
      values: fb.values || null,
    } : null;

    // 市场行：**当前不可比**（题全未解）——如实报状态，不编数
    const market = {
      available: false,
      reason: '市场参照题（赔率族）当前全部未结算 ⇒ 无法计算其 Brier；仅作对手参照，不参与我方读数',
      pending_note: '待该族题结算后本行自动出数（例行结算通道）',
    };

    // ★不可比声明（三条，逐条给理由）
    const incomparable = [
      { pair: '我方 vs 人类基线', reason: '**题集不同**（我方以天气/汇率/能源为主；ForecastBench 以社会经济指标为主）＋ **horizon 口径不同**（FB 为 forecast_due_date + n 天档，我方按事件日）⇒ 两个 Brier **不可直接并列比较**，仅可作**量级参照**。' },
      { pair: '我方 vs 市场', reason: '当前市场族题全部未结算 ⇒ 无读数；且即使出数，市场价与引擎读数的**获取时点口径**不同（市场为发布时快照），比较须先对齐时点。' },
      { pair: '人类基线内部', reason: 'FB 件自声明「**口径=转载级**，逐句核对建议在引用前做一次」⇒ 本页标注为**未核验转载值**，引用前须人工核对。' },
    ];

    return {
      source_file: path.basename(s4p),
      generated_at: s4.generated_at || null,
      mine,
      human,
      market,
      incomparable,
      qualification_block: [
        '重放计分（读侧）：我方数字来自引擎重放，账本 gate=descriptive 未计分；baseline_brier 列从未写入。',
        '过程能力门（G2）不含质量读数（门定性恒挂限定语）；对外表述一律挂限定语。',
        'n<30 的格只记方向、不出结论；格间禁池化。',
      ],
      discipline_note: '本榜**不做跨题集 Brier 直接比较**；三行各自标注口径与状态，可比性逐对声明。',
    };
  });

  // ── 第 4 期「编译器门面」（蓝图 §2.4；04 号件：最小版＝把六层管线包成「问题→层+配方+概率」入口）──
  // ★设计要点（本门面的全部价值＝**降低接题门槛**）：
  //   既有 `/api/intake/classify` 要求用户填 **九组 checklist 二元问答**（Q0×3 + L5/L6/L1/L3/L2）
  //   —— 普通用户答不上来。本门面改为：用户只给 `kind`（真值锚类型），后端**查账本历史**自动给出
  //   「层 + 引擎配方 + 参考读数」，用户可**覆盖**（覆盖即视为人工判定，仍走既有 classify 通道）。
  // ★依据（本会话实测）：52 个 kind **全部单层**（0 个跨层）⇒ kind→layer 可 100% 自动推断。
  // ★纪律：①**只读**（查账本历史，零写库）②给的是**参考**不是判定（判定仍须走 classify 的 checklist）
  //   ③层与引擎均带**样本量**（n<30 如实标注「样本不足」）④不得声称「自动出概率」。
  app.get('/api/disclosure/compiler', async (req, reply) => {
    const q = (req && req.query) || {};
    const kind = typeof q.kind === 'string' ? q.kind.trim() : '';
    // 契约表：列出可用 kind（用户从中选，避免自由输入错 kind）
    const cp = path.join(OUT, 'g2-contract-frozen-r4.json');
    let contracts = null;
    try { contracts = JSON.parse(fs.readFileSync(cp, 'utf8')).contracts || null; } catch (e) { contracts = null; }

    // 无 kind ⇒ 返回「可选项 + 说明」（门面首屏）
    if (!kind) {
      return {
        mode: 'catalog',
        contract_source: contracts ? 'g2-contract-frozen-r4.json' : null,
        kinds: contracts ? Object.keys(contracts).sort().filter((k) => k.charAt(0) !== '_').map((k) => ({ kind: k, required: contracts[k].required || [], one_of: contracts[k].one_of || [] })) : [],
        how_it_works: [
          '第一步：选一个真值锚类型——它决定这道题「能不能机检」。',
          '第二步：门面查账本历史，给出这类题通常属于哪一层、用哪个引擎、有多少同类样本。',
          '第三步：这只是参考建议，不是判定。正式接题仍须走接题页的三问核对。',
        ],
        discipline_note: '本门面只读账本历史（零写库）；给出的是参考建议，不替代接题页的拒收门与核对判据。',
      };
    }

    // 有 kind ⇒ 查历史，给「层 + 配方 + 样本量」
    const dbm = require('../deps').db;
    const conn = dbm.getConnection();
    const rows = conn.prepare(
      "SELECT layer, engine, COUNT(*) n," +
      " SUM(CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END) resolved" +
      " FROM predictions WHERE json_extract(evidence_json,'$[0].resolve.kind') = ?" +
      " GROUP BY layer, engine ORDER BY n DESC"
    ).all(kind);
    if (!rows.length) {
      return {
        mode: 'lookup', kind,
        known: false,
        reason: '账本历史中无此 kind 的题 ⇒ 无法给出参考（本门面只据历史推断，不编）',
        hint: '若这是新 kind：请先在接题页手工填写 checklist（新 kind 无历史可依，须人工判定）。',
      };
    }
    const totalN = rows.reduce((s, r) => s + r.n, 0);
    const resolvedN = rows.reduce((s, r) => s + r.resolved, 0);
    const top = rows[0];
    const layers = [...new Set(rows.map((r) => r.layer))];
    return {
      mode: 'lookup', kind,
      known: true,
      suggestion: {
        layer: top.layer,
        layer_unanimous: layers.length === 1,     // 历史是否单一层
        all_layers_seen: layers,
        engine: top.engine,
        engine_note: top.engine && /_baserate|baserate_forward/.test(String(top.engine)) ? '基率配方（stat_baseline 族）' : (top.engine === 'proc_calc' ? '程序复算' : (top.engine === 'structural' ? '判词结构聚合' : (top.engine === 'aci' ? 'ACI 在线校准' : (top.engine === 'none' || top.engine === 'none_forward' ? '认证源分布（无模型）' : String(top.engine || 'n/a'))))),
      },
      evidence: {
        total_n: totalN,
        resolved_n: resolvedN,
        sample_ok: totalN >= 30,
        sample_note: totalN >= 30 ? ('同类样本 ' + totalN + ' 条，达 n≥30 线') : ('同类样本仅 ' + totalN + ' 条（<30）⇒ 参考强度弱，如实标注'),
        breakdown: rows.map((r) => ({ layer: r.layer, engine: r.engine, n: r.n, resolved: r.resolved })),
      },
      next_steps: [
        '带这个参考去接题页：填真值锚（kind + 参数）+ 核对拒收门三问。',
        '★门面给的是**建议**；正式判定以接题页 checklist 为准（不一致时以 checklist 为准）。',
        '★本门面不出概率（概率只在引擎计分后出现，且须过 G2 限定语）。',
      ],
      discipline_note: '只读账本历史；不写库、不出概率、不替代 checklist 判定。',
    };
  });
}

module.exports = { register };

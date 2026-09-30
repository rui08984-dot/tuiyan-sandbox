'use strict';
/**
 * p1b/src/routes/disclosure.js —— 披露件只读端点（P0-U7/U8 · 2026-09-16）
 *
 * GET /api/disclosure/calendar    → 最新 p1b/sim/out/forecast-calendar-YYYYMMDD.json
 * GET /api/disclosure/calibration → 最新 p1b/sim/out/calibration-report-YYYYMMDD.json
 * GET /api/disclosure/habits     → 同一份 calibration-report 的**归并投影**：按域归并的偏差榜
 *                                   （口径真源 src/disclosure/habitRank.mjs，只读、零写库）
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

  // ── 2026-09-30：「你在哪类事上偏」对外（**只读**，additive）──
  //   病象：/calibration 只逐格吐出 cells，**不做任何归并**；归并此前只活在一个 React
  //   组件的 useMemo 里（WhereOffPage habits）⇒ 本项目最核心的那个价值没有可被调用的接口，
  //   后端、脚本、外部调用方都够不着。
  //   ⇒ 本端点把同一份归并（src/disclosure/habitRank.mjs，判据一字未改）暴露出来。
  //   ★只读：只读落盘件 + 纯计算，零写库、零 LLM、零引擎重跑、零账本接触。
  //   ★为什么这么排写在返回体的 ranking 里（连同剔掉的域）——不给调用方一个黑盒数字。
  //     页面上那一句说明也从同一处取文案，避免"计算一处、解释另一处"。
  app.get('/api/disclosure/habits', async (req, reply) => {
    // 放在 handler 里面 require：与本文件既有风格一致（deps/revealClass 等都这么写）
    const { rankHabits, habitBuckets, HABIT_RANK_BASIS } = require('../disclosure/habitRank.mjs');
    const p = latest(/^calibration-report-(\d{8})([a-z]?)\.json$/);
    if (!p) return reply.code(404).send({ error: 'n/a：缺披露件（未生成或尚未跑脚本）', hint: 'node p1b/scripts/calibration-report.cjs' });
    let j;
    try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {
      return reply.code(500).send({ error: '披露件不可解析: ' + path.basename(p) });
    }
    const cells = Array.isArray(j.cells) ? j.cells : [];
    // ★剔掉的域也如实回：ok=0 意味着这个域一格都没测够 ⇒ n<30 纪律，不给比例。
    //   归并只做一遍（habitBuckets 与 rankHabits 同源），本端点不自己数第二遍。
    const dropped = habitBuckets(cells)
      .filter((b) => b.ok === 0)
      .map((b) => ({
        domain: b.domain, n: b.n, cells: b.cells,
        reason: '这个域没有任何一格够样本（ok=0）⇒ 按 n<30 纪律不给比例，只记方向',
      }));
    return {
      source_file: path.basename(p),
      generated_at: j.generated_at === undefined ? null : j.generated_at,
      cells_total: j.cells_total === undefined ? null : j.cells_total,
      cells_with_conclusion: j.cells_with_conclusion === undefined ? null : j.cells_with_conclusion,
      habits: rankHabits(cells),
      ranking: HABIT_RANK_BASIS,
      dropped_domains: dropped,
      read_only: true,
      discipline: [
        '本端点只读：只读落盘件 + 纯计算，不改账本任何一列、不重跑引擎、不调 LLM。',
        'delta 的分母是**够样本的格数（ok）**，不是题数 n。',
        '样本不足 30 的格不进本榜，也不出现在 dropped_domains 的任何比例字段里：只记方向。',
        '归并口径的真源是 src/disclosure/habitRank.mjs，本端点与网页组件共用同一份。',
      ],
    };
  });

  // ── 第 4 期 I2：负结果账本对外（15 号件 §I2「第 1 期末即可上，成本近零」）──
  app.get('/api/disclosure/negative-results', async (req, reply) =>
    serve(/^negative-results-ledger-(\d{8})([a-z]?)\.json$/, 'node p1b/scripts/negative-results.cjs', reply));

  // ── 2026-09-22 前端全方面重构：判词离散度（9 路单时刻横截面）──
  //   additive 只读端点：fs.readFileSync 落盘件，零写库、零 LLM、不碰 p1a.db 契约。
  //   ★ 件内自带 discipline/no_time_axis 声明——它度量重测信度，不是「信念随时间更新」；
  //     前端必须原文披露，不得据此画折线（详见 p1b/scripts/verdict-spread.cjs 头注）。
  app.get('/api/disclosure/verdict-spread', async (req, reply) =>
    serve(/^verdict-spread-(\d{8})([a-z]?)\.json$/, 'node p1b/scripts/verdict-spread.cjs', reply));

  // ── 2026-09-28 T6：揭晓分流（**只读**，四段）──
  //   病象：旧「待落定」页把到期未解的题列成一队让人**全部手填**，
  //   但守护进程已在自动结算（实测一轮：到期 21 → 自动结 2 / pending 12 / fail 7）。
  //   ⇒ 那页是倒退设计。本端点把「到期未解」按**能不能自动揭晓**分三类，
  //     另把「已结算」单列一段（那是结果，不是待办）：
  //     Ⓐ 已自动揭晓（守护进程已结，折叠展示结果）
  //     ① 机器能自己查、此刻还没落定（ok：到期守护进程会自己结，**不是用户的活**）
  //     ② 待你确认（need_human：机器拿不到但人能答，附「为什么」）
  //     ③ 永远结不了（stuck：接口封禁 / 真值窗口已过，**不给假按钮**）
  //   ★分类真源见 src/evidence/revealClass.js（kind 的固有属性，非运行时日志——那没落库）。
  //   ★零写：不改 p1a.db 任何一列。
  //
  // ★2026-09-28 修：返回体曾只回 need_human / stuck 两桶，**ok 桶算完就扔**。
  //   ⇒ counts.ok 有数、明细没行，前端只好写一句「有 N 条机器能自己查、既不列出来也不给键」
  //   ——那是接口在替自己的缺失找借口。现在三桶逐桶回行，计数一律取自 split 本身
  //   （不再混用 classCounts：它的 human/unknown 与 need_human 是**两个不同集合**，
  //     同一个数字两个名字，界面必然数错）。unregistered 是 need_human 的**子桶**不是第四类。
  app.get('/api/disclosure/resolve-queue', async (req) => {
    const conn = require('../deps').db.getConnection();
    const today = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 10);
    const RC = require('../evidence/revealClass');
    const ownership = require('../db/ownershipStore');
    const analytics = require('../db/analyticsStore');
    const { httpError } = require('../util');
    const rawVisitor = (req.query && req.query.visitor_id) || null;
    // ★格式非法的 visitor_id 必须 400，**不许静默忽略**——静默忽略等于把「我的题」
    //   悄悄降级成「别人的题」，页面照常渲染，用户看不出自己被换了身份。
    if (rawVisitor && !analytics.isValidId(rawVisitor)) {
      throw httpError(400, 'visitor_id 格式非法（只允许字母数字与 _ - . :，≤64 字符）');
    }
    const visitorId = rawVisitor;

    // ① 已自动揭晓：已结算且有真值，按到期日倒序（最近的在前）
    const autoRows = conn.prepare(
      "SELECT p.id, p.statement, p.assigned_prob, p.outcome, p.resolved_at, p.layer," +
      " json_extract(p.evidence_json,'$[0].resolve.kind') kind, p.matures_at" +
      " FROM predictions p WHERE p.resolved_at IS NOT NULL AND p.outcome IS NOT NULL" +
      " ORDER BY p.resolved_at DESC LIMIT 40"
    ).all();

    // ②③ 待处理：到期未解
    const openRows = conn.prepare(
      "SELECT p.id, p.statement, p.assigned_prob, p.layer," +
      " json_extract(p.evidence_json,'$[0].resolve.kind') kind, p.matures_at" +
      " FROM predictions p WHERE p.resolved_at IS NULL AND p.matures_at IS NOT NULL" +
      " AND substr(p.matures_at,1,10) <= ? ORDER BY p.matures_at ASC"
    ).all(today);

    const split = { ok: [], human: [], stuck: [] };
    // ★逐行标注与三桶计数同源（见 bucketize）⇒ open_buckets 三桶之和 ≡ open_total 由构造保证
    const own = ownership.bucketize(openRows.map((r) => r.id), visitorId);
    for (const r of openRows) {
      const c = RC.classifyReveal(r.kind);
      const bucket = own.buckets[r.id];
      // ★「别人的题只报数、不列行」——照 p1b/test/question-views.test.cjs:230 已有的红线。
      //   view_bucket 只是标签；题面必须**在服务端就脱敏**。前端不渲染 ≠ 没泄露：
      //   响应体已经带着别人的题面进了浏览器，F12 就能读。
      const isOthers = bucket === 'others';
      const row = isOthers ? { ...r, statement: null } : r;
      (split[c.c] || split.human).push({
        ...row, cls: c.c,
        why: isOthers ? '归属他人的题（只报数，不列行）' : c.note,
        unregistered: !c.kind || !RC.REVEAL_CLASS[c.kind],
        view_bucket: bucket,
      });
    }

    return {
      mode: 'resolve-queue',
      today,
      counts: {
        auto_revealed: autoRows.length,
        // ★三桶计数一律取自 split —— 与下面三个返回数组**同一份数据**，不另算一遍
        ok: split.ok.length,
        need_human: split.human.length,
        stuck: split.stuck.length,
        unregistered: split.human.filter((r) => r.unregistered).length,
        open_total: openRows.length,   // 三桶之和 ≡ 本值（互斥且完备的直证，前端可自校验）
      },
      // 归属三桶（与上面三类正交）：这个待办集合里我的几条、语料库几条、别人的几条
      open_buckets: own.counts,
      // 已揭晓的归属拆解走账本全体口径（不是那 40 条切片）——它是账本的性质
      auto_by_bucket: ownership.autoRevealedCounts(visitorId),
      // known=false ⇒ 这枚标识服务端不认（换了库/清过档），此时「我的题」是 0，
      //   但那意思**不是**「你没有题」，页面必须换一套措辞
      viewer: { visitor_id: visitorId, known: Boolean(visitorId && analytics.getVisitorRow(visitorId)) },
      // n<30 纪律的分母线（与 ownershipStore / 披露件门面同口径；不足就只记条数、不给比例）
      min_n: ownership.MIN_N,
      auto_revealed: autoRows.map((r) => ({
        id: r.id, statement: r.statement, assigned_prob: r.assigned_prob,
        outcome: r.outcome, resolved_at: r.resolved_at, layer: r.layer, kind: r.kind,
      })),
      ok: split.ok,
      need_human: split.human,
      stuck: split.stuck,
      discipline: [
        '三类互斥且完备：每个到期未解的题必属其一（分类依据＝kind 的取数能力，不是运行时日志——那没落库）。',
        '「永远结不了」的题**不给可点按钮**——点了没反应比不给更糟，用户会以为是 bug。',
        'ok 桶同理**不给键**：到期后守护进程自己会结，页面只报「等它自己查」，不催用户动手。',
        '本端点只读：不改账本任何一列。揭晓仍由守护进程与 resolve 接口写。',
      ],
    };
  });

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

    // ★2026-09-28 T4：补「同类题历史真实频率」——**这是产品主循环的起点**。
    //   用户的流程是：写一道题 → **后端先给一个数（概率）** → 到期后回来验证。
    //   本门面原先只给「层 + 引擎 + 样本量」，那个数没露出来，等于把主循环砍掉一半
    //   （实测：binance 那类 27 条已结算里真发生 2 条 = 7.4%，数据一直在盘上）。
    //
    // 口径（与项目既有纪律一致，引用不新造）：
    //   · 分母＝**已结算且 outcome ∈ {true,false}** 的同类题（未结算的不进分母——
    //     把"还没到期的题"算进样本会让人以为已经有答案了）。
    //   · n<30 ⇒ `enough:false`，界面须写「只记方向，别当结论」。
    //     这不是新纪律，是既有 K F13／stage4 的 n≥30 纪律在接题侧的同一口径。
    //   · 只读、零写；不算新题（这道题自己还没落库）。
    const hist = conn.prepare(
      "SELECT COUNT(*) n, SUM(CASE WHEN outcome = 'true' THEN 1 ELSE 0 END) hit" +
      " FROM predictions WHERE json_extract(evidence_json,'$[0].resolve.kind') = ?" +
      " AND resolved_at IS NOT NULL AND outcome IN ('true','false')"
    ).get(kind);
    const hN = Number(hist && hist.n) || 0;
    const hHit = Number(hist && hist.hit) || 0;
    const hEnough = hN >= 30;
    const baseRate = hN > 0
      ? {
          n: hN,
          hit: hHit,
          rate: hHit / hN,
          enough: hEnough,
          note: hEnough
            ? ('同类已结算 ' + hN + ' 条，真发生 ' + hHit + ' 条（' + (hHit / hN * 100).toFixed(1) + '%）')
            : ('同类只结算了 ' + hN + ' 条，不足 30 ⇒ 只能记方向，不能当结论用'),
        }
      : { n: 0, hit: 0, rate: null, enough: false, note: '同类还没有已结算的题 ⇒ 没有历史频率可用' };

    return {
      mode: 'lookup', kind,
      known: true,
      base_rate: baseRate,
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

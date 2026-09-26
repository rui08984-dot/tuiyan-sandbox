/**
 * OverviewPage —— 校准总览（2026-09-22 二轮重构 · 四页合一）
 *
 * ★ 为什么合并（依据全站审计）：
 *   原先 /audit、/calibration、/bayes-lens、/arena 四页展示的是**同一批 Brier 数字的四种重排**：
 *   - /calibration 的 cells[29] 与 /bayes-lens 的 domains[29] 逐字段相等（前者由后者 map 派生）；
 *   - /arena 的 mine[5] 是同一组层级 Brier；
 *   - /audit 的分层矩阵是同一份数据的账本口径切片。
 *   使用者要翻四页才能拼出全貌，且每页都要重新学习一套术语 —— 这是「看不懂」的根因。
 *
 * ★ 本页的信息架构（三层，一屏见主结论）：
 *   第一层：整体读数卡（一个大号半圆仪表 + 关键数字）——「现在到底准不准」
 *   第二层：分层读数卡网格（六层各一卡，图形当主角）——「哪层准、哪层不准」
 *   第三层：分域热力表 + 可折叠的专业细节 ——「具体到某个域、以及工程口径」
 *
 * ★ 红线（继承既有测试闸，一条不动）：
 *   - 空态文案「样本不足」「n<30 出不了区间」「n<30 仅方向」原文保留
 *   - 稀疏格 ≠ 0；无读数不画成好格
 *   - 页面正文与代码注释均不得出现禁用字样（禁词闸源码级扫描）
 */
import { useEffect, useMemo, useState } from 'react';
import { IconChart, IconLayers, EmptyState, KVTable, HelpMark } from '../../components/ui';
import { PagePlate } from '../../components/PagePlate';
import { PageSidebar } from '../../components/PageSidebar';
import '../../styles/shell.css';
import {
  ChartFrame, HeatGrid, ReadoutCard, DeviationBar, SpecimenStrip, ForestPlot, ReliabilityPlot, StackedBar, Waffle,
} from '../../charts';
import type { HeatCell } from '../../charts';
import { quad, tri, int, THIN_CELL_NOTE, MISSING_TEXT, humanId } from '../../lib/format';

type Cell = {
  layer: string; domain: string; scored_n: number; conclusion_allowed: boolean;
  mean_p: number | null; obs_rate: number | null; brier_engine: number | null;
  delta_vs_half: number | null; delta_ci95: { lb: number | null; ub: number | null } | null;
};
type Sem = { role: string; note: string };
type PreQuential = { max_gap: number | null; gap_at_half: number | null; reorder_rho: number | null; months: number | null };
type LagStratum = {
  label: string; n: number | null; hist?: { r1: number; r2: number; r3: number } | null;
  perm_p_wilson?: number | null; perm_p_tilt?: number | null; tilt_sig?: boolean | null;
};
type RepJson = {
  title: string; generated_at: string;
  stage4_present: boolean; stage4_file: string;
  qualification_block: string[];
  leakage_statement: { excluded_rows: number | null; fingerprint: string | null; text: string };
  bayes_semantics: Record<string, Sem | null> | null;
  cells: Cell[]; cells_total: number | null; cells_with_conclusion: number | null;
  prequential_two_order?: Record<string, PreQuential> | null;
  lag_rank_test?: { strata?: LagStratum[]; available?: boolean; not_a_gate?: string; reason_unavailable?: string } | null;
};
type LayerLens = { layer: string; ledger_rows: number | null; scored_n: number | null; brier_engine: number | null };
type AiJson = {
  source_file: string; generated_at: string | null;
  bayes_legend: { map?: Record<string, Sem>; map_v2?: Record<string, Sem> } | null;
  layers: LayerLens[];
};

/** 六层人话名（静态词表；专业定义收在展开区，正文不出现内部词） */
const LAYER_META = [
  { id: 'L1', name: '决定论', plain: '算得出来，像算术题' },
  { id: 'L2', name: '系综', plain: '有大量同类历史可查' },
  { id: 'L3', name: '短窗混沌', plain: '短期内能算，过几天就不准' },
  { id: 'L4', name: '自反', plain: '有人会因为看到它而改行为' },
  { id: 'L5', name: '不可约随机', plain: '纯运气，谁都猜不到' },
  { id: 'L6', name: '对抗', plain: '对手在跟你斗，会针对你' },
];
const LAYER_COLOR: Record<string, string> = {
  L1: 'var(--layer-l1)', L2: 'var(--layer-l2)', L3: 'var(--layer-l3)',
  L4: 'var(--layer-l4)', L5: 'var(--layer-l5)', L6: 'var(--layer-l6)',
};
const SEM_LABEL: Record<string, string> = {
  L1: '复算', L2: '先验', L3: '先验＋校准', L4: '标注层', L5: '认证分布', L6: '后验聚合',
};
const MAX_BRIER = 0.25; // 无信息常数 0.5 对应的水平线

/**
 * 限定语块人话化。
 * ★ 后端原文含内部标识（`gate=descriptive`、`baseline_brier`、`n<30`）——
 *   合规含义必须一字不丢，但术语要译成人话；数值口径（30 条门槛）保持原样。
 */
function humanizeQualification(q: string): string {
  return String(q)
    .replace('重放计分（读侧）：', '')
    .replace(/账本 gate=descriptive 未计分/g, '账本里只作记录、不计分')
    .replace(/baseline_brier 列从未写入/g, '对照读数从未写入')
    .replace(/n<30 的格/g, '样本少于 30 条的格')
    .replace(/过程能力门（G2）/g, '质量门');
}

/** 各层语义的人话标签（原 role 是内部标识：deterministic_recalc / prior / …） */
const SEM_ROLE: Record<string, string> = {
  deterministic_recalc: '程序复算',
  prior: '历史基率起算',
  'prior+calibration': '基率起算＋区间校正',
  certified_prior: '认证随机源',
  posterior_aggregation: '证据合成',
  annotation_layer: '人工标注层',
};

function humanizeSemantics(s: Sem | null): string {
  if (!s) return 'n/a（该层无读数）';
  const role = SEM_ROLE[s.role] ?? s.role;
  return role + '（' + s.note + '）';
}

export default function OverviewPage() {
  const [rep, setRep] = useState<RepJson | null>(null);
  const [lens, setLens] = useState<AiJson | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [layerPick, setLayerPick] = useState<string[]>([]);
  const [domainPick, setDomainPick] = useState<string[]>([]);
  // ★八轮第四改：标本带点选联动的当前域（null=未选）
  const [activeDomain, setActiveDomain] = useState<string | null>(null);
  const [onlyAllowed, setOnlyAllowed] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch('/api/disclosure/calibration').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/disclosure/bayes-lens').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([a, b]) => {
      if (!alive) return;
      if (!a && !b) { setMissing('数据还没准备好'); return; }
      setRep(a as RepJson | null);
      setLens(b as AiJson | null);
    });
    return () => { alive = false; };
  }, []);

  const cells = rep?.cells ?? [];
  const layers = lens?.layers ?? [];

  /** 整体读数：全部可计分样本的加权平均 Brier（把有读数的格子合成一个数）
   *  ★ 口径说明必须与旁边四个计数一致：四个计数统计的是全部 29 格，
   *    而这里只合并「有 Brier 读数」的格（10 格）。两者不同属正常，
   *    故在卡内文字里把两个数字都写清，避免使用者以为数字对不上是 bug。 */
  const overall = useMemo(() => {
    const valid = cells.filter((c) => typeof c.brier_engine === 'number' && c.scored_n > 0);
    if (!valid.length) return null;
    const n = valid.reduce((a, c) => a + c.scored_n, 0);
    const w = valid.reduce((a, c) => a + (c.brier_engine as number) * c.scored_n, 0);
    return { brier: w / n, n, cells: valid.length };
  }, [cells]);

  /** 分层读数：优先用 lens.layers（层级聚合），缺则从 cells 汇总 */
  const byLayer = useMemo(() => {
    const src = layers.length ? layers.map((l) => ({
      layer: l.layer, n: l.scored_n, brier: l.brier_engine,
    })) : LAYER_META.map((m) => {
      const cs = cells.filter((c) => c.layer === m.id && typeof c.brier_engine === 'number');
      const n = cs.reduce((a, c) => a + c.scored_n, 0);
      const w = cs.reduce((a, c) => a + (c.brier_engine as number) * c.scored_n, 0);
      return { layer: m.id, n: n || null, brier: n ? w / n : null };
    });
    return src;
  }, [layers, cells]);

  /** 每层的域级读数（用于迷你趋势：看该层内各域的水平分布） */
  const trendByLayer = useMemo(() => {
    const map: Record<string, number[]> = {};
    for (const c of cells) {
      if (typeof c.brier_engine !== 'number') continue;
      (map[c.layer] = map[c.layer] ?? []).push(c.brier_engine);
    }
    for (const k of Object.keys(map)) map[k].sort((a, b) => a - b);
    return map;
  }, [cells]);

  const domains = useMemo(() => Array.from(new Set(cells.map((c) => c.domain))).sort(), [cells]);
  /* 域键 → 可读标签（六轮）：键本身仍是下划线命名，只在**显示层**转成词形 */
  const domainLabel = useMemo(() => {
    const m: Record<string, string> = {};
    for (const d of domains) m[d] = humanId(d);
    return m;
  }, [domains]);

  const filtered = useMemo(() => {
    let cs = cells;
    if (layerPick.length) cs = cs.filter((c) => layerPick.indexOf(c.layer) >= 0);
    if (domainPick.length) cs = cs.filter((c) => domainPick.indexOf(c.domain) >= 0);
    if (onlyAllowed) cs = cs.filter((c) => c.conclusion_allowed);
    return cs;
  }, [cells, layerPick, domainPick, onlyAllowed]);

  const heatCells: HeatCell[] = filtered.map((c) => ({
    layer: c.layer, domain: c.domain, value: c.brier_engine, n: c.scored_n, allowed: c.conclusion_allowed,
  }));

  const forestRows = useMemo(() => filtered
    .filter((c) => c.delta_vs_half !== null)
    .sort((a, b) => Math.abs(a.delta_vs_half ?? 0) - Math.abs(b.delta_vs_half ?? 0))
    .map((c) => ({
      label: `${c.layer}·${c.domain}${c.conclusion_allowed ? '' : '（薄格）'}`,
      value: c.delta_vs_half,
      ciLo: c.delta_ci95 ? c.delta_ci95.lb : null,
      ciHi: c.delta_ci95 ? c.delta_ci95.ub : null,
    })), [filtered]);

  const relPoints = filtered.map((c) => ({ x: c.mean_p, y: c.obs_rate, n: c.scored_n, label: c.layer + '·' + c.domain }));

  if (missing) {
    return (
      <div className="ui-stack">
        <header className="page-head"><h1><IconChart size={20} /> 校准总览</h1></header>
        <EmptyState text={missing} testId="ov-missing" />
      </div>
    );
  }
  if (!rep && !lens) return <div className="ui-skeleton">正在读取读数…</div>;

  const thinCount = cells.filter((c) => !c.conclusion_allowed).length;
  /* 侧栏只列有读数的领域，按可读格子数降序（空领域是噪音不是信息） */
  const domainsWithData = domains
    .map((d) => ({ d, n: cells.filter((c) => c.domain === d && typeof c.brier_engine === 'number').length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .map((x) => x.d);

  return (
    <div className="ui-stack">
      <PagePlate
        testId="ov-plate"
        icon={<IconChart size={20} />}
        title="校准总览"
        tail="Calibration"
        subtitle={
          <>
            我们报出的概率，和实际发生的事情对得上多少。
            <b>数值越低越准</b>；0.25 是「一律报五成」这条基准线——低过它才算真的有用。
          </>
        }
      />

      {/* 两栏骨架：左侧分类器（宽屏常驻，窄屏折叠为横向条）+ 右侧主区 */}
      <div className="page-shell">
        <PageSidebar
          testId="ov-sidebar"
          title="筛选"
          onClear={() => { setLayerPick([]); setOnlyAllowed(false); setDomainPick([]); }}
          groups={[
            {
              label: '层',
              hint: '多选',
              options: LAYER_META.map((m) => {
                const cnt = cells.filter((c) => c.layer === m.id && typeof c.brier_engine === 'number').length;
                return { id: m.id, label: `${m.id} ${m.name}`, color: LAYER_COLOR[m.id], count: cnt };
              }),
              value: layerPick,
              onChange: setLayerPick,
            },
            {
              label: '领域',
              hint: `${domainsWithData.length} 个有读数`,
              /* 只列**有读数**的领域，并按可读格子数降序：
               * 原实现列出全部 27 个领域（多数计数为 0），侧栏被噪音撑得很长，
               * 使用者要滚动才能找到真正有数据的项。空领域不是信息，是干扰。 */
              options: domainsWithData.map((d) => ({
                id: d,
                label: domainLabel[d] ?? d,
                count: cells.filter((c) => c.domain === d && typeof c.brier_engine === 'number').length,
              })),
              value: domainPick,
              onChange: setDomainPick,
            },
            {
              label: '门槛',
              single: true,
              options: [
                { id: 'allowed', label: '只看样本充足的', count: cells.filter((c) => c.conclusion_allowed).length },
              ],
              value: onlyAllowed ? ['allowed'] : [],
              onChange: (v) => setOnlyAllowed(v.length > 0),
            },
          ]}
        />

        <div className="page-shell-main">

      {/* ══ 第一层：整体读数（一屏见主结论）══ */}
      <section className="ui-section" data-testid="ov-overall">
        <h2 className="ui-section-title">
          整体表现
          <HelpMark termId="brier" label="校准分是什么" testId="ov-overall-help" />
        </h2>
        {overall ? (
          <div className="ov-hero">
            {/* 主结论区：这一块用**大卡**（与下方网格区的小卡形成区域层级）。
             * 层级差异在"区域之间"是允许且必要的——它告诉使用者先看哪里；
             * 而同一区域内的卡片必须同形（六轮定版）。 */}
            <div className="ov-hero-card">
              <div className="ov-hero-figure">
                <DeviationBar value={overall.brier} baseline={0.25} max={MAX_BRIER} />
              </div>
              <div className="ov-hero-body">
                <span className="ov-hero-eyebrow">整体校准分</span>
                <div className="ov-hero-value">
                  <span className="ov-hero-num u-mono">{overall.brier.toFixed(3)}</span>
                  <span className="ov-hero-unit">Brier</span>
                </div>
                <p className="ov-hero-note">
                  由 {overall.cells} 个有读数的格子合并，共 {int(overall.n)} 条已结算记录。
                  基准线 0.25＝「一律报五成」，
                  <b className={overall.brier <= MAX_BRIER ? 'is-good' : 'is-bad'}>
                    {overall.brier <= MAX_BRIER ? '低于基准线' : '高于基准线'}
                  </b>。
                </p>
              </div>
            </div>
            <div className="ov-hero-stats">
              <div className="ov-waffle-panel">
                <Waffle
                  testId="ov-waffle"
                  filled={cells.length - thinCount}
                  total={cells.length}
                  label="样本充足的格子"
                  unit=" 格"
                  emptyLabel={`另有 ${thinCount} 格样本偏少，只记方向不出结论`}
                />
              </div>
              <div className="mini-rows">
                <div className="mini-row">
                  <span className="mini-row-label">覆盖领域</span>
                  <span />
                  <span className="mini-row-value u-mono">{int(domains.length)}</span>
                </div>
                <div className="mini-row">
                  <span className="mini-row-label">已结算记录</span>
                  <span />
                  <span className="mini-row-value u-mono">{int(overall.n)}</span>
                </div>
                <div className="mini-row">
                  <span className="mini-row-label">可读格子</span>
                  <span />
                  <span className="mini-row-value u-mono">{int(cells.length)}</span>
                </div>
              </div>
            </div>
          </div>
        ) : <EmptyState text="暂无可读的校准数据" />}
      </section>

      {/* ══ ★八轮第四改 · 标本带：29 格一排，形状即结论 ══
       * 放在「各层表现」之前，因为它是**回答问题的那个图**，卡片只是它的展开：
       *   扫一眼这一条 ⇒ 哪 10 格够、哪 19 格不够，全部解决；下面是逐层细节，要时才看。
       * 旧版把 29 格拆成 6 张等质卡片 ⇒ 独立 critic 判「连 L4 都没数据和 L1 拿到
       * 一模一样的盒子 ⇒ 同样的盒子 = 同样的确定性」，恰是本产品最要防的误读。 */}
      {cells.length ? (
        <section className="ui-section" data-testid="ov-strip">
          <h2 className="ui-section-title">
            <IconChart size={16} /> 标本带
            <HelpMark
              testId="ov-strip-help"
              text="每一格是一个「层 × 领域」的统计口径。实心＝样本够，可以说结论；斜纹＝样本不足，只记方向。斜纹和「数据是 0」是两回事，别读混。"
            />
          </h2>
          <SpecimenStrip
            testId="ov-specimen"
            cells={filtered.map((c) => ({
              layer: c.layer,
              domain: c.domain,
              n: c.scored_n,
              ok: !!c.conclusion_allowed,
              brier: c.brier_engine,
            }))}
            active={activeDomain}
            onPick={(s) => setActiveDomain(s ? s.domain : null)}
          />
        </section>
      ) : null}

      {/* ══ 第三层：分层读数卡（各层细节）══ */}
      <section className="ui-section" data-testid="ov-layers">
        <h2 className="ui-section-title">
          <IconLayers size={16} /> 各层表现
          <HelpMark
            testId="ov-layers-help"
            text="六层是按「这件事有多难算」分的：算得出来的（决定论）到纯运气（不可约随机）到有对手针对你（对抗）。不同层不能直接横向比较谁更准——因为难度本来就不同。"
          />
        </h2>
        <p className="ui-note" style={{ marginTop: 0 }}>
          六层各自的性质不同，横比之前先看每层是什么。样本少于 30 条的层只记方向，不下结论。
        </p>
        <div className="readout-grid stagger-in">
          {/* ★八轮第四改：标本带选中某域时，下方卡片只留与该域相关的层——
              两块因此是「图 ↔ 详情」的关系，不是并排的两个独立视图。 */}
          {LAYER_META.filter((m) => !activeDomain || byLayer.some((x) => x.layer === m.id && x.domain === activeDomain)).map((m) => {
            const row = byLayer.filter((x) => x.layer === m.id)[0];
            const n = row ? row.n : null;
            const brier = row ? row.brier : null;
            const thin = n !== null && n > 0 && n < 30;
            const noData = n === null || n === 0;
            /* 六轮定版：同组卡片一律同形（尺寸差异只在区域层级上，不在兄弟卡之间）。
             * 数据差异通过**数值、条高、状态色**表达，不通过卡片大小。 */
            return (
              <ReadoutCard
                key={m.id}
                testId={'ov-layer-' + m.id}
                title={<><span className="layer-dot" style={{ background: LAYER_COLOR[m.id] }} aria-hidden="true" />{m.id} · {m.name}</>}
                subtitle={m.plain}
                value={brier}
                scaleMax={MAX_BRIER}
                unit="Brier"
                rangeText={noData ? undefined : `已结算 ${int(n)} 条`}
                trend={trendByLayer[m.id]}
                status={noData ? '暂无读数' : (thin ? '样本偏少，仅记方向' : '样本充足')}
                tone={brier === null ? undefined : (brier <= MAX_BRIER ? 'ok' : 'warn')}
                chip={m.id === 'L4' ? 'plum' : undefined}
                missingText={noData ? MISSING_TEXT : '样本不足'}
              />
            );
          })}
        </div>
      </section>

      {/* ══ 第三层：分域热力表（可筛选）══ */}
      <section className="ui-section" data-testid="ov-domains">
        <h2 className="ui-section-title">
          各领域细分
          <HelpMark
            testId="ov-domains-help"
            text="领域＝题目的题材（如经济数据、天气、汇率）。同一个层里，不同领域的表现可能差很多——这张表就是让你看到差在哪。"
          />
        </h2>
        <p className="ui-note" style={{ marginTop: 0 }}>
          横向是领域、纵向是层。格上数字＝该格的表现，越低越准；
          斜纹格样本偏少，只记方向不出结论；空格＝该组合没有记录（不是表现好）。
          用左侧分类器可以只看某几层或某几个领域。
        </p>
        {heatCells.length ? (
          <ChartFrame
            testId="ov-heat"
            eyebrow="分层 × 领域"
            title="各格表现一览"
            sourceFile={rep?.stage4_file}
            generatedAt={rep?.generated_at}
            tableFallback={[
              ['层', '领域', '已结算', '发多少', '实际多少', 'Brier', '结论'],
              ...filtered.map((c) => [
                c.layer, c.domain, c.scored_n, quad(c.mean_p), quad(c.obs_rate), quad(c.brier_engine),
                c.conclusion_allowed ? '可出结论' : THIN_CELL_NOTE,
              ]),
            ]}
            note="格上数字直接印出，不靠颜色单独传达；斜纹＝样本偏少。"
          >
            <div tabIndex={0} role="region" aria-label="分层领域表，可横向滚动">
              {/* domains 仍是原始键（HeatGrid 靠它查格），另传 displayLabels 只改列头显示 */}
              <HeatGrid
                cells={heatCells}
                layers={layerPick.length ? layerPick : LAYER_META.map((m) => m.id)}
                domains={domains}
                displayLabels={domainLabel}
              />
            </div>
          </ChartFrame>
        ) : <EmptyState text="当前筛选下没有可显示的格子" />}
      </section>

      {/* ══ 第四层：专业细节（默认折起）══ */}
      <section className="ui-section" data-testid="ov-detail">
        <button type="button" className="ov-fold" aria-expanded={showDetail} onClick={() => setShowDetail((v) => !v)}>
          {showDetail ? '收起专业细节' : '展开专业细节（校准诊断与工程口径）'}
        </button>

        {showDetail ? (
          <div className="ui-stack" style={{ marginTop: 'var(--space-3)' }}>
            <ChartFrame
              testId="ov-forest"
              eyebrow="相对基准的差距"
              title="每格比「一律报五成」好多少"
              sourceFile={rep?.stage4_file}
              generatedAt={rep?.generated_at}
              note="横轴共享；虚线＝与基准无差别。负值＝比基准好，正值＝不如基准。细线是误差范围，跨过虚线说明差别不牢靠。"
            >
              {forestRows.length
                ? <ForestPlot rows={forestRows} threshold={0} thresholdLabel="0 无差异线" />
                : <EmptyState text="n/a（暂无可比较的格子）" />}
            </ChartFrame>

            <ChartFrame
              testId="ov-reliability"
              eyebrow="校准诊断"
              title="说多少 · 就发生多少？"
              sourceFile={rep?.stage4_file}
              generatedAt={rep?.generated_at}
            >
              {relPoints.length ? <ReliabilityPlot points={relPoints} /> : <EmptyState text="n/a" />}
            </ChartFrame>

            {rep?.prequential_two_order && Object.keys(rep.prequential_two_order).length ? (
              <ChartFrame
                testId="ov-prequential"
                eyebrow="顺序独立性"
                title="读数是否依赖呈现顺序"
                sourceFile={rep.stage4_file}
                generatedAt={rep.generated_at}
                note="数值越小说明越不依赖顺序，读数越稳。"
              >
                <div className="ui-stack">
                  {Object.keys(rep.prequential_two_order).sort().map((L) => {
                    const p = rep.prequential_two_order![L];
                    return (
                      <div className="ui-kv-row" key={L}>
                        <span className="ui-kv-key">
                          <span className="layer-dot" style={{ background: LAYER_COLOR[L] }} aria-hidden="true" />{L}
                        </span>
                        <span className="ui-kv-val u-mono">
                          顺序差 {tri(p.max_gap)}　半程差 {tri(p.gap_at_half)}　重排相关 {tri(p.reorder_rho)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </ChartFrame>
            ) : null}

            {rep?.lag_rank_test && Array.isArray(rep.lag_rank_test.strata) && rep.lag_rank_test.strata.length ? (
              <ChartFrame
                testId="ov-lagrank"
                eyebrow="独立性检验"
                title="滞后秩分布"
                sourceFile={rep.stage4_file}
                generatedAt={rep.generated_at}
                note={rep.lag_rank_test.not_a_gate ?? '如实转录，不据此出结论。'}
                tableFallback={[
                  ['分组', '条数', '低', '中', '高', '方向'],
                  ...rep.lag_rank_test.strata.map((s) => [
                    s.label, s.n, s.hist ? s.hist.r1 : null, s.hist ? s.hist.r2 : null, s.hist ? s.hist.r3 : null,
                    s.tilt_sig ? '显著' : '不显著',
                  ]),
                ]}
              >
                <div className="ui-stack">
                  {rep.lag_rank_test.strata.map((s, i) => (
                    <StackedBar key={i}
                      segments={[
                        { label: '低秩', value: s.hist ? s.hist.r1 : 0, color: 'var(--layer-l2)' },
                        { label: '中秩', value: s.hist ? s.hist.r2 : 0, color: 'var(--layer-l3)' },
                        { label: '高秩', value: s.hist ? s.hist.r3 : 0, color: 'var(--layer-l5)' },
                      ]}
                      total={(s.hist ? s.hist.r1 + s.hist.r2 + s.hist.r3 : 0) || null}
                      totalText={`${s.label}　共 ${s.n ?? '样本不足'} 条　${s.tilt_sig ? '方向显著' : '方向不显著'}`}
                    />
                  ))}
                </div>
              </ChartFrame>
            ) : null}

            {/* 分层语义：把「这一层为什么这样算」讲清楚（原语义透镜页的核心内容） */}
            {rep?.bayes_semantics ? (
              <ChartFrame
                testId="ov-semantics"
                eyebrow="各层的读法"
                title="同一批数字，各层含义不同"
                sourceFile={rep.stage4_file}
                generatedAt={rep.generated_at}
                note="横比之前先看这层是什么。例如决定论层的读数含义与运气层的完全不同。"
              >
                <KVTable testId="ov-sem-kv" rows={Object.keys(rep.bayes_semantics).sort().map((L) => ({
                  k: <><span className="layer-dot" style={{ background: LAYER_COLOR[L] }} aria-hidden="true" />{L} · {SEM_LABEL[L] ?? L}</>,
                  v: humanizeSemantics(rep.bayes_semantics![L]),
                }))} />
              </ChartFrame>
            ) : null}

            {/* 限定语与工程口径：合并原多页重复内容 */}
            <ChartFrame
              testId="ov-qual"
              eyebrow="口径与边界"
              title="这些数字是怎么来的"
              sourceFile={rep?.stage4_file}
              generatedAt={rep?.generated_at}
              note="读数来自引擎重放，与账本口径不同源、不可互相搬运。"
            >
              <ul className="ui-note" style={{ margin: 0 }}>
                {(rep?.qualification_block ?? []).map((q, i) => <li key={i}>{humanizeQualification(q)}</li>)}
                <li>{rep?.leakage_statement?.text ?? '防泄漏说明见数据文件'}</li>
              </ul>
              {rep?.leakage_statement?.excluded_rows !== null && rep?.leakage_statement?.excluded_rows !== undefined ? (
                <p className="ui-note" style={{ marginTop: 6 }}>
                  已剔除 {int(rep.leakage_statement.excluded_rows)} 条已知答案的记录
                  {rep.leakage_statement.fingerprint ? <span title={'校验指纹：' + rep.leakage_statement.fingerprint}>（已校验）</span> : null}
                </p>
              ) : null}
            </ChartFrame>
          </div>
        ) : null}
      </section>

        <p className="ui-note" data-testid="ov-generated-at">
          数据更新于 {rep?.generated_at ? new Date(rep.generated_at).toLocaleString('zh-CN', { hour12: false }) : '—'}
          {bulkNote(rep, lens)}
        </p>
        </div>
      </div>
    </div>
  );
}

function bulkNote(rep: RepJson | null, lens: AiJson | null): string {
  const bits: string[] = [];
  if (rep?.cells_total !== null && rep?.cells_total !== undefined) bits.push(`共 ${rep.cells_total} 格`);
  if (rep?.cells_with_conclusion !== null && rep?.cells_with_conclusion !== undefined) bits.push(`${rep.cells_with_conclusion} 格可出结论`);
  if (lens && !rep) bits.push('（仅语义层数据可用）');
  return bits.length ? ' ｜ ' + bits.join(' · ') : '';
}

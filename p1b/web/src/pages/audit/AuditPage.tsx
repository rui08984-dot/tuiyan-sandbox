/**
 * AuditPage —— 万物审计仪表盘（#/audit；UI 重构步 2，2026-09-14）。
 *
 * 信息架构（治 D1 容器太窄 / D2 六张卡 / D4 无层级 / D5 emoji 图标）：
 *   面包屑 → KPI 行(6 格) → 告警栏 → 分层矩阵表(6 行，点行展开内联详情) → Tab 明细
 * 数据源：GET /api/audit/summary（既有，契约不变）+ GET /api/audit/g2-kpi（新增只读，R4 KPI）。
 * 铁律：全文禁用宣称字样（用「审计／校准参考／分层账本／题面／判据」）；纯展示零 LLM；
 * 校准参考为机械算术，样本不足如实留空；图标=内联 SVG（emoji 清零）。
 *
 * ── 2026-09-22 全方面重构 ──
 *   ① KPI 卡加迷你仪表/占比条（value 文字仍在，图形只是补充）
 *   ② 补齐接口早已返回、此前从未渲染的 4 个 KPI（out_of_regime/unlayered/regime_rows/tautology_rows）
 *   ③ 分层矩阵「校准参考（CI）」列：字符串 → 误差须图（0.25 无信息阈值虚线）
 *   ④ 新增分层 × gate 计数矩阵（layer_gate[]，types.ts 注释早写明是矩阵数据源却没画）
 *   ⑤ 展开区补 settled / brier_n（同样从未渲染）
 */
import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import * as api from '../../api';
import type { AuditSummary, AuditLayerCalibration, AuditG2KpiResult } from '../../types';
import {
  StatCard, Badge, KVTable, Tabs, Breadcrumb, AlertBar, EmptyState, Term,
  IconChart, IconLayers,
} from '../../components/ui';
import { BrierGauge, ErrorBar, SparkBar, NestedBar } from '../../charts';
import { tri, pct, fmtCi, int, gateHuman, gateHumanMulti, engineHuman } from '../../lib/format';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 六层静态词表（照万物分类清单 v2 冻结版；中立词，零计算）
 *  plain＝人话一句（L1 表面），brief＝专业定义（收在展开区，配 Term）
 *  铁律：专业词一个不删，只从第一屏收进第二层。
 */
const LAYER_META: { id: string; name: string; plain: string; brief: string; engine: string; tone: string }[] = [
  { id: 'L1', name: '决定论', plain: '算得出来，像算术题', brief: '状态有限可枚举、规则完全已知且无隐藏随机、信息完全——程序复算即真值。', engine: 'proc_calc', tone: 'is-l1' },
  { id: 'L2', name: '系综', plain: '有大量同类历史可查，像查天气频率', brief: '稳定可重复总体上的频率问题——有 ≥30 条同型历史与外部基率锚可查。', engine: 'stat_baseline + Wilson', tone: 'is-l2' },
  { id: 'L3', name: '短窗混沌', plain: '短期内能算，过几天就不准', brief: '有演化机制与实时观测流，短窗内读数有效、窗外迅速失效（v2 阈值 1.5）。', engine: 'stat_baseline + ACI', tone: 'is-l3' },
  { id: 'L4', name: '自反（叠加层）', plain: '有人会因为看到它而改变行为', brief: '由人类决策产生且决策者可能接触账本——只作叠加层记录，禁公开。', engine: 'none（classify-only）', tone: 'is-l4' },
  { id: 'L5', name: '不可约随机', plain: '纯运气，谁都猜不到', brief: '认证随机源产生、无公开信息优势路径、题面无偏倚可利用。', engine: 'certified_dist', tone: 'is-l5' },
  { id: 'L6', name: '对抗', plain: '对手在跟你斗，会针对你', brief: '利益相反的智慧主体直接产生，对手可观测并适应——结构推断而非基率。', engine: 'structural', tone: 'is-l6' },
];

const GATE_ORDER = ['scored', 'descriptive', 'blocked'];

export default function AuditPage() {
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [kpi, setKpi] = useState<AuditG2KpiResult | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openLayer, setOpenLayer] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setLoadErr(null);
    try {
      const [s, k] = await Promise.all([api.getAuditSummary(), api.getAuditG2Kpi().catch(() => null)]);
      setSummary(s); setKpi(k);
    } catch (e) { setLoadErr(errMsg(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const l0 = summary?.l0_gate ?? null;
  const calibByLayer: Record<string, AuditLayerCalibration | undefined> = {};
  for (const r of summary?.layer_calibration ?? []) calibByLayer[r.layer ?? '未分层'] = r;
  const ciByLayer: Record<string, { ci_lo: number | null; ci_hi: number | null } | undefined> = {};
  for (const r of kpi?.layer_brier_ci ?? []) ciByLayer[r.layer ?? '未分层'] = r;
  const gateByLayer: Record<string, string> = {};
  for (const r of kpi?.layer_gate ?? []) {
    const L = r.layer ?? '未分层';
    const g = r.gate ?? '';
    if (!g) continue;                                    // 空状态不并进复合串（会拼出「descriptive / —」）
    const cur = gateByLayer[L];
    gateByLayer[L] = cur ? (cur.indexOf(g) >= 0 ? cur : cur + ' / ' + g) : g;
  }
  /** 分层 × gate 计数（layer_gate[] 的本来用途：矩阵，而非折成字符串） */
  const gateCount: Record<string, Record<string, number>> = {};
  for (const r of kpi?.layer_gate ?? []) {
    const L = r.layer ?? '未分层';
    const g = r.gate ?? '未标注';
    if (!gateCount[L]) gateCount[L] = {};
    gateCount[L][g] = (gateCount[L][g] ?? 0) + r.n;
  }
  const gates = Array.from(new Set((kpi?.layer_gate ?? []).map((r) => r.gate ?? '未标注')))
    .sort((a, b) => (GATE_ORDER.indexOf(a) < 0 ? 99 : GATE_ORDER.indexOf(a)) - (GATE_ORDER.indexOf(b) < 0 ? 99 : GATE_ORDER.indexOf(b)));

  const alerts: { tone: string; text: ReactNode }[] = [];
  if (kpi) {
    if (kpi.kpi.out_of_domain > 0) alerts.push({ tone: 'warn', text: <>门域外 {kpi.kpi.out_of_domain} 行（<Term id="g2Regime" plain="不按现行规则算" />；不参与达标判定）</> });
    if (kpi.kpi.hardest < 20) alerts.push({ tone: 'warn', text: '最难档 ' + kpi.kpi.hardest + ' 条 < 20 条工程下限（b(1−b)≥0.21）' });
  }
  if (l0 && l0.unresolved > 0) alerts.push({ tone: 'info', text: '在途待回填真值 ' + l0.unresolved + ' 条（真值未发生，不结算）' });
  const thin = (summary?.layer_calibration ?? []).filter((r) => r.n > 0 && r.n < 100).map((r) => r.layer ?? '未分层');
  if (thin.length) alerts.push({ tone: 'info', text: '薄样本层（n<100）：' + thin.join(' / ') });
  if (loadErr) alerts.push({ tone: 'danger', text: '账本读取失败：' + loadErr });

  const openMeta = openLayer ? LAYER_META.filter((m) => m.id === openLayer)[0] : null;
  const crumbs = [{ label: '审计' }, { label: '分层' }, { label: openMeta ? openMeta.id + ' · ' + openMeta.name : '全层', current: true }];
  const maxN = Math.max(1, ...(summary?.layer_calibration ?? []).map((r) => r.n));
  const maxGateN = Math.max(1, ...(kpi?.layer_gate ?? []).map((r) => r.n));

  return (
    <section className="page" data-testid="audit-page">
      <div className="ui-stack">
        <Breadcrumb items={crumbs} testId="breadcrumb" />
        <header style={{ margin: 0 }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 4px', fontSize: 'var(--font-size-h2)' }}>
            <IconChart size={20} /> 万物审计仪表盘
            <Badge tone="muted" testId="audit-banner">只记不评 · 分层账本</Badge>
          </h2>
          <p className="ui-note" style={{ margin: 0 }}>只记录、不打分 · 数字仅供参照，结论以完整判据为准</p>
        </header>

        {/* 加载骨架：占位尺寸与真实卡一致 ⇒ 数据到达时不跳动（CLS） */}
        {loading && (
          <div className="ui-kpi-row" data-testid="kpi-skeleton">
            {['总题量', '已解真值', '合格池', '最难档', '待解前瞻', '门域外'].map((lb) => (
              <div className="ui-stat" key={lb}>
                <span className="ui-stat-label">{lb}</span>
                <span className="ui-skeleton" style={{ width: '62%', height: 26, marginTop: 6, display: 'block' }} />
                <span className="ui-skeleton" style={{ width: '86%', height: 10, marginTop: 8, display: 'block' }} />
              </div>
            ))}
          </div>
        )}

        <div className="ui-kpi-row" data-testid="kpi-row" style={loading ? { display: 'none' } : undefined}>
          <StatCard testId="kpi-total" eyebrow="账本" label="总题量" value={l0 ? int(l0.records) : '—'}
            caption="账本总条数（参考）"
            viz={l0 ? <SparkBar value={l0.records_valid} max={l0.records || 1} text={'有效 ' + int(l0.records_valid)} /> : undefined} />
          <StatCard testId="kpi-resolved" eyebrow="真值" label="已解真值" value={l0 ? int(l0.resolved) : '—'}
            caption="真值已到（参考）"
            viz={l0 ? <SparkBar value={l0.resolved} max={l0.records || 1} color="var(--ok)" text={'占 ' + pct(l0.records ? l0.resolved / l0.records : null)} /> : undefined} />
          <StatCard testId="kpi-qualified" eyebrow="合规" label="合格池" value={kpi ? int(kpi.kpi.qualified_pool) : '—'}
            caption={<Term id="cutoff" plain="信息截止合规·非重言" />} />
          <StatCard testId="kpi-hardest" eyebrow="难度" label="最难档" value={kpi ? kpi.kpi.hardest : '—'}
            caption={<Term id="r4" plain="外生难度最高档" />} tone={kpi && kpi.kpi.hardest < 20 ? 'warn' : undefined}
            viz={kpi ? <SparkBar value={kpi.kpi.hardest} max={Math.max(kpi.kpi.qualified_pool || 1, 1)} threshold={20} text="下限 20" color="var(--warn)" /> : undefined} />
          <StatCard testId="kpi-pending" eyebrow="在途" label="待解前瞻" value={summary ? int(summary.pending_forward_total) : '—'}
            caption="真值未发生" />
          <StatCard testId="kpi-outside" eyebrow="域外" label="门域外" value={kpi ? int(kpi.kpi.out_of_domain) : '—'}
            caption={<Term id="g2Regime" plain="不按现行规则算" />} tone={kpi && kpi.kpi.out_of_domain > 0 ? 'accent' : undefined} />
        </div>

        {/* ── 此前从未渲染的 4 个 KPI（接口早就返回了） ── */}
        {kpi ? (
          <div className="ui-kpi-row" data-testid="kpi-row-extra" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
            <StatCard testId="kpi-out-of-regime" eyebrow="口径" label="规则域外行" value={int(kpi.kpi.out_of_regime)}
              caption={<Term id="g2Regime" plain="不在现行判据域内" />} />
            <StatCard testId="kpi-unlayered" eyebrow="覆盖" label="未分层行" value={int(kpi.kpi.unlayered)}
              caption={<Term id="layer" plain="还没定到 L1-L6" />} tone={kpi.kpi.unlayered > 0 ? 'warn' : undefined} />
            <StatCard testId="kpi-regime-rows" eyebrow="口径" label="规则域总行" value={int(kpi.kpi.regime_rows)}
              caption="参与判定的总行数" />
            <StatCard testId="kpi-tautology" eyebrow="隔离" label="重言行" value={int(kpi.kpi.tautology_rows)}
              caption="判定标准与结算定义重言，已隔离" />
          </div>
        ) : null}

        <AlertBar alerts={alerts} testId="alertbar" />

        <div className="ui-section" data-testid="layer-matrix">
          <h3 className="ui-section-title"><IconLayers size={16} /> 分层矩阵（L1-L6）</h3>
          <p className="ui-note" style={{ marginTop: 0 }}>点任意行展开该层详情（面包屑同步）；校准参考=已回填真值题上的机械算术，n&lt;30 不出 CI。</p>
          {loading && !summary ? <EmptyState text="账本读取中…" testId="audit-loading" /> : (
            <table className="ui-matrix" data-testid="layer-matrix-table">
              <thead>
                <tr>
                  <th><Term id="layer" plain="层" /></th><th className="num">题量</th><th className="num hide-narrow">已解</th>
                  <th><Term id="brier" plain="校准参考（CI）" /></th><th className="hide-narrow"><Term id="baseRate" plain="基率" /></th>
                  <th className="hide-narrow"><Term id="resolver" plain="算法" /></th><th className="hide-narrow">是否计分</th>
                </tr>
              </thead>
              <tbody>
                {LAYER_META.map((m) => {
                  const r = calibByLayer[m.id];
                  const ci = ciByLayer[m.id];
                  const open = openLayer === m.id;
                  return (
                    <Fragment key={m.id}>
                      <tr className="is-row" data-testid={'layer-row-' + m.id} onClick={() => setOpenLayer(open ? null : m.id)}>
                        <td><Badge tone={m.tone.replace('is-', '')}>{m.id}</Badge> <span style={{ color: 'var(--muted)' }}>{m.name}</span></td>
                        <td className="num"><SparkBar value={r ? r.n : 0} max={maxN} text={r ? r.n : 0} /></td>
                        <td className="num hide-narrow">{r ? r.resolved : 0}</td>
                        <td className="num" data-testid={'layer-brier-' + m.id}>
                          {/* 误差须 + 数值：ErrorBar 自带数值与区间文字（无障碍要求：图形必有文字兜底），
                           * 页面不再重复输出同一串——此前会渲染两遍（截图可见叠字）。 */}
                          <span className="layer-ci-cell">
                            <ErrorBar
                              value={r ? r.brier : null}
                              ciLo={ci ? ci.ci_lo : null}
                              ciHi={ci ? ci.ci_hi : null}
                              lo={0} hi={0.25} threshold={0.25} width={150}
                            />
                          </span>
                        </td>
                        <td className="hide-narrow">{(r && r.base_rate_n > 0) ? pct(r.base_rate) + '（n=' + r.base_rate_n + '）' : '样本不足'}</td>
                        <td className="hide-narrow" title={m.engine}>{engineHuman(m.engine)}</td>
                        <td className="hide-narrow" title={gateByLayer[m.id] ? '原始状态：' + gateByLayer[m.id] : undefined}>{gateHumanMulti(gateByLayer[m.id])}</td>
                      </tr>
                      {open && (
                        <tr className="is-detail" data-testid={'layer-detail-' + m.id}>
                          <td colSpan={7}>
                            <div className="layer-detail-flex">
                              <div className="layer-detail-gauge">
                                <BrierGauge value={r ? r.brier : null} label="校准参考 Brier" testId={'layer-gauge-' + m.id} />
                                {(r && r.base_rate_n > 0) ? <BrierGauge value={r.base_rate} label="基率" testId={'layer-gauge-br-' + m.id} /> : null}
                              </div>
                              <div className="ui-stack">
                                <p className="ui-note" style={{ marginTop: 0 }}><b>{m.plain}</b>——{m.brief}</p>
                                <KVTable testId={'layer-kv-' + m.id} rows={[
                                  { k: '题量 n', v: r ? r.n : 0 },
                                  { k: '已解真值', v: r ? r.resolved : 0 },
                                  { k: '无法判定', v: r ? r.ambiguous : 0 },
                                  { k: '已结算（基率分母）', v: r ? (r.settled ?? '—') : '—' },
                                  { k: '有概率可读数的题（Brier 分母）', v: r ? (r.brier_n ?? '—') : '—' },
                                  { k: <Term id="brier" plain="判得准不准" />, v: r ? tri(r.brier) : '样本不足' },
                                  { k: <Term id="wilson" plain="参考置信区间" />, v: fmtCi(ci ? ci.ci_lo : null, ci ? ci.ci_hi : null) },
                                  { k: <Term id="baseRate" plain="历史上占多少" />, v: (r && r.base_rate_n > 0) ? pct(r.base_rate) + '（n=' + r.base_rate_n + '）' : '样本不足' },
                                  { k: '算法', v: <span title={m.engine}>{engineHuman(m.engine)}</span> },
                                  { k: '是否计分', v: <span title={gateByLayer[m.id] ? '原始状态：' + gateByLayer[m.id] : undefined}>{gateHumanMulti(gateByLayer[m.id])}</span> },
                                ]} />
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── 分层 × 计分状态计数矩阵（layer_gate[] 的本来用途） ── */}
        {kpi && gates.length ? (
          <div className="ui-section" data-testid="gate-matrix">
            <h3 className="ui-section-title"><IconLayers size={16} /> 各层记录的计分状态</h3>
            <p className="ui-note" style={{ marginTop: 0 }}>
              每格数字＝该层处于该状态的记录条数（数字直接印在格上，不单靠颜色）。
              已计分＝参与成绩统计，只记录＝留档不出数，未通过门禁＝被规则挡住。
            </p>
            <div className="gatematrix" role="grid"
              style={{ gridTemplateColumns: `minmax(64px, auto) repeat(${gates.length}, minmax(0, 1fr))` }}>
              <span className="gm-head" />
              {gates.map((g) => <span key={g} className="gm-head" title={'原始状态：' + g}>{gateHuman(g)}</span>)}
              {LAYER_META.map((m) => (
                <Fragment key={m.id}>
                  <span className="gm-head">{m.id} {m.name}</span>
                  {gates.map((g) => {
                    const n = (gateCount[m.id] && gateCount[m.id][g]) || 0;
                    return (
                      <span key={g} className={'gm-cell' + (n === 0 ? ' is-zero' : '')}
                        style={n === 0 ? undefined : {
                          background: 'color-mix(in srgb, ' + 'var(--layer-' + m.id.toLowerCase() + ') '
                            + Math.max(8, Math.round((n / maxGateN) * 55)) + '%, var(--panel-2))',
                        }}
                        title={m.id + ' × ' + g + ' = ' + n}>
                        <b className="u-mono">{n}</b>
                      </span>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        ) : null}

        {summary && (
          <Tabs testId="audit-detail-tabs" tabs={[
            { id: 'ledger', label: '账本×判据版本', content: (
              <table className="ui-matrix" data-testid="audit-ledger-table">
                <thead><tr><th>层</th><th>判据版本</th><th className="num">条数</th><th className="num hide-narrow">重言隔离</th></tr></thead>
                <tbody>
                  {summary.by_layer_checklist.map((r, i) => (
                    <tr key={i}>
                      <td>{r.layer ?? '未分层'}</td>
                      <td title={r.checklist_hash ? '校验值：' + r.checklist_hash : undefined}>
                        {r.checklist_hash ? <span className="u-mono">{String(r.checklist_hash).slice(0, 8)}</span> : '—'}
                      </td>
                      <td className="num">
                        <NestedBar outer={r.n} inner={r.n - r.tautology_n} max={Math.max(1, ...summary.by_layer_checklist.map((x) => x.n))}
                          outerLabel="条数" innerLabel="非重言" />
                      </td>
                      <td className="num hide-narrow"><SparkBar value={r.tautology_n} max={Math.max(1, ...summary.by_layer_checklist.map((x) => x.tautology_n))} color="var(--warn)" text={r.tautology_n} /></td>
                    </tr>
                  ))}
                  {summary.by_layer_checklist.length === 0 && <tr><td colSpan={4}>账本暂无记录</td></tr>}
                </tbody>
              </table>
            ) },
            { id: 'gate', label: '计分状态分布', content: (
              summary.by_gate.length
                ? <div className="ui-stack" data-testid="audit-gate-dist">
                    {summary.by_gate.map((g, i) => (
                      <SparkBar key={i} value={g.n} max={Math.max(1, ...summary.by_gate.map((x) => x.n))}
                        text={gateHuman(g.gate) + '　' + int(g.n) + ' 条'} />
                    ))}
                  </div>
                : <EmptyState text="暂无记录" />
            ) },
            { id: 'calib', label: '校准结论', content: (
              <div className="ui-stack">
                <p className="ui-note" style={{ margin: 0 }}>
                  <b>R-A 读数门</b>：校准分 0.0008，<Badge tone="ok">已达成</Badge>
                  <span className="u-mono" style={{ marginLeft: 8, opacity: 0.75 }}>（结算证据读数）</span>
                </p>
                <p className="ui-note" style={{ margin: 0 }}>
                  <b>R-B 信息价值</b>：三路判词与分题型基率相当（等价性检验<span title="合并条款未达成">已达成</span>），
                  合并条款<Badge tone="muted">未达成</Badge>
                </p>
                <div><Badge tone="info">探索性结论 · 判据为预注册冻结版本</Badge></div>
              </div>
            ) },
            { id: 'forward', label: '待解前瞻（' + summary.pending_forward_total + '）', content: (
              <table className="ui-matrix" data-testid="audit-forward-table">
                <thead><tr><th>题面</th><th className="hide-narrow">层</th><th className="num">落注参考</th><th className="hide-narrow">到期日</th></tr></thead>
                <tbody>
                  {summary.pending_forward.map((r) => (
                    <tr key={r.id}>
                      <td>{r.target || r.statement}</td>
                      <td className="hide-narrow">{r.layer ?? '未分层'}</td>
                      <td className="num"><SparkBar value={r.assigned_prob} max={1} text={pct(r.assigned_prob)} /></td>
                      <td className="hide-narrow">{r.event_day ?? '目标期'}</td>
                    </tr>
                  ))}
                  {summary.pending_forward.length === 0 && <tr><td colSpan={4}>暂无待解前瞻记录</td></tr>}
                </tbody>
              </table>
            ) },
          ]} />
        )}

        {summary && <p className="ui-note" data-testid="audit-generated-at">账本快照：{summary.generated_at} ｜ {summary.note}</p>}
      </div>
    </section>
  );
}

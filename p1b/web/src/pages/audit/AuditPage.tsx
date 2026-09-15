/**
 * AuditPage —— 万物审计仪表盘（#/audit；UI 重构步 2，2026-09-14）。
 *
 * 信息架构（治 D1 容器太窄 / D2 六张卡 / D4 无层级 / D5 emoji 图标）：
 *   面包屑 → KPI 行(6 格) → 告警栏 → 分层矩阵表(6 行，点行展开内联详情) → Tab 明细
 * 数据源：GET /api/audit/summary（既有，契约不变）+ GET /api/audit/g2-kpi（新增只读，R4 KPI）。
 * 铁律：全文禁用宣称字样（用「审计／校准参考／分层账本／题面／判据」）；纯展示零 LLM；
 * 校准参考为机械算术，样本不足如实留空；图标=内联 SVG（emoji 清零）。
 */
import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import * as api from '../../api';
import type { AuditSummary, AuditLayerCalibration, AuditG2KpiResult } from '../../types';
import {
  StatCard, Badge, KVTable, Tabs, Breadcrumb, AlertBar, EmptyState, Term,
  IconChart, IconLayers,
} from '../../components/ui';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const tri = (v: number | null): string => (v === null || v === undefined ? '样本不足' : v.toFixed(3));
const pct = (v: number | null): string => (v === null || v === undefined ? '—' : (v * 100).toFixed(1) + '%');
const fmtCi = (lo: number | null, hi: number | null): string =>
  (lo === null || hi === null ? 'n<30 不出 CI' : '[' + lo.toFixed(3) + ', ' + hi.toFixed(3) + ']');

/** 六层静态词表（照万物分类清单 v2 冻结版；中立词，零计算） */
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

const STATIC_CALIB = {
  raLine: 'R-A 读数门：校准分 0.0008 —— 达成（结算证据读数）',
  rbLine: 'R-B 信息价值：负结果 —— 三路判词≈分题型基率（等价性检验达成），合并条款未达成',
  badge: '探索性 · 判据=预注册冻结件',
};
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
    const g = r.gate ?? '—';
    const cur = gateByLayer[L];
    gateByLayer[L] = cur ? (cur.indexOf(g) >= 0 ? cur : cur + ' / ' + g) : g;
  }

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

  return (
    <section className="page" data-testid="audit-page">
      <div className="ui-stack">
        <Breadcrumb items={crumbs} testId="breadcrumb" />
        <header style={{ margin: 0 }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 4px', fontSize: 'var(--font-size-h2)' }}>
            <IconChart size={20} /> 万物审计仪表盘
            <Badge tone="muted" testId="audit-banner">只记不评 · 分层账本</Badge>
          </h2>
          <p className="ui-note" style={{ margin: 0 }}>纯 SQL 只读 · 零 LLM · 门禁解锁前一切数字只配「参考」</p>
        </header>

        <div className="ui-kpi-row" data-testid="kpi-row">
          <StatCard testId="kpi-total" label="总题量" value={l0 ? l0.records : '—'} caption="账本总条数（参考）" />
          <StatCard testId="kpi-resolved" label="已解真值" value={l0 ? l0.resolved : '—'} caption="真值已到（参考）" />
          <StatCard testId="kpi-qualified" label="合格池" value={kpi ? kpi.kpi.qualified_pool : '—'} caption={<Term id="cutoff" plain="信息截止合规·非重言" />} />
          <StatCard testId="kpi-hardest" label="最难档" value={kpi ? kpi.kpi.hardest : '—'} caption={<Term id="r4" plain="外生难度最高档" />} tone={kpi && kpi.kpi.hardest < 20 ? 'warn' : undefined} />
          <StatCard testId="kpi-pending" label="待解前瞻" value={summary ? summary.pending_forward_total : '—'} caption="真值未发生" />
          <StatCard testId="kpi-outside" label="门域外" value={kpi ? kpi.kpi.out_of_domain : '—'} caption={<Term id="g2Regime" plain="不按现行规则算" />} tone={kpi && kpi.kpi.out_of_domain > 0 ? 'accent' : undefined} />
        </div>

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
                  <th className="hide-narrow"><Term id="resolver" plain="引擎位" /></th><th className="hide-narrow">gate</th>
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
                        <td className="num">{r ? r.n : 0}</td>
                        <td className="num hide-narrow">{r ? r.resolved : 0}</td>
                        <td className="num" data-testid={'layer-brier-' + m.id}>
                          {(r ? tri(r.brier) : '样本不足') + (ci && ci.ci_lo !== null ? ' ' + fmtCi(ci.ci_lo, ci.ci_hi) : '')}
                        </td>
                        <td className="hide-narrow">{(r && r.base_rate_n > 0) ? pct(r.base_rate) + '（n=' + r.base_rate_n + '）' : '样本不足'}</td>
                        <td className="hide-narrow"><span className="u-mono">{m.engine}</span></td>
                        <td className="hide-narrow">{gateByLayer[m.id] ?? '—'}</td>
                      </tr>
                      {open && (
                        <tr className="is-detail" data-testid={'layer-detail-' + m.id}>
                          <td colSpan={7}>
                            <p className="ui-note" style={{ marginTop: 0 }}><b>{m.plain}</b>——{m.brief}</p>
                            <KVTable testId={'layer-kv-' + m.id} rows={[
                              { k: '题量 n', v: r ? r.n : 0 },
                              { k: '已解真值', v: r ? r.resolved : 0 },
                              { k: '无法判定', v: r ? r.ambiguous : 0 },
                              { k: <Term id="brier" plain="判得准不准" />, v: r ? tri(r.brier) : '样本不足' },
                              { k: <Term id="wilson" plain="参考置信区间" />, v: fmtCi(ci ? ci.ci_lo : null, ci ? ci.ci_hi : null) },
                              { k: <Term id="baseRate" plain="历史上占多少" />, v: (r && r.base_rate_n > 0) ? pct(r.base_rate) + '（n=' + r.base_rate_n + '）' : '样本不足' },
                              { k: <Term id="resolver" plain="引擎位" />, v: m.engine },
                              { k: 'gate', v: gateByLayer[m.id] ?? '—' },
                            ]} />
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
        {summary && (
          <Tabs testId="audit-detail-tabs" tabs={[
            { id: 'ledger', label: '账本×判据版本', content: (
              <table className="ui-matrix" data-testid="audit-ledger-table">
                <thead><tr><th>层</th><th>判据版本</th><th className="num">条数</th><th className="num hide-narrow">重言隔离</th></tr></thead>
                <tbody>
                  {summary.by_layer_checklist.map((r, i) => (
                    <tr key={i}><td>{r.layer ?? '未分层'}</td><td className="u-mono">{r.checklist_hash ?? '—'}</td>
                      <td className="num">{r.n}</td><td className="num hide-narrow">{r.tautology_n}</td></tr>
                  ))}
                  {summary.by_layer_checklist.length === 0 && <tr><td colSpan={4}>账本暂无记录</td></tr>}
                </tbody>
              </table>
            ) },
            { id: 'gate', label: 'gate 分布', content: (
              summary.by_gate.length
                ? <KVTable testId="audit-gate-dist" rows={summary.by_gate.map((g) => ({ k: g.gate ?? '未分层（gate 未补录）', v: g.n }))} />
                : <EmptyState text="暂无记录" />
            ) },
            { id: 'calib', label: '校准汇总', content: (
              <div className="ui-stack">
                <KVTable testId="audit-calib-static" rows={[{ k: 'R-A', v: STATIC_CALIB.raLine }, { k: 'R-B', v: STATIC_CALIB.rbLine }]} />
                <div><Badge tone="info">{STATIC_CALIB.badge}</Badge></div>
              </div>
            ) },
            { id: 'forward', label: '待解前瞻（' + summary.pending_forward_total + '）', content: (
              <table className="ui-matrix" data-testid="audit-forward-table">
                <thead><tr><th>题面</th><th className="hide-narrow">层</th><th className="num">落注参考</th><th className="hide-narrow">到期日</th></tr></thead>
                <tbody>
                  {summary.pending_forward.map((r) => (
                    <tr key={r.id}><td>{r.target || r.statement}</td><td className="hide-narrow">{r.layer ?? '未分层'}</td>
                      <td className="num">{pct(r.assigned_prob)}</td><td className="hide-narrow">{r.event_day ?? '目标期'}</td></tr>
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

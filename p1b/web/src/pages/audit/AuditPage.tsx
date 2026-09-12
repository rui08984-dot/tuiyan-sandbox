/**
 * AuditPage —— 万物审计仪表盘（#/audit；G1 反馈 #3 · M2）。
 *
 * 数据源：GET /api/audit/summary（纯 SQL 只读聚合，零 LLM 零网络零评分——后端铁律同源）。
 * 布局：三层递进（2026-09-13 改造，用户反馈「列了一堆数据、缺交互界面」）——
 *   第一屏「一句话状态」：大号数字卡（在观察 N / 已回填 M / 门禁状态）+ 一句人话总结 + 折叠口径；
 *   第二屏「分层账本」：L1-L6 六张可点击展开的卡（题量/已解真值/校准参考/基率）；
 *   第三屏「明细长文」：原五块表（账本分层/门禁状态/待解前瞻/六层说明）收进默认折叠的 <details>。
 * 六块：①账本分层卡（layer×checklist_hash 计数表 + l0Gate 双口径 + gate 分布）
 *      ②分层校准汇总区（静态两行：R-A 读数门 / R-B 信息价值，恒挂「探索性 · 判据=PREREG 冻结件」）
 *      ③六层分类说明卡（L1-L6 一句话定义 + 引擎姿态，词表照 docs/specs/万物分类清单-v2.md）
 *      ④门禁状态卡（review_unlocked + 「只记不评」文案）
 *      ⑤待解前瞻卡（未回填真值的前瞻批次清单：题面/层次/落注概率/到期日；恒挂「真值未发生」）
 *      ⑥分层校准卡（layer × n/resolved + 已回填真值题上的 Brier vs 基率；样本不足留空）。
 *
 * UI 铁律（写死，违反=返工）：
 *  · UI 全文禁用任务书 P18-M2 所列宣称字样（以「审计/校准参考/分层账本」替代）；
 *  · 对局类型专属词零出现（本页不出现任何游戏类型词汇，game_type 走中立表达）；
 *  · 纯展示零 LLM（不发任何模型请求；②区为编译期静态常量，非实时计算）；
 *  · 页面恒挂定位横幅「万物审计 · 只记不评」（不随加载/出错状态消失）。
 * 词汇依据：万物分类清单 v2（六层+引擎姿态速查）+ PREREG-RB v1 判据节 +
 *  p16 M2 双口径（R-A/R-B 两读数禁止混宣称——R-A 数字不得用于 R-B 结论，反之亦然）。
 */
import { useCallback, useEffect, useState } from 'react';
import * as api from '../../api';
import type { AuditSummary, AuditLayerCalibration, AuditPendingForward } from '../../types';
import '../../styles/audit.css';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 六层词表（照清单 v2 冻结版：一句话定义 + 引擎姿态速查；中立词汇，静态常量零计算） */
const LAYER_CARDS: { id: string; name: string; brief: string; engine: string; llm: string }[] = [
  { id: 'L1', name: '决定论', brief: '状态有限可枚举、规则完全已知且无隐藏随机、信息完全——程序复算即真值。', engine: '程序计算（proc_calc）', llm: '仅代码生成，不出读数' },
  { id: 'L2', name: '系综', brief: '稳定可重复总体上的频率问题——有 ≥30 条同型历史与外部基率锚可查。', engine: '统计基率（stat_baseline）', llm: '基率' },
  { id: 'L3', name: '短窗混沌', brief: '有演化机制与实时观测流，短窗内读数有效、窗外迅速失效（v2 时界阈值 1.5 为预注册值）。', engine: '基率+ACI×滚动窗（aci）', llm: '校准' },
  { id: 'L4', name: '自反（叠加层）', brief: '结果由人类决策产生，且决策者可能接触账本本身（反馈回路）——只作叠加层记录，禁公开。', engine: '私有多路（禁公开）', llm: '聚合' },
  { id: 'L5', name: '不可约随机', brief: '结果由认证随机源产生、无任何公开信息优势路径、题面无偏倚可利用。', engine: '认证源分布', llm: '无' },
  { id: 'L6', name: '对抗', brief: '结果由利益相反的智慧主体直接产生，对手可观测并适应——结构推断而非基率。', engine: '结构推断（矛盾特征+多路）', llm: '多路+校准' },
];

/** 校准汇总区静态读数（②区铁律：编译期常量，非本页实时计算；来源=p16 R-A/R-B 计分节字面） */
const STATIC_CALIB = {
  raLine: 'R-A 读数门：Brier 0.0008 —— 达成（结算证据读数；判词能读懂结算事件）',
  rbLine: 'R-B 信息价值：负结果 —— 三路判词≈分题型基率（TOST 等价达成），合并条款未达成',
  badge: '探索性 · 判据=PREREG 冻结件',
  note: '本区为静态结算读数（R-A/R-B 跑批 2026-09-12），非本页账本实时计算；两读数禁止混宣称（R-A 数字不得用于 R-B 结论，反之亦然）。',
};

/** 概率 0-1 → 百分数字面（null 原样留空=如实，禁用占位数字） */
const pct = (v: number | null): string => (v === null || v === undefined ? '—' : (v * 100).toFixed(1) + '%');
/** Brier 三态文案：null → 「样本不足」（不编造数字） */
const tri = (v: number | null): string => (v === null || v === undefined ? '样本不足' : v.toFixed(3));
/** 基率行（settled 中 true 占比 + 样本量） */
const baseRate = (r: AuditLayerCalibration): string => {
  if (r.base_rate === null || r.base_rate_n === 0) return '样本不足';
  return (r.base_rate * 100).toFixed(1) + '%（n=' + r.base_rate_n + '）';
};
/** 到期日列：无日粒度（月频/期号类题）如实标「目标期」并给 target 文本 */
const dueOf = (r: AuditPendingForward) => {
  if (r.event_day) return r.event_day;
  const t = r.target || r.statement;
  return t ? t.slice(0, 24) + (t.length > 24 ? '…' : '') : '目标期';
};
/** 图例（校准口径说明，静态常量零计算） */
const CALIB_LEGEND = 'n=账本条数 ｜ resolved=已回填真值 ｜ 校准参考=已回填真值且概率非空题上的均方误差 ｜ 基率=真值题中为真的占比；样本不足留空';

export default function AuditPage() {
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      setSummary(await api.getAuditSummary());
    } catch (e) {
      setLoadErr(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const l0 = summary?.l0_gate ?? null;

  // 分层索引（第一/二屏用）：layer_calibration 按层取；无该层数据如实留空（样本不足不编造）
  const calibByLayer: Record<string, AuditLayerCalibration | undefined> = {};
  for (const r of summary?.layer_calibration ?? []) calibByLayer[r.layer ?? '未分层'] = r;
  // 一句话人话总结（只用账本数字，无任何宣称字样）
  const heroLine = l0 === null ? '' : (l0.review_unlocked
    ? '账本已解锁，正在观察 ' + l0.unresolved + ' 条前瞻题（已回填 ' + l0.resolved + ' 条真值）—— 读数可出具，仍只作参考。'
    : '门禁未解锁：覆盖 ' + l0.games + '/30 局、有效口径 ' + l0.records_valid + '/200 条，本页数字只作参考。');

  return (
    <section className="page" data-testid="audit-page">
      {/* 恒挂定位横幅（铁律）：页面级始终可见，不随加载/出错状态消失 */}
      <div className="audit-banner" role="note" data-testid="audit-banner">万物审计 · 只记不评</div>

      <header className="audit-head">
        <h2>📊 万物审计仪表盘</h2>
        <p className="audit-sub">分层账本统计（纯 SQL 只读 · 零 LLM）· 门禁解锁前一切数字只配「参考」</p>
      </header>

      {loading && <div className="callout" data-testid="audit-loading"><p className="callout-title">账本读取中…</p></div>}
      {loadErr && (
        <div className="banner banner-error" role="alert" data-testid="audit-error">
          <p>{loadErr}</p>
          <button type="button" className="btn" onClick={() => void refresh()}>重试</button>
        </div>
      )}

      {/* ── 第一屏 · 一句话状态（大号数字 + 人话总结；数字旁恒挂「参考」） ── */}
      {summary && l0 && (
        <div className="audit-hero" data-testid="audit-hero">
          <div className="audit-hero-nums">
            <div className="audit-hero-num" data-testid="audit-hero-open">
              <b>{l0.unresolved}</b><span>在观察 · 未回填真值</span>
            </div>
            <div className="audit-hero-num" data-testid="audit-hero-resolved">
              <b>{l0.resolved}</b><span>已回填 · 真值已到</span>
            </div>
            <div className="audit-hero-num" data-testid="audit-hero-gate">
              <b className={l0.review_unlocked ? 'is-ok' : 'is-warn'}>{l0.review_unlocked ? '已解锁' : '未解锁'}</b>
              <span>门禁状态</span>
            </div>
          </div>
          <p className="audit-hero-line" data-testid="audit-hero-line">{heroLine}</p>
          <p className="audit-hero-ref">以上数字只作「参考」（账本快照：{summary.generated_at}）</p>
          <details className="audit-fold audit-fold-hero" data-testid="audit-hero-more">
            <summary>展开账本口径（总账 / 有效口径 / 覆盖局数）</summary>
            <div className="audit-kv"><span>总账条数（含重言隔离）</span><b>{l0.records}<i className="audit-ref">参考</i></b></div>
            <div className="audit-kv"><span>有效口径（tautology=0）</span><b>{l0.records_valid}<i className="audit-ref">参考</i></b></div>
            <div className="audit-kv"><span>待回填</span><b>{l0.unresolved}<i className="audit-ref">参考</i></b></div>
            <div className="audit-kv"><span>覆盖局数</span><b>{l0.games}<i className="audit-ref">参考</i></b></div>
            <p className="audit-card-note" style={{ marginTop: 6, marginBottom: 0 }}>{l0.gate}</p>
          </details>
        </div>
      )}

      {/* ── 第二屏 · 分层卡片（L1-L6 六张卡，可点击展开该层明细） ── */}
      {summary && (
        <section className="audit-screen" data-testid="audit-layers-screen">
          <h3 className="audit-screen-title">第二屏 · 分层账本（L1-L6）</h3>
          <p className="audit-card-note">
            点任意卡片可展开该层明细（本屏内折叠）。题量/已解真值/校准参考/基率皆为账本机械算术，只作「参考」；样本不足如实留空。
          </p>
          <div className="audit-layer-grid" data-testid="audit-layers-grid">
            {LAYER_CARDS.map((lc) => {
              const r = calibByLayer[lc.id];
              return (
                <details className="audit-lcard" key={lc.id} data-testid={'audit-lcard-' + lc.id}>
                  <summary className="audit-lcard-head">
                    <span className="audit-layer-id">{lc.id}</span>
                    <span className="audit-lcard-name">{lc.name}</span>
                    <span className="audit-lcard-mini">题量 {r ? r.n : 0} · 已解真值 {r ? r.resolved : 0} · 校准参考 {r ? tri(r.brier) : '样本不足'}</span>
                    <span className="audit-lcard-caret" aria-hidden>▸</span>
                  </summary>
                  <div className="audit-lcard-body">
                    <div className="audit-lcard-stats">
                      <div className="audit-lcard-stat"><span>题量</span><b>{r ? r.n : 0}</b></div>
                      <div className="audit-lcard-stat"><span>已解真值</span><b>{r ? r.resolved : 0}</b></div>
                      <div className="audit-lcard-stat"><span>校准参考</span><b>{r ? tri(r.brier) : '样本不足'}</b></div>
                      <div className="audit-lcard-stat"><span>基率</span><b>{r ? baseRate(r) : '样本不足'}</b></div>
                    </div>
                    <p className="audit-lcard-brief">{lc.brief}</p>
                    <p className="audit-lcard-engine">引擎姿态：{lc.engine} ｜ 模型角色：{lc.llm}</p>
                    {r
                      ? <p className="audit-lcard-extra">已判真/假 <b>{r.settled}</b> 条 · 无法判定 <b>{r.ambiguous}</b> 条（账本计数，参考）</p>
                      : <p className="audit-lcard-extra">账本暂无该层记录（未分层题见第三屏明细）</p>}
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      )}

      {/* ── 第三屏 · 明细表（默认折叠：账本分层/门禁状态/待解前瞻/六层说明） ── */}
      {summary && l0 && (
        <details className="audit-fold audit-fold-detail" data-testid="audit-detail-fold">
          <summary>第三屏 · 明细表（账本分层 · 门禁状态 · 待解前瞻 · 六层说明）—— 点此展开</summary>
          <div className="audit-grid">
          {/* ① 账本分层卡 */}
          <div className="audit-card" data-testid="audit-ledger-card">
            <h3 className="audit-card-title">账本分层</h3>
            <p className="audit-card-note">层 × 判据版本（checklist_hash）分组计数；重言式题隔离记账，不计入有效口径。</p>
            <table className="audit-table" data-testid="audit-ledger-table">
              <thead>
                <tr><th>层</th><th>判据版本</th><th className="audit-num">条数</th><th className="audit-num">重言隔离</th></tr>
              </thead>
              <tbody>
                {summary.by_layer_checklist.map((r, i) => (
                  <tr key={i}>
                    <td>{r.layer ?? <span className="audit-mut">未分层</span>}</td>
                    <td>{r.checklist_hash ?? <span className="audit-mut">—</span>}</td>
                    <td className="audit-num">{r.n}</td>
                    <td className="audit-num">{r.tautology_n > 0 ? r.tautology_n : <span className="audit-mut">0</span>}</td>
                  </tr>
                ))}
                {summary.by_layer_checklist.length === 0 && (
                  <tr><td colSpan={4} className="audit-mut">账本暂无记录</td></tr>
                )}
              </tbody>
            </table>
            <div style={{ marginTop: 10 }} data-testid="audit-l0-dual">
              <div className="audit-kv"><span>总账条数（含重言隔离）</span><b>{l0.records}</b></div>
              <div className="audit-kv"><span>有效口径（tautology=0）</span><b>{l0.records_valid}</b></div>
              <div className="audit-kv"><span>已回填真值</span><b>{l0.resolved}</b></div>
              <div className="audit-kv"><span>待回填</span><b>{l0.unresolved}</b></div>
              <div className="audit-kv"><span>覆盖局数</span><b>{l0.games}</b></div>
            </div>
            <div style={{ marginTop: 8 }} data-testid="audit-gate-dist">
              <p className="audit-card-note" style={{ marginBottom: 4 }}>gate 分布</p>
              {summary.by_gate.map((g, i) => (
                <div className="audit-kv" key={i}>
                  <span>{g.gate ?? <span className="audit-mut">未分层（gate 未补录）</span>}</span>
                  <b>{g.n}</b>
                </div>
              ))}
              {summary.by_gate.length === 0 && <p className="audit-mut">暂无记录</p>}
            </div>
          </div>

          {/* ④ 门禁状态卡（放右列首：先看门禁再看数字） */}
          <div className="audit-card" data-testid="audit-gate-card">
            <h3 className="audit-card-title">门禁状态</h3>
            <p className="audit-card-note">
              解锁条件：覆盖 ≥30 局 ∧ 有效口径 ≥200 条（重言灌水不解锁门禁）。
            </p>
            <div data-testid="audit-gate-status">
              {l0.review_unlocked
                ? <span className="badge badge-ok">门禁已解锁（review_unlocked=true）</span>
                : <span className="badge badge-warn">门禁未解锁（review_unlocked=false）</span>}
            </div>
            <div style={{ marginTop: 10 }}>
              <div className="audit-kv"><span>覆盖局数 / 30</span><b>{l0.games} / 30</b></div>
              <div className="audit-kv"><span>有效口径 / 200</span><b>{l0.records_valid} / 200</b></div>
            </div>
            <div className="audit-static-line" data-testid="audit-gate-copy">
              <p className="audit-card-note" style={{ marginBottom: 4 }}>口径</p>
              <p style={{ margin: 0, fontSize: 13 }}>{l0.gate}</p>
              <p className="audit-card-note" style={{ marginTop: 6, marginBottom: 0 }}>
                门禁未解锁期间，本页一切数字只配「参考」；「评」（准确率/校准读数出具）要等门禁解锁——
                在此之前本页只记不评。
              </p>
            </div>
          </div>

          {/* ② 分层校准汇总区（静态两行 + 恒挂探索性标注） */}
          <div className="audit-card" data-testid="audit-calib-card">
            <h3 className="audit-card-title">分层校准汇总</h3>
            <p className="audit-card-note">实验读数区（静态）：与左侧账本数字无关，不得互为宣称。</p>
            <div className="audit-static-line" data-testid="audit-ra-line">
              <span className="audit-static-tag">R-A</span>{STATIC_CALIB.raLine}
            </div>
            <div className="audit-static-line" data-testid="audit-rb-line">
              <span className="audit-static-tag">R-B</span>{STATIC_CALIB.rbLine}
            </div>
            <span className="audit-exploratory" data-testid="audit-exploratory">{STATIC_CALIB.badge}</span>
            <p className="audit-card-note" style={{ marginTop: 8, marginBottom: 0 }}>{STATIC_CALIB.note}</p>
          </div>

          {/* ⑤ 待解前瞻卡（真值未发生的前瞻批次；事件日升序，UI 只标到期日不宣称结果） */}
          <div className="audit-card" data-testid="audit-forward-card">
            <h3 className="audit-card-title">待解前瞻</h3>
            <p className="audit-card-note">
              前瞻批次 · 真值未发生：以下为未回填真值的记录（事件日升序；显示前 {summary.pending_forward.length} 条 / 共 {summary.pending_forward_total} 条）。
              落注概率与到期日仅作「参考」——真值到达前不可结算、不作任何命中/准确率宣称。
            </p>
            <table className="audit-table" data-testid="audit-forward-table">
              <thead>
                <tr><th>题面</th><th>层</th><th className="audit-num">落注概率</th><th>到期日</th></tr>
              </thead>
              <tbody>
                {summary.pending_forward.map((r) => (
                  <tr key={r.id} data-testid={'audit-forward-' + r.id}>
                    <td className="audit-forward-stmt" title={r.statement}>{r.target || r.statement}</td>
                    <td>{r.layer ?? <span className="audit-mut">未分层</span>}</td>
                    <td className="audit-num">{pct(r.assigned_prob)}</td>
                    <td>{dueOf(r)}</td>
                  </tr>
                ))}
                {summary.pending_forward.length === 0 && (
                  <tr><td colSpan={4} className="audit-mut">暂无待解前瞻记录</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ⑥ 分层校准卡（账本计数 + 机械算术；样本不足留空，禁编造） */}
          <div className="audit-card" data-testid="audit-layer-calib-card">
            <h3 className="audit-card-title">分层校准（账本）</h3>
            <p className="audit-card-note">
              分层账本 × 校准参考（只记不评，机械算术）。{CALIB_LEGEND}
            </p>
            <table className="audit-table" data-testid="audit-layer-calib-table">
              <thead>
                <tr>
                  <th>层</th>
                  <th className="audit-num">n</th>
                  <th className="audit-num">resolved</th>
                  <th className="audit-num">校准参考</th>
                  <th>基率</th>
                </tr>
              </thead>
              <tbody>
                {summary.layer_calibration.map((r, i) => (
                  <tr key={i} data-testid={'audit-calib-' + (r.layer ?? 'null')}>
                    <td>{r.layer ?? <span className="audit-mut">未分层</span>}</td>
                    <td className="audit-num">{r.n}</td>
                    <td className="audit-num">{r.resolved}</td>
                    <td className="audit-num">{tri(r.brier)}</td>
                    <td>{baseRate(r)}</td>
                  </tr>
                ))}
                {summary.layer_calibration.length === 0 && (
                  <tr><td colSpan={5} className="audit-mut">账本暂无记录</td></tr>
                )}
              </tbody>
            </table>
            <p className="audit-card-note" style={{ marginTop: 8, marginBottom: 0 }}>
              校准参考为已有真值题上的机械算术（零模型），仅作「审计参考」；样本不足时留空。
            </p>
          </div>

          {/* ③ 六层分类说明卡 */}
          <div className="audit-card" data-testid="audit-layers-card">
            <h3 className="audit-card-title">六层分类说明</h3>
            <p className="audit-card-note">词表照《万物分类清单 v2》（checklist_hash=v2 冻结 2026-09-12）：按序判定，首个全绿层即归属层。</p>
            {LAYER_CARDS.map((l) => (
              <div className="audit-layer-row" key={l.id} data-testid={'audit-layer-' + l.id}>
                <span className="audit-layer-id">{l.id}</span>
                <div className="audit-layer-body">
                  <div className="audit-layer-name">{l.name}</div>
                  <p className="audit-layer-brief">{l.brief}</p>
                  <p className="audit-layer-engine">引擎姿态：{l.engine} ｜ 模型角色：{l.llm}</p>
                </div>
              </div>
            ))}
          </div>
          </div>
        </details>
      )}

      {summary && (
        <p className="audit-sub" style={{ marginTop: 10 }} data-testid="audit-generated-at">
          账本快照：{summary.generated_at} ｜ {summary.note}
        </p>
      )}
    </section>
  );
}

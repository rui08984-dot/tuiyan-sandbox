/**
 * AuditPage —— 万物审计仪表盘（#/audit；G1 反馈 #3 · M2）。
 *
 * 数据源：GET /api/audit/summary（纯 SQL 只读聚合，零 LLM 零网络零评分——后端铁律同源）。
 * 四块：①账本分层卡（layer×checklist_hash 计数表 + l0Gate 双口径 + gate 分布）
 *      ②分层校准汇总区（静态两行：R-A 读数门 / R-B 信息价值，恒挂「探索性 · 判据=PREREG 冻结件」）
 *      ③六层分类说明卡（L1-L6 一句话定义 + 引擎姿态，词表照 docs/specs/万物分类清单-v2.md）
 *      ④门禁状态卡（review_unlocked + 「只记不评」文案）。
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
import type { AuditSummary } from '../../types';
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

      {summary && l0 && (
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
      )}

      {summary && (
        <p className="audit-sub" style={{ marginTop: 10 }} data-testid="audit-generated-at">
          账本快照：{summary.generated_at} ｜ {summary.note}
        </p>
      )}
    </section>
  );
}

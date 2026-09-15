/**
 * MysticPage —— 独立玄学排盘页（P9 W2 #/mystic；G1 反馈#1 增补 interpret 断语区）：
 *  · 三法起卦表单：数字两输入 / 时间一键「起当前卦」（不传 date = 服务器当前时刻）/ 随机一键；
 *  · 卦象大展示：本/互/变六爻图（yao 自下而上，渲染自上而下）+ 动爻体用五行条 + 起卦留档；
 *  · 断语区（G1 反馈#1）：出卦后自动 POST /api/oracle/interpret 一次，在页面恒挂「娱乐参考」
 *    横幅下展示断语（mode=live 显 LLM 断语 ≤120 字；mock/mock_fallback 显本地模板并如实标注；
 *    断语服务不可达时用前端静态白话兜底：卦名+体用五行+动爻一句话，零 LLM 零网络）；
 *  · 历史排盘列表（GET /api/oracle/readings 分页，新→旧）+ 回看抽屉（verdict 已落位则显示）；
 *  · 拍板铁律（写死）：页面级恒挂「娱乐参考 · 非游戏研判」横幅，绝不接入任何游戏研判功能；
 *    断语=娱乐参考推断层，本组件禁止被参谋/研判类页面引用。
 * 数据源：POST /api/oracle/cast（201）+ POST /api/oracle/interpret（201）+ GET /api/oracle/readings（分页）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { castOracle, interpretOracle, listOracleReadings } from '../../api';
import { IconCompass } from '../../components/ui';
import type { MysticCasting, OracleCastResult, OracleGua, OracleReading } from '../../types';
import '../../styles/mystic.css';

const METHOD_LABEL: Record<OracleReading['method'], string> = {
  numbers: '数字起卦',
  time: '时间起卦',
  random: '随机起卦',
};
const PAGE_SIZE = 20;

/** 断语区视图状态（G1 反馈#1）：loading / 已得断语（llm=LLM 断语、template=本地模板、static=前端白话兜底） */
type InterpView =
  | { loading: true }
  | { loading: false; text: string; source: 'llm' | 'template' | 'static'; note?: string };

/** 纯前端兜底静态白话（零 LLM 零网络）：断语服务不可达时的确定性展示口径 */
function staticFallback(c: MysticCasting): string {
  return '本卦「' + c.benGua.fullName + '」，动第' + c.dongYao + '爻：体' + c.ti.trigram + '（' + c.ti.wuXing
    + '）、用' + c.yong.trigram + '（' + c.yong.wuXing + '），' + c.tiYongRelation
    + '。卦理白话仅供参考——娱乐参考，非游戏研判。';
}

/** 单卦六爻图：yao[6] 自下而上（1=阳 0=阴），渲染自上而下（上爻在顶）；动爻高亮标「动/变」 */
function YaoStack({ gua, dongYao, dongTag }: { gua: OracleGua; dongYao?: number; dongTag?: string }) {
  const rows: { yang: boolean; pos: number }[] = [];
  if (gua.yao && gua.yao.length === 6) {
    gua.yao.forEach((v, i) => rows.push({ yang: v === 1, pos: i + 1 }));
  } else if (gua.yinYang && gua.yinYang.length === 6) {
    gua.yinYang.forEach((s, i) => rows.push({ yang: s === '阳', pos: i + 1 }));
  }
  if (!rows.length) return <div className="mystic-yao-empty">爻图缺档</div>;
  return (
    <div className="mystic-yao-stack" aria-hidden="true">
      {[...rows].reverse().map((r) => (
        <div key={r.pos} className={'mystic-yao' + (r.yang ? ' is-yang' : ' is-yin') + (dongYao === r.pos ? ' is-dong' : '')}>
          <span className="mystic-yao-bar" />
          {!r.yang && <span className="mystic-yao-bar" />}
          {dongYao === r.pos && dongTag && <span className="mystic-yao-tag">{dongTag}</span>}
        </div>
      ))}
    </div>
  );
}

/** 单卦卡：爻图 + 卦名 + 上下卦 */
function GuaCard({ label, gua, dongYao, dongTag }: { label: string; gua: OracleGua; dongYao?: number; dongTag?: string }) {
  return (
    <div className="mystic-gua-card">
      <div className="mystic-gua-label">{label}</div>
      <YaoStack gua={gua} dongYao={dongYao} dongTag={dongTag} />
      <div className="mystic-gua-name">{gua.fullName}</div>
      <div className="mystic-gua-sub">{gua.upper}上{gua.lower}下</div>
    </div>
  );
}

/** 起卦留档一行：起卦数 + time 法农历分量（防御式渲染，缺档静默略过） */
function DerivedFromNote({ c }: { c: MysticCasting }) {
  const d = c.derived_from;
  const parts: string[] = [];
  if (c.numbers) parts.push('起卦数 ' + c.numbers.a + '/' + c.numbers.b);
  if (d) {
    if (d.lunar_month != null && d.lunar_day != null) {
      const leap = d.leap_month || (d.lunar_month as number) < 0;
      const m = Math.abs(d.lunar_month as number);
      parts.push('农历' + (leap ? '闰' : '') + m + '月' + d.lunar_day + '日'
        + (d.year_zhi ? '·' + d.year_zhi + '年' : '')
        + (d.hour_zhi ? '·' + d.hour_zhi + '时' : ''));
    } else if (d.source) {
      parts.push(d.source);
    }
  }
  if (!parts.length) return null;
  return <div className="mystic-derived">起卦留档：{parts.join(' · ')}</div>;
}

/** 卦象大展示：排盘结果与回看抽屉共用同一视图 */
function CastingView({ c }: { c: MysticCasting }) {
  return (
    <div className="mystic-casting">
      <div className="mystic-gua-grid">
        <GuaCard label="本卦" gua={c.benGua} dongYao={c.dongYao} dongTag="动" />
        <GuaCard label="互卦" gua={c.huGua} />
        <GuaCard label="变卦" gua={c.bianGua} dongYao={c.dongYao} dongTag="变" />
      </div>
      <div className="mystic-tiyong">
        动爻第 {c.dongYao} 爻 · 体 {c.ti.trigram}（{c.ti.wuXing}·{c.ti.position}）
        · 用 {c.yong.trigram}（{c.yong.wuXing}·{c.yong.position}）· {c.tiYongRelation}
      </div>
      <DerivedFromNote c={c} />
    </div>
  );
}

export default function MysticPage() {
  const [method, setMethod] = useState<OracleReading['method']>('numbers');
  const [n1, setN1] = useState('');
  const [n2, setN2] = useState('');
  const [busy, setBusy] = useState(false);
  const [castErr, setCastErr] = useState<string | null>(null);
  const [result, setResult] = useState<OracleCastResult | null>(null);
  const [interp, setInterp] = useState<InterpView | null>(null);
  const interpSeq = useRef(0); // 防串台：连续起卦时只认最后一次断语响应

  const [readings, setReadings] = useState<OracleReading[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [listErr, setListErr] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<OracleReading | null>(null);

  const refresh = useCallback(async (p: number) => {
    setListLoading(true);
    setListErr(null);
    try {
      const r = await listOracleReadings({ limit: PAGE_SIZE, offset: p * PAGE_SIZE });
      setReadings(r.items);
      setTotal(r.total);
    } catch (e) {
      setListErr(e instanceof Error ? e.message : String(e));
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(0); }, [refresh]);

  async function cast() {
    setBusy(true);
    setCastErr(null);
    try {
      let r: OracleCastResult;
      if (method === 'numbers') {
        const a = Number(n1);
        const b = Number(n2);
        if (!Number.isInteger(a) || a < 1 || a > 999999 || !Number.isInteger(b) || b < 1 || b > 999999) {
          throw new Error('请输入 1–999999 的正整数两枚');
        }
        r = await castOracle('numbers', { n1: a, n2: b });
      } else if (method === 'time') {
        r = await castOracle('time'); // 不传 date = 服务器当前时刻
      } else {
        r = await castOracle('random');
      }
      setResult(r);
      setPage(0);
      void refresh(0);
      void interpret(r.id, r.casting); // G1 反馈#1：出卦后自动 interpret 一次
    } catch (e) {
      setCastErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** 断语自动获取（G1 反馈#1）：interpret 端点 → mode 三态展示；端点不可达 → 前端静态白话兜底 */
  async function interpret(id: number, c: MysticCasting) {
    const seq = ++interpSeq.current;
    setInterp({ loading: true });
    try {
      const r = await interpretOracle(id);
      if (seq !== interpSeq.current) return; // 已有更新一次起卦，丢弃旧响应
      if (r.mode === 'live') {
        setInterp({ loading: false, text: r.verdict, source: 'llm' });
      } else {
        setInterp({
          loading: false, text: r.verdict, source: 'template',
          note: (r.mode === 'mock_fallback' && r.llm_error)
            ? 'LLM 断语暂不可用（' + r.llm_error + '）——已显示本地模板'
            : '当前为本地模板断语——未接 LLM',
        });
      }
      void refresh(0); // 同步历史列表该条 verdict 落位
    } catch (e) {
      if (seq !== interpSeq.current) return;
      setInterp({
        loading: false, text: staticFallback(c), source: 'static',
        note: '断语服务不可达（' + (e instanceof Error ? e.message : String(e)) + '）——静态白话兜底',
      });
    }
  }

  function goPage(p: number) {
    setPage(p);
    void refresh(p);
  }

  const numberReady = /^\d+$/.test(n1) && /^\d+$/.test(n2)
    && Number(n1) >= 1 && Number(n1) <= 999999 && Number(n2) >= 1 && Number(n2) <= 999999;
  const pageFrom = readings && readings.length ? page * PAGE_SIZE + 1 : 0;
  const pageTo = readings ? Math.min((page + 1) * PAGE_SIZE, total) : 0;

  return (
    <div className="mystic-page">
      {/* 恒挂横幅（铁律）：页面级始终可见，不随排盘状态消失 */}
      <div className="mystic-banner" role="note">娱乐参考 · 非游戏研判</div>

      <header className="mystic-head">
        <h2><IconCompass size={18} /> 梅花易数排盘</h2>
        <p className="mystic-sub">排盘=纯数学 · 断语=娱乐参考推断层（出卦自动请求一次，服务不可达时静态白话兜底）· 不接任何游戏研判</p>
      </header>

      <section className="mystic-form-panel" aria-label="起卦">
        <div className="mystic-method-tabs" role="tablist" aria-label="起卦方法">
          {(['numbers', 'time', 'random'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={method === m}
              className={'mystic-method-tab' + (method === m ? ' is-active' : '')}
              onClick={() => setMethod(m)}>
              {METHOD_LABEL[m]}
            </button>
          ))}
        </div>
        {method === 'numbers' && (
          <div className="mystic-numbers-row">
            <input className="mystic-input" inputMode="numeric" value={n1}
              onChange={(e) => setN1(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="上卦数（1–999999）" aria-label="起卦数一" />
            <input className="mystic-input" inputMode="numeric" value={n2}
              onChange={(e) => setN2(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="下卦数（1–999999）" aria-label="起卦数二" />
            <button type="button" className="btn btn-primary mystic-cast-btn" disabled={busy || !numberReady} onClick={() => { void cast(); }}>
              起卦
            </button>
          </div>
        )}
        {method === 'time' && (
          <>
            <button type="button" className="btn btn-primary mystic-cast-btn" disabled={busy} onClick={() => { void cast(); }}>
              起当前卦
            </button>
            <p className="mystic-form-hint">按服务器当前时刻起卦（通行本「年月日时起例」）。</p>
          </>
        )}
        {method === 'random' && (
          <>
            <button type="button" className="btn btn-primary mystic-cast-btn" disabled={busy} onClick={() => { void cast(); }}>
              随机起卦
            </button>
            <p className="mystic-form-hint">两数各取 1–512 均匀随机（CSPRNG），同一条卦理管线。</p>
          </>
        )}
        {busy && <p className="mystic-form-hint">起卦中……</p>}
      </section>
      {castErr && <div className="sheet-error mystic-err" role="alert">{castErr}</div>}

      {result && (
        <section className="mystic-result-panel" aria-label="最新排盘">
          <div className="mystic-result-title">最新排盘 #{result.id} · {METHOD_LABEL[result.method]}</div>
          <CastingView c={result.casting} />
          {/* 断语区（G1 反馈#1）：恒挂页面级「娱乐参考」横幅之下，head 自带口径标注 */}
          <div className="mystic-verdict" data-testid="mystic-verdict">
            <div className="mystic-verdict-head">断语 · 娱乐参考（非游戏研判）</div>
            {interp?.loading && <p className="mystic-form-hint">断语生成中……</p>}
            {interp && !interp.loading && (
              <>
                <p className="mystic-verdict-text">{interp.text}</p>
                {interp.note && <p className="mystic-verdict-note">{interp.note}</p>}
              </>
            )}
            {!interp && <p className="mystic-form-hint">（断语待生成）</p>}
          </div>
        </section>
      )}

      <section className="mystic-history-panel" aria-label="历史排盘">
        <div className="mystic-history-head">
          <h3>历史排盘</h3>
          <span className="mystic-history-meta">共 {total} 条</span>
        </div>
        {listErr && <div className="sheet-error" role="alert">{listErr}</div>}
        {listLoading && <p className="mystic-form-hint">加载中……</p>}
        {readings && readings.length === 0 && <p className="mystic-empty">暂无排盘记录——先起一卦吧。</p>}
        {readings && readings.length > 0 && (
          <ul className="mystic-history-list">
            {readings.map((r) => (
              <li key={r.id}>
                <button type="button" className="mystic-history-item" onClick={() => setDrawer(r)}>
                  <span className="mystic-history-gua">#{r.id} · {r.casting.benGua.fullName} · 动第{r.casting.dongYao}爻</span>
                  <span className="mystic-history-meta">{METHOD_LABEL[r.method]} · {r.created_at} UTC{r.game_id != null ? ' · 局#' + r.game_id : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mystic-pager">
          <button type="button" className="btn" disabled={page === 0 || listLoading} onClick={() => goPage(page - 1)}>← 上一页</button>
          <span className="mystic-pager-info">{pageFrom ? pageFrom + '–' + pageTo : '—'}</span>
          <button type="button" className="btn" disabled={!readings || (page + 1) * PAGE_SIZE >= total || listLoading} onClick={() => goPage(page + 1)}>下一页 →</button>
        </div>
      </section>

      {drawer && (
        <div className="mystic-overlay" role="dialog" aria-modal="true" aria-label="排盘回看">
          <div className="mystic-drawer">
            <div className="mystic-drawer-head">
              <h2><IconCompass size={18} /> 回看 #{drawer.id}</h2>
              <button type="button" className="btn btn-ghost" onClick={() => setDrawer(null)} aria-label="关闭">✕</button>
            </div>
            <p className="mystic-drawer-meta">{METHOD_LABEL[drawer.method]} · {drawer.created_at} UTC{drawer.game_id != null ? ' · 局#' + drawer.game_id : ''}</p>
            <CastingView c={drawer.casting} />
            <p className="mystic-verdict-note">{drawer.verdict ?? '（该排盘未生成断语——最新排盘会自动请求「娱乐参考」断语）'}</p>
            <div className="mystic-drawer-foot">
              <button type="button" className="btn btn-primary" onClick={() => setDrawer(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

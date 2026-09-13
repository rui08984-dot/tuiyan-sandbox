/**
 * OracleZone —— 对局玄学化判词（P2 线 W2，赛后娱乐彩蛋弹层）：
 *  · 现场页常驻小入口「判词」手动开；
 *  · 天结算就绪（advise.current source='task'，即 .adv-badge.is-ready 出现的同一信号）
 *    后自动弹一次：localStorage key 含 game id（p1b.oracle.seen.v1.<gid>，值=已弹 day）防重弹；
 *  · z-index 45：低于确认卡（.confirm-overlay 60）与宏表单/编辑抽屉（.sheet-overlay 50），
 *    不遮挡既有页面元素定位（B6 S 系列选择器零破坏——本组件为独立新增行/弹层）；
 *  · 拍板③（写死）：恒显「娱乐参考 · 非游戏研判」标注——纯娱乐彩蛋，绝不接入游戏研判，
 *    本组件禁止被参谋/研判类组件引用。
 * 数据源：GET /api/games/:id/oracle（排盘=纯数学确定性派生，断语=LLM）。
 */
import { useEffect, useState } from 'react';
import { getOracle } from '../../api';
import type { OracleResult } from '../../types';
import type { useAdvise } from './useAdvise';
import '../../styles/oracle.css';
import { IconCompass, IconClose } from '../../components/ui';

type Advise = ReturnType<typeof useAdvise>;

/** localStorage 防重弹：key 含 game id（任务书拍板），值 = 已自动弹过的最大 day */
const seenKey = (gid: number) => 'p1b.oracle.seen.v1.' + gid;
function seenDay(gid: number): number {
  try {
    const n = Number(localStorage.getItem(seenKey(gid)));
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch { return 0; }
}

export default function OracleZone(props: { gameId: number; advise: Advise }) {
  const a = props.advise;
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<OracleResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      setData(await getOracle(props.gameId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function openCard() {
    setOpen(true);
    void load();
  }

  // 天结算就绪自动弹一次：仅 task 就绪（source='task'）且本局该天未弹过；手动入口不受此限
  const ready = a.current && a.current.source === 'task' && a.current.gameId === props.gameId ? a.current : null;
  useEffect(() => {
    if (!ready) return;
    if (seenDay(props.gameId) >= ready.day) return; // 已弹过该天 → 不再自动弹（防重弹）
    try { localStorage.setItem(seenKey(props.gameId), String(ready.day)); } catch { /* 写失败仍允许看一次 */ }
    openCard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready?.gameId, ready?.day]);

  return (
    <>
      <div className="oracle-entry-row">
        <button type="button" className="btn oracle-entry" onClick={openCard}
          title="本局玄学判词（赛后娱乐彩蛋）"><IconCompass size={16} /> 判词</button>
        <span className="oracle-entry-hint">赛后娱乐彩蛋 · 非游戏研判</span>
      </div>
      {open && (
        <div className="oracle-overlay" role="dialog" aria-modal="true" aria-label="本局玄学判词">
          <div className="oracle-card">
            <div className="oracle-head">
              <h2><IconCompass size={18} /> 本局玄学判词</h2>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} aria-label="关闭"><IconClose size={16} /></button>
            </div>
            {loading && <p className="muted oracle-loading">起卦中……</p>}
            {err && <div className="sheet-error">{err}</div>}
            {data && !loading && (
              <>
                <div className="oracle-gua">
                  <div className="oracle-gua-row">
                    <span className="oracle-gua-label">本卦</span>
                    <strong>{data.casting.benGua.fullName}</strong>
                    <span className="oracle-gua-sub">{data.casting.benGua.upper}上{data.casting.benGua.lower}下 · 起卦数 {data.casting.numbers.a}/{data.casting.numbers.b}</span>
                  </div>
                  <div className="oracle-gua-row">
                    <span className="oracle-gua-label">互卦</span>
                    <span>{data.casting.huGua.fullName}</span>
                  </div>
                  <div className="oracle-gua-row">
                    <span className="oracle-gua-label">变卦</span>
                    <span>{data.casting.bianGua.fullName}</span>
                  </div>
                </div>
                <div className="oracle-tiyong">
                  动爻第 {data.casting.dongYao} 爻 · 体 {data.casting.ti.trigram}（{data.casting.ti.wuXing}）· 用 {data.casting.yong.trigram}（{data.casting.yong.wuXing}）· {data.casting.tiYongRelation}
                </div>
                <p className="oracle-verdict">{data.verdict}</p>
                <div className="oracle-disclaimer">{data.disclaimer} · 非游戏研判</div>
                {data.mode === 'mock_fallback' && data.llm_error && (
                  <p className="oracle-llmerr">（LLM 断语暂不可用：{data.llm_error}——已显示本地模板）</p>
                )}
                <div className="oracle-foot">
                  <a className="btn oracle-mystic-link" href="#/mystic" title="独立排盘页（三法起卦+历史档案）">进入排盘 →</a>
                  <button type="button" className="btn btn-primary" onClick={() => setOpen(false)}>关闭</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

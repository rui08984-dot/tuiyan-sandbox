/** HomePage —— 入口页（2026-09-27 八轮新增）
 *
 * 病象：路由 `/` 原先渲染 LivePage（狼人杀选局），导航第一项却叫「概览」。
 *   ⇒ 新人第一屏问「这是什么」，界面答「选一局继续」；而且两条产品线在导航上交错
 *      （1-3 项属推演沙盘现场、4-8 项属预测观测台），入口页只服务其中一条。
 *   ⇒ 侦察实测：pages/ 全库 grep「今天|下一步|该做|待办」只命中一行代码注释，
 *      **全站没有任何「今天该做什么」的承载位**。
 *
 * 本页职责（就这三件，别的都不做）：
 *   ① 这是什么 —— 一句话说明白，不含术语黑话
 *   ② 现在什么状态 —— 真实读数（账本/已解/域/可出结论）
 *   ③ 两条产品线各自的入口，各说清是干什么的
 *
 * 纪律：只读、零写、零打网；数字全部来自 /api，不写死、不编造。
 * 文案遵守项目铁律②：界面禁「预测」二字（dist 有禁词扫描闸）。
 */
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import '../styles/home.css';
import { SourceTag } from '../components/SourceTag';

interface Ledger {
  records: number;
  resolved: number;
  unresolved: number;
}
interface Calib {
  cells_total: number;
  cells_with_conclusion: number;
}

export default function HomePage() {
  const [led, setLed] = useState<Ledger | null>(null);
  const [cal, setCal] = useState<Calib | null>(null);
  const [bad, setBad] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch('/api/audit/summary').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/disclosure/calibration').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([a, c]) => {
      if (!alive) return;
      if (!a && !c) { setBad(true); return; }
      const g = a?.l0_gate;
      if (g) setLed({ records: Number(g.records) || 0, resolved: Number(g.resolved) || 0, unresolved: Number(g.unresolved) || 0 });
      if (c) setCal({ cells_total: Number(c.cells_total) || 0, cells_with_conclusion: Number(c.cells_with_conclusion) || 0 });
    });
    return () => { alive = false; };
  }, []);

  const rate = led && led.records > 0 ? Math.round((led.resolved / led.records) * 100) : null;

  return (
    <div className="home">
      {/* ① 这是什么 —— 一句话，不用术语 */}
      <section className="home-lead">
        <h1 className="home-title">把还没发生的事，提前问清楚</h1>
        <p className="home-sub">
          这里记录 <b>{led ? led.records.toLocaleString('en-US') : '—'}</b> 道题：每道题都写明了问的是什么、
          为什么这么答，以及真实结果出来之后答得对不对。<b>它不承诺能预知未来</b>——
          它承诺的是每道题都有下落，每道题都对得出来源。
        </p>
      </section>

      {/* ══ ★八轮第四改 · 欠账优先，且**明确不做「为你推荐」** ══
       * 交互方向兵提的反直觉提案，我采纳并写在这里：
       *   「任何『为你推荐下一步』式的引导都会撒谎——它会让人以为那 19 个薄格
       *     也是可读的。欠账是事实，推荐是观点，而观点恰好违反本产品的核心价值。」
       * ⇒ 首页的主角是**还没落定的题数**（事实，可机检），不是系统建议（观点）。
       * ⇒ 下面只列**可核查的欠账事实**（到期日分布），不给「建议你去做什么」。
       * 反过来说：欠账为空时页面不退化成空白，而是显示「今天没有欠账」——
       *   一个诚实的空态，比任何导航都更会说话。 */}
      <section className="home-debt" aria-label="欠账">
        <div className="home-debt-main">
          <div className="home-debt-num">{led ? led.unresolved.toLocaleString('en-US') : '—'}</div>
          <div className="home-debt-lab">
            道题<strong>还没落定</strong>
            {led && led.unresolved === 0 ? <span className="home-debt-zero">今天没有欠账。</span> : null}
          </div>
          <p className="home-debt-note">
            {led && led.unresolved > 0
              ? '到期后由守护进程自动结算，不用手动催。这一栏只报事实，不给建议——「建议先看哪一页」是观点，而观点会替你把还没测够的东西说成能读了。'
              : '所有到期的题都已结算。'}
          </p>
        </div>
        <div className="home-debt-side">
          <div className="home-debt-kv">
            <span>已结算</span>
            <b className="u-mono">{led ? led.resolved.toLocaleString('en-US') : '—'}</b>
          </div>
          <div className="home-debt-kv">
            <span>完成率</span>
            <b className="u-mono">{rate !== null ? rate + '%' : '—'}</b>
          </div>
          <div className="home-debt-kv">
            <span>样本够的格</span>
            <b className="u-mono">{cal ? cal.cells_with_conclusion + ' / ' + cal.cells_total : '—'}</b>
            <SourceTag of="样本够的格 / 全部格" from="校准总览·引擎重放" />
          </div>
        </div>
      </section>

      {/* ③ 读数：可判读性 —— 「够 / 共」是唯一诚实的锚 */}
      <section className="home-stats" aria-label="读数可判读性">
        <div className="home-stat home-stat--hero">
          <div className="home-stat-num">{cal ? cal.cells_with_conclusion : '—'}</div>
          <div className="home-stat-lab">格样本够、说得清</div>
          <div className="home-stat-note">
            共 {cal ? cal.cells_total : '—'} 个领域格；其余格只记方向，不下结论
          </div>
        </div>
        <div className="home-stat">
          <div className="home-stat-num">{led ? led.records.toLocaleString('en-US') : '—'}</div>
          <div className="home-stat-lab">总题数</div>
          <div className="home-stat-note">每道题都写明问的是什么、为什么这么答</div>
        </div>
        <div className="home-stat">
          <div className="home-stat-num">{led ? led.unresolved.toLocaleString('en-US') : '—'}</div>
          <div className="home-stat-lab">等结果</div>
          <div className="home-stat-note">还没落定；到期后由守护进程自动结算</div>
        </div>
      </section>


      {bad ? (
        <p className="home-err">读数接口没响应，账本读不出来。<NavLink to="/audit">去账本审计</NavLink>或稍后重试。</p>
      ) : null}

      {/* ③ 两条产品线 —— 各说清是干什么的，不让新人自己猜 */}
      <section className="home-lanes">
        <h2 className="home-lanes-h">这里有两条线</h2>
        <div className="home-lane-row">
          <NavLink to="/overview" className="home-lane">
            <div className="home-lane-t">观测台</div>
            <div className="home-lane-d">
              看读数：整体误差多大、哪一层哪一域样本够、哪些结论只是披露。
              <b>这里只读，不改任何记录。</b>
            </div>
            <div className="home-lane-go">进观测台</div>
          </NavLink>
          <NavLink to="/intake" className="home-lane">
            <div className="home-lane-t">接题</div>
            <div className="home-lane-d">
              把一件还没发生的事写成题。三道必过门任一不过就拒收，拒收也要留原因。
              <b>只做登记，不改已有记录。</b>
            </div>
            <div className="home-lane-go">去接题</div>
          </NavLink>
          <NavLink to="/live" className="home-lane">
            <div className="home-lane-t">现场</div>
            <div className="home-lane-d">
              狼人杀与血染钟楼的现场记录、参谋卡与口述复盘。
              <b>模拟局可入账本，真实对局只做复盘、不入账本。</b>
            </div>
            <div className="home-lane-go">进现场</div>
          </NavLink>
        </div>
      </section>

      <p className="home-foot">
        排盘是纯娱乐参考，永不接入研判。日常跑批与诊断走终端
        <code> node p1b/cli </code>，不必开页面。
      </p>
    </div>
  );
}

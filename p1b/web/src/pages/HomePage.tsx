/** HomePage —— 入口页（2026-09-27 八轮新增）
 *
 * 病象：路由 `/` 原先渲染 LivePage（狼人杀选局），导航第一项却叫「概览」。
 *   ⇒ 新人第一屏问「这是什么」，界面答「选一局继续」；而且两条产品线在导航上交错
 *      （八轮第六改后导航已收成 5 项，入口页退出导航），入口页只服务其中一条。
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
import { Wait } from '../components/Wait';
import { ensureVisitorId } from '../lib/visitor';
import {
  EMPTY_LEAD, homeHeadline, personalState, showLedgerHero, type OwnCounts, type PersonalState,
} from '../lib/firstRun';

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
  /* ★2026-09-30 个人态（SPEC-first-run-ux）：这一页的主角是**你**的数。
     判据在 lib/firstRun.ts（纯函数，可单测）；这里只取数。
     ★分不开归属时是 'unknown' 而不是 'empty'——那个 0 的意思是「不知道你是谁」，
       不是「你没有题」（与 ResolvePage / WhereOffPage 的 fail-closed 同一纪律）。 */
  const [mine, setMine] = useState<OwnCounts | null>(null);
  const [mineResolved, setMineResolved] = useState<number | null>(null);
  const [mineStatus, setMineStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [vid, setVid] = useState<string | null>(null);

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

  /* ★取「我的题」：首访本机没有标识 ⇒ 先换一枚，换回来之前读到的 0 是假的
     （与 ResolvePage 的 vidReady 闸同一条纪律，见 lib/visitor 头注）。 */
  useEffect(() => {
    let alive = true;
    void ensureVisitorId().then((v) => {
      if (!alive) return;
      setVid(v);
      if (!v) { setMineStatus('failed'); return; }
      fetch('/api/analytics/questions?view=mine&limit=50&visitor_id=' + encodeURIComponent(v))
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!alive) return;
          if (j && j.counts) {
            setMine(j.counts as OwnCounts);
            // 已落定的条数读**账本全体口径**（auto_revealed.mine），不是这 50 行切片
            setMineResolved(typeof j.auto_revealed?.mine === 'number' ? j.auto_revealed.mine : null);
            setMineStatus('ready');
          } else setMineStatus('failed');
        })
        .catch(() => { if (alive) setMineStatus('failed'); });
    });
    return () => { alive = false; };
  }, []);

  const ps: PersonalState = personalState(mineStatus, vid, mine, mineResolved);
  const rate = led && led.records > 0 ? Math.round((led.resolved / led.records) * 100) : null;

  return (
    <div className="home">
      {/* ① 这是什么 —— 一句话，不用术语 */}
      <section className="home-lead">
        <h1 className="home-title">把还没发生的事，提前问清楚</h1>
        <p className="home-sub">
          {ps.kind === 'empty' ? EMPTY_LEAD : (
            <>
              这里记录 <b>{led ? led.records.toLocaleString('en-US') : '—'}</b> 道题：每道题都写明了问的是什么、
              为什么这么答，以及真实结果出来之后答得对不对。<b>它不承诺能预知未来</b>——
              它承诺的是每道题都有下落，每道题都对得出来源。
            </>
          )}
        </p>
      </section>

      {/* ★个人态：陌生人第一屏要看到的是他自己的数（本模块的当务之急）。
         loading 不画任何一行：六个破折号同时闪一下比空着更晃（同下面 <Wait> 的纪律）。 */}
      {ps.kind !== 'loading' ? (
        <section className="home-mine" data-testid="home-mine" data-kind={ps.kind}>
          <h2 className="home-mine-h">{homeHeadline(ps)}</h2>
          {ps.kind === 'empty' ? (
            <>
              <p className="home-mine-d">
                下面三个动作都是从零开始用的：写下一道题、到期回答一次、回来看偏差。
                账本里已有的那些题<b>一条都没删</b>，只是<b>没有一条是你的</b>——条数在上面那条归属行里。
              </p>
              {/* ★空态必须给可点的下一步：只说空、不给按钮＝把用户晾在原地。 */}
              <NavLink to="/note" className="btn btn-primary home-mine-cta" data-testid="home-first-note">
                记下第一道
              </NavLink>
            </>
          ) : null}
          {ps.kind === 'unknown' ? (
            <p className="home-mine-d">
              归属没分出来时，「你的题」只能是空的——这是「不知道」，不是「没有」。
              刷新一次通常就好了。
            </p>
          ) : null}
        </section>
      ) : null}


      {/* ══ ★八轮第四改 · 欠账优先，且**明确不做「为你推荐」** ══
       * 交互方向兵提的反直觉提案，我采纳并写在这里：
       *   「任何『为你推荐下一步』式的引导都会撒谎——它会让人以为那 19 个薄格
       *     也是可读的。欠账是事实，推荐是观点，而观点恰好违反本产品的核心价值。」
       * ⇒ 首页的主角是**还没落定的题数**（事实，可机检），不是系统建议（观点）。
       * ⇒ 下面只列**可核查的欠账事实**（到期日分布），不给「建议你去做什么」。
       * 反过来说：欠账为空时页面不退化成空白，而是显示「今天没有欠账」——
       *   一个诚实的空态，比任何导航都更会说话。
       *
       * ★2026-09-30（SPEC-first-run-ux）**这两块的大数在空态下压掉**：
       *   它们是**语料库**的数（多少道题还没落定、多少个格样本够），一个字都不属于
       *   一个刚打开的陌生人。空态时把首页大字让给它＝本模块要消灭的那件事。
       *   数据一条没少：条数由壳层那条归属常驻条报出，逐行清单在语料库视图里。
       *   判据（不是 if 拍脑袋）＝ showLedgerHero(ps)，在 lib/firstRun.ts 里可单测。 */}
      {showLedgerHero(ps) ? (
        <>
      <section className="home-debt" aria-label="欠账">
        <div className="home-debt-main">
          {/* ★T2：加载中**不留「—」占位**——六个破折号同时闪一下比空着更晃。
              加载态交给下面那条 <Wait>（它自身也有 400ms 延迟，见 Wait 组件纪律①）。 */}
          <div className="home-debt-num">{led ? led.unresolved.toLocaleString('en-US') : ''}</div>
          <Wait
            state={bad ? 'error' : led ? 'idle' : 'pending'}
            what="在读账本…"
            error="读数接口没响应，账本读不出来。"
            onRetry={bad ? () => location.reload() : undefined}
            testId="home-wait"
          />
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
        </>
      ) : (
        /* 空态替身：说清那两个大数去哪了（在哪一页、怎么看），并给一个可点的出口。
           ★不是「暂无数据」——那两个数一直都在，只是不属于他。 */
        <p className="home-mine-sub" data-testid="home-foreign">
          账本里已经有的那些题（<b>没有一条是你的</b>：批量灌入的机器题与别的使用者的题）
          仍在原地，一条都没删——它们的欠账数与样本数在
          <NavLink to="/where-off">「我在哪儿偏了」</NavLink>的「语料库」视图里，
          归属条上随时报得出条数。
        </p>
      )}


      {/* ★T2：失败态已由上面 <Wait state="error"> 承担（带重试出口），
          此处不再重复一条无出口的纯文字提示。 */}

      {/* ③ 题线三动作（八轮六/七改后）+ 现场线
       *  ★顺序按「今天该干什么」排，不按功能分类排：
       *    先答欠着的（有截止压力）→ 再写新的 → 最后才是回看偏差。
       *    把"看数"放在最后，是因为它是**回声**不是**入口**——
       *    用户不是来看数的，是来回答一道题的。 */}
      <section className="home-lanes">
        <h2 className="home-lanes-h">三个动作</h2>
        <div className="home-lane-row">
          <NavLink to="/resolve" className="home-lane">
            <div className="home-lane-t">待落定</div>
            <div className="home-lane-d">
              到期的题在这里回答真发生了还是没发生。
              <b>答了才算落定</b>——只看不动手，账本里什么都没变。
            </div>
            <div className="home-lane-go">去回答</div>
          </NavLink>
          <NavLink to="/note" className="home-lane">
            <div className="home-lane-t">记一笔</div>
            <div className="home-lane-d">
              把一件还没发生的事写下来，说清答案去哪里查。
              <b>收不了也会告诉你为什么</b>，并留痕。
            </div>
            <div className="home-lane-go">去写</div>
          </NavLink>
          <NavLink to="/where-off" className="home-lane">
            <div className="home-lane-t">我在哪儿偏了</div>
            <div className="home-lane-d">
              一道题一根线，看你在哪儿系统性说大或说小。
              <b>只读，不改任何记录。</b>
            </div>
            <div className="home-lane-go">去回看</div>
          </NavLink>
        </div>
      </section>

      {/* 现场线：与题线是两种节奏，单独一块，不混进三动作 */}
      <section className="home-lanes home-lanes--live">
        <h2 className="home-lanes-h">另一条线：现场</h2>
        <NavLink to="/live" className="home-lane-row home-lane-row--1">
          <div className="home-lane">
            <div className="home-lane-t">狼人杀与血染钟楼</div>
            <div className="home-lane-d">
              现场记录、参谋卡与口述复盘。
              <b>模拟局可入账本；真实对局只做复盘、不入账本。</b>
              现场是线下局时的密集操作，和上面三件事的节奏不一样，所以分开。
            </div>
            <div className="home-lane-go">进现场</div>
          </div>
        </NavLink>
      </section>

      <p className="home-foot">
        排盘是纯娱乐参考，永不接入研判。日常跑批与诊断走终端
        <code> node p1b/cli </code>，不必开页面。
      </p>
    </div>
  );
}

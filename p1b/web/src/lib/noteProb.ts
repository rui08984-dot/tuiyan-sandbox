/**
 * noteProb —— 记一笔页「你的判断」怎么读、怎么变成 0-1、什么时候拒（2026-09-28 · 步骤 B）
 *
 * 【病象：用户填的数哪儿也没去】
 *   「你的判断」有输入框、有 state、有结论句参与，却**从不进入任何提交**。
 *   ⇒ 记下来的每一道题都没有"当时押了多少"，账本那一列恒为"当时没给数"，
 *     而用户以为记下了自己的判断。其实只记了题面。
 *
 * 【单位：这是最容易错的一处】
 *   界面收的是 **0-100 的百分数**（占位符写的就是"填 0-100"），
 *   后端 `predictions.js:50-56 requireProb` 收的是 **[0,1] 的数值**，
 *   62 直接发过去必 400。换算在本文件里做一次，别处谁都不许再换一遍。
 *
 * 【两条纪律，各对应一种失真】
 *   ① **数只从用户来**。`assigned_prob` 记的是"人当时押多少"，
 *      不是引擎基率。两者混为一谈，账本上那一条就成了系统的读数冒充人的判断——
 *      而校准读数（Brier / 分层）全建立在"这是人当时说的"之上，
 *      一旦被基率污染，**污染是不可见的**（数字照样落在 [0,1]，只是不再有意义）。
 *   ② **没填就拒，并把为什么说清**。不许静默拿基率顶上：
 *      顶上之后那一条**看起来**样样齐全（有判断、有基率、还能量偏差），
 *      而账本里根本没有人数。空与 0 也必须分开：`null` 才是"没给"，
 *      `0` 是"我押它不发生"——两者在算术上只差一步，在诚实上差一个量级。
 *
 * 【为什么抽成纯函数】组件级测试要 jsdom / Testing Library（本项目禁新依赖），
 *   而"这个输入能不能落库、落成几、拒的理由是什么"恰恰是最该被单测的东西。
 *   组件只负责把三个输入递进来、把 why 渲染出去。
 */

/** 用户能填的范围：0-100 的百分数（下限 0 是"我押它不发生"，是合法判断，不是空值）。 */
export const PCT_MIN = 0;
export const PCT_MAX = 100;

/** 读数结果。ok=false 时 prob 恒为 null——**不返回 0**，因为 0 是一个判断。 */
export interface ProbRead {
  ok: boolean;
  /** 换算成 0-1 的数（后端 requireProb 收的形状）；未给/不合法一律 null。 */
  prob: number | null;
  /** 人话理由。非空即拒收，且必须说清为什么、边界在哪。 */
  why: string;
}

/** 提交闸的放行凭据：ok=true 时 prob 必是用户那个数换算后的值。 */
export type SubmitVerdict = { ok: true; prob: number } | { ok: false; why: string };

/**
 * 读「你的判断」输入框。
 * 拒收分三种说法，因为它们要的下一步不同：
 *   没填 → 告诉他这是必填的、为什么必填；
 *   写了但不是数 → 告诉他该写成什么样；
 *   是数但越界 → 点明区间（笼统的"格式错"会让人以为自己理解错了要求）。
 */
export function readMyProb(v: string): ProbRead {
  const s = (v === undefined || v === null ? '' : String(v)).trim();
  if (s === '') {
    return {
      ok: false,
      prob: null,
      why: '得先给出你的判断：这道题是拿来看你押得准不准的，'
        + '不填就没有"当时押了多少"，到期后也无从知道自己偏在哪儿。',
    };
  }
  // ★严格十进制：Number() 认 '0x10'/'1e2'/'Infinity'/'  '，那些都不是"人填的一个百分比"
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(s)) {
    return { ok: false, prob: null, why: '看不懂这一栏：写一个 0 到 100 之间的数就行，比如 62（表示你押六成）。' };
  }
  const n = Number(s);
  if (!Number.isFinite(n)) {
    return { ok: false, prob: null, why: '看不懂这一栏：写一个 0 到 100 之间的数就行，比如 62（表示你押六成）。' };
  }
  if (n < PCT_MIN || n > PCT_MAX) {
    return {
      ok: false,
      prob: null,
      why: '这个数不在 0 到 100 之间（收到 ' + s + '）：0 是"我押它不发生"，100 是"我押它一定发生"。',
    };
  }
  return { ok: true, prob: n / PCT_MAX, why: '' };
}

/**
 * 提交闸：题面、真值锚、你的判断，三件齐了才放行。
 * 顺序有讲究——先查"没作答"的（题面/真值锚），再查"给了但不对"的（你的判断），
 * 这样用户一次只面对**一件**没做的事，而不是一口气三条。
 */
export function submitGuard(x: { statement: string; kind: string; myProb: string }): SubmitVerdict {
  const stmt = (x.statement === undefined || x.statement === null ? '' : String(x.statement)).trim();
  if (stmt === '') return { ok: false, why: '还没写这道题在问什么。' };
  if (!(x.kind || '').trim()) return { ok: false, why: '还没选「答案去哪里查」——这一栏决定到期时有没有地方能核对。' };
  const p = readMyProb(x.myProb);
  if (!p.ok) return { ok: false, why: p.why };
  // ★放行时带的是用户那个数（0-1），不是任何引擎读数
  return { ok: true, prob: p.prob as number };
}

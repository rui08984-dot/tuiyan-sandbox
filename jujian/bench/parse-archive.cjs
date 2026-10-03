'use strict';
/**
 * 局鉴 · bench/parse-archive.cjs —— 真实对局档案解析器
 *
 * ══ 这套档案是什么 ═══════════════════════════════════════════════════════
 *   5 局真实对局，每局两层：
 *     · 公开层（replay-*.md）—— 牌桌上所有人都知道的信息，事件从 E-1 编号起
 *     · 真值层（*.truth.md）—— 真实身份，盲测时不可见，只供评分
 *   外加一份**预注册**的评分协议（防裁判偏倚）。
 *   ★这是本项目最独特的资产：多数同类产品拿不出来。
 *
 * ══ 头部屏蔽（协议 §1.2，硬约束）══════════════════════════════════════════
 *   切片组装时**必须**裁掉档案头部（元信息块 + 对局名 + 结果行 + 名单），
 *   只从「## 夜/昼」第一节开始。两个理由，都在档案里被实测过：
 *     ① 头部元信息块含人数与版型，也含**叙事标签**（「JY封神之路」「阴阳倒钩」），
 *        探针已证模型对这两个标签有背景知识 —— 轻度污染源。
 *     ② 原始头部里有「结果：狼人获胜」行，而逐日切片会把它带进**每一天**，
 *        等于每个切片都剧透终局。
 *   ⇒ `slice()` 强制执行，不提供「不屏蔽」的开关 ——
 *     一个能让评测变得更好看的开关，就等于没有预注册。
 *
 * ══ 解析失败怎么办 ═══════════════════════════════════════════════════════
 *   解析不出就**抛**，并指名道姓说哪一行没看懂。
 *   静默跳过一局会污染分母 —— 那是「看起来在评测、其实少算了几局」。
 */

const fs = require('node:fs');

/** 阶段关键字 → 存储层的 phase 枚举 */
const PHASE_ZH = { '夜': 'night', '昼': 'day', '黄昏': 'dusk' };

/**
 * 解析座位名单。
 *
 * ★实测四种写法，各局的档案格式本来就不统一：
 *   ① 行内段：lyingman ——「说明：…玩家名单（11 人，编号即座位号）：1号 死亡宣告、2号 炽天使、…」
 *      陷阱：行首还有「说明：」，按**第一个**冒号切会把整张名单切丢（只解出 10/11 人）。
 *      ⇒ 必须按**名单标题之后**的最后一个冒号切。
 *   ② 下一行：daogou / songlang ——「1号 ／ 2号 ／ …」（无 ID，只有座位号）
 *   ③ 下一行：**不带「号」**：pandakill ——「1 【昵称已打码】 ／ 2 09 ／ …」
 *   ④ 只有名字、无座位号：botc ——「Amy, Alex, …」
 *      ⇒ 这一局**解析不出座位**，如实报错，由调用方按「本 bench 覆盖不到」处理，
 *         **不猜名字到座位的映射**。
 */
function parseSeats(lines, slug) {
  const idx = lines.findIndex((l) => /玩家名单|参与者名单/.test(l));
  if (idx < 0) return [];
  const header = lines[idx];
  // 名单内容：同行最后一个冒号之后的部分 ＋ 后续非空行
  let text = '';
  const colon = Math.max(header.lastIndexOf('：'), header.lastIndexOf(':'));
  if (colon >= 0 && colon > header.indexOf('（')) text = header.slice(colon + 1);
  for (let i = idx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) break;                 // 空行即名单结束
    text += ' ' + lines[i];
  }
  const out = [];
  const seen = new Set();
  for (const seg of text.split(/[／、，,;；]/)) {
    const m = seg.trim().match(/^(\d{1,2})\s*(?:号)?\s*(\S*)/);
    if (!m) continue;
    const seat = Number(m[1]);
    if (seat < 1 || seat > 99 || seen.has(seat)) continue;
    seen.add(seat);
    out.push({ seat, name: (m[2] || '').replace(/[（(].*$/, '') || seat + '号' });
  }
  return out.sort((a, b) => a.seat - b.seat);
}

/**
 * 解析公开层。
 * @returns {{slug, title, seats: Array<{seat, name}>, sections: Array<{day, phase, events: Array<{eid,text}>}>}}
 */
function parsePublic(md, slug) {
  const lines = md.split(/\r?\n/);
  const seats = parseSeats(lines, slug);

  // ── 分节 + 事件 ──
  const sections = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^##\s*[夜昼黄昏]\s*(\d+)/);
    if (h) {
      cur = { day: Number(h[1]), phase: PHASE_ZH[h[0].replace(/^##\s*/, '').slice(0, 1)] || 'day', events: [], headerLine: i + 1 };
      sections.push(cur);
      continue;
    }
    if (!cur) continue;                        // 头部块：不进切片
    const e = lines[i].match(/^-\s*(E-\d+)\s*[:：]\s*(.*)$/);
    if (e) cur.events.push({ eid: e[1], text: e[2].trim(), line: i + 1 });
  }
  if (!sections.length) throw new Error(slug + '：一个「## 夜/昼」分节都没找到，公开层解析失败');
  if (!seats.length) {
    throw new Error(slug + '：座位名单解析不到（该档案只有玩家名字，没有座位号）。'
      + '真值评分依赖座位号，本 bench 不猜名字→座位的映射。');
  }
  return { slug, title: (lines[0] || '').replace(/^#\s*/, ''), seats, sections };
}

/**
 * 解析真值层。
 * @returns {{wolves: number[], good: number[], focus: number|null, note: string}}
 *   ★只取座位号。名字不取——名字是隐私，取座位号就够评分了。
 */
function parseTruth(md, slug) {
  const lines = md.split(/\r?\n/);
  const anchors = lines.slice(0, 40).join('\n');   // 锚点在文件开头几行内

  const wolfLine = lines.find((l) => /狼人阵营\s*=|坏人阵营\s*=/.test(l));
  if (!wolfLine) throw new Error(slug + '：真值层找不到「狼人阵营 =」锚点行');
  const goodLine = lines.find((l) => /好人阵营/.test(l));

  const seatsIn = (line) => {
    const i = line.indexOf('{');
    const j = line.lastIndexOf('}');
    const inner = i >= 0 && j > i ? line.slice(i + 1, j) : '';
    return [...inner.matchAll(/(\d+)\s*号/g)].map((m) => Number(m[1]));
  };
  const wolves = seatsIn(wolfLine);
  if (!wolves.length) {
    // BOTC 那局锚点里是名字不是座位号。**不猜**，如实报出这是「本 bench 覆盖不到的局」。
    throw new Error(slug + '：狼人锚点里没有座位号（该局锚点用名字），本 bench 不猜名字→座位的映射');
  }
  const good = goodLine ? seatsIn(goodLine) : [];

  // ★主考点那一行，四局用了两种写法：
  //   「评分主目标建议 = 11号 …」（三局）／「核心关注狼：6号 JY」（lyingman）
  //   只认一种写法就会让一局的主考点静默变成 null —— 而 null 会被读成「不需要考点」。
  const focusLine = lines.find((l) => /评分主目标建议|核心关注狼|主要关注狼/.test(l));
  const focus = focusLine ? Number((focusLine.match(/(\d+)\s*号/) || [])[1] || 0) || null : null;

  // 锚点区里那句「多少狼多少好人」当完整性自检用
  const note = (anchors.match(/（\s*\d+\s*[狼邪][^）]*）/ ) || [''])[0];
  return { wolves, good, focus, note };
}

/**
 * 按协议 §1.2 组装逐日切片：**裁掉头部，只留从「## 夜/昼」起的内容**。
 * @param {object} pub parsePublic 的结果
 * @param {number} day
 * @returns {string} 该天的全部事件（E-N 编号保留，供引用抽查）
 */
function slice(pub, day) {
  const secs = pub.sections.filter((s) => s.day === day);
  if (!secs.length) throw new Error(pub.slug + '：没有第 ' + day + ' 天的内容');
  const out = [];
  for (const s of secs) {
    out.push('## ' + (s.phase === 'night' ? '夜' : s.phase === 'dusk' ? '黄昏' : '昼') + ' ' + s.day);
    for (const e of s.events) out.push('- ' + e.eid + ': ' + stripTruthNotes(e.text, pub.slug, e.eid));
    if (!s.events.length) out.push('（无事件）');
    out.push('');
  }
  // ★这里不做任何加工：不改写、不概括、不补全。
  //   补全会让评测结果变好看，而变好看正是预注册要防的那件事。
  //   唯一的加工是下面那一条**剥离**，理由写在那里。
  return out.join('\n');
}

/**
 * ★剥离引用真相层的编者批注（实测发现的问题，不是假想）。
 *
 *   五局公开层里有 8 处形如
 *     「【注：9 号夜 2 实际验人记录与其"验了 8 号"的公开声称存在原文内部不一致，见真相层】」
 *   的批注。★这**本身就是泄露**——它没说出谁是狼，
 *   但它告诉读者「这句话是假的」。对「这句话可不可信」这个判断来说，
 *   这已经等于把真值层的结论递出去了。
 *
 *   协议 §1.2 裁头的理由正是防这类污染（叙事标签同理），
 *   所以这个剥离是协议的直接推论，不是新加的口径。
 *
 *   ★只剥**提到真相层**的批注，不动其它【注：…】：
 *   实测公开层里有正当的转录澄清（E-3「原文用词…按上下文语义为…」），
 *   那是给读者看的，不含任何真值。**一刀切会把这些也删掉，
 *   删掉等于篡改原始材料** —— 那是比污染更坏的事。
 *
 * @param {string} text 事件原文
 * @param {string} slug 用于报错
 * @param {string} eid  事件号
 */
function stripTruthNotes(text, slug, eid) {
  // 两种记法都要剥（实测两种都出现过）：
  //   【注：…见真相层】      —— 三局用它
  //   （…定性归真相层。）     —— pandakill 用圆括号
  // 只在**括号里含「真相层」时**才剥这个括号 ——
  // 这两份档案里括号用得极多（大量正当的转录澄清与票型缺失说明），
  // 一刀切会把原始材料也删掉，而删改原始材料比污染更坏。
  const out = text.replace(/【[^】]*?真相层[^】]*?】|（[^（）]*?真相层[^（）]*?）/g, '');
  return out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([，。；、])/g, '$1').trim();
}

/** 读一对档案（公开层 + 真值层） */
function loadArchive(dir, slug) {
  const pubPath = path.join(dir, slug + '.md');
  const truthPath = path.join(dir, slug + '.truth.md');
  if (!fs.existsSync(pubPath)) throw new Error('缺公开层: ' + pubPath);
  if (!fs.existsSync(truthPath)) throw new Error('缺真值层: ' + truthPath);
  return {
    slug,
    pub: parsePublic(fs.readFileSync(pubPath, 'utf8'), slug),
    truth: parseTruth(fs.readFileSync(truthPath, 'utf8'), slug),
  };
}

const path = require('node:path');

/** 列出目录下全部可解析的档案（slug，不含 .truth） */
function listArchives(dir) {
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.endsWith('.truth.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort();
}

module.exports = { parsePublic, parseTruth, slice, stripTruthNotes, loadArchive, listArchives, PHASE_ZH };
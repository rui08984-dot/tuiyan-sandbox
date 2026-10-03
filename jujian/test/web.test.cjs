'use strict';
/**
 * 局鉴 · test/web.test.cjs —— 前端守卫
 *
 * 前端没有构建步骤，所以它**没有类型检查、没有打包期报错**。
 * 一句拼错的 import 或一个写错的端点，只会在浏览器控制台里报错。
 * ⇒ 这个文件就是那层检查。
 *
 * 守三件要紧的事：
 *   ① 文件齐全 ＋ 语法合法（能真的 import 进来，不只是文本看起来对）
 *   ② **前端调的每个端点在服务端真实存在**（这层最容易悄悄漂）
 *   ③ ★产品纪律进了界面：矛盾四段、无辜解释、免责定位句、空态措辞
 *     —— 这些写在 CSS/视图里，改版时最容易悄悄被删掉，而它们是产品的根
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const read = (rel) => fs.readFileSync(path.join(WEB, rel), 'utf8');

/** 剥掉 JS 注释。查禁词前必须先剥 ——
 *  文件里常有「本工具不做 X，因为……」这类说明性注释，
 *  它们是文档不是功能，连它一起禁会逼人删掉必要的说明。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('① 前端文件齐全', () => {
  for (const f of ['index.html', 'app.css', 'app.js', 'api.js',
    'views/games.js', 'views/record.js', 'views/review.js', 'views/about.js']) {
    assert.ok(fs.existsSync(path.join(WEB, f)), '缺前端文件 ' + f);
  }
});

test('★② 每个 JS 文件都能真的 import（不是「看着像」合法）', async () => {
  // ★用真 import 而不是 new Function：ESM 的语法错（import/export 位置、
  //   未顶层 await）只有解析器才认得出来，正则看不见。
  const files = ['api.js', 'views/games.js', 'views/record.js', 'views/review.js', 'views/about.js'];
  for (const f of files) {
    const src = read(f);
    // 用 data: URL 做真解析，但把相对 import 剥掉（浏览器里才解析得到）
    const stripped = src.replace(/^\s*import\s+[^;]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
      .replace(/^\s*export\s+\{[^}]*\};?\s*$/gm, '');
    const url = 'data:text/javascript;base64,' + Buffer.from(stripped, 'utf8').toString('base64');
    await assert.doesNotReject(import(url), f + ' 语法不合法（浏览器会直接拒绝加载它）');
  }
});

/** 把 Fastify 的路由树展平成完整路径列表。
 *  ★不能靠 printRoutes 的原文字符串去 includes ——
 *   注册了显式的 '/' 之后，整棵树会以 / 为根，
 *   路径变成相对形式（"api/games" 而不是 "/api/games"），子串匹配会全部落空。 */
function registeredPaths(app) {
  const out = [];
  const stack = [];
  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const m = line.match(/^([│ ]*)[├└]── (\S+)/);
    if (!m) continue;
    stack.length = m[1].length / 4;
    // ★树里的段本身已带前导斜杠（"api/health"），直接 join 会得到 '//api/health'。
    //   先剥掉首尾斜杠再拼 —— 这也是我第一版的错。
    stack.push(m[2].replace(/ \(.*\)$/, '').replace(/^\/+|\/+$/g, ''));
    out.push('/' + stack.filter(Boolean).join('/'));
  }
  return out;
}

test('★③ 前端调的每个端点在服务端真实存在', async () => {
  const apiSrc = read('api.js');
  // 抽出所有 '/api/...' 形态的路径，把 ${...} 归一为 :param
  const paths = new Set();
  for (const m of apiSrc.matchAll(/(['`])(\/api\/[^'`]*?)\1/g)) {
    paths.add(m[2].replace(/\$\{[^}]+\}/g, ':param').replace(/\?.*$/, ''));
  }
  assert.ok(paths.size >= 8, '端点抽取只抓到 ' + paths.size + ' 条，正则可能失效了');

  const server = require('../src/server');
  const app = await server.build({ dbPath: ':memory:', llmMock: true });
  const registered = new Set(registeredPaths(app).map((p) => p.replace(/:[A-Za-z]+/g, ':param')));
  try {
    for (const p of paths) {
      // ★比**模式**不比具体路径：注册表里是 /api/games/:param，
      //   我却拿 /api/games/1 去比 —— 那是第一版的错，比的东西压根不在一个量纲上。
      assert.ok(registered.has(p),
        '★前端调了服务端没有的端点：' + p
        + '\n  前端改了端点而服务端没跟上，或反之。两者必须一起改。'
        + '\n  已注册的有：\n    ' + [...registered].filter((x) => x.startsWith('/api')).sort().join('\n    '));
    }
  } finally {
    await app.close();
  }
});

test('★④ 静态托管：四个视图与三份资源都能取到，且类型正确', async () => {
  const server = require('../src/server');
  const app = await server.build({ dbPath: ':memory:', llmMock: true });
  try {
    const want = {
      '/': 'text/html', '/app.css': 'text/css', '/app.js': 'text/javascript',
      '/api.js': 'text/javascript', '/views/games.js': 'text/javascript',
      '/views/record.js': 'text/javascript', '/views/review.js': 'text/javascript',
      '/views/about.js': 'text/javascript',
    };
    for (const [url, type] of Object.entries(want)) {
      const r = await app.inject({ method: 'GET', url });
      assert.equal(r.statusCode, 200, url + ' 取不到');
      assert.match(r.headers['content-type'], new RegExp(type), url + ' 的 content-type 不对');
      assert.ok(String(r.body).length > 200, url + ' 内容过短');
    }
  } finally { await app.close(); }
});

test('★⑤ 目录穿越必须被拒（三种写法都要挡住）', async () => {
  const server = require('../src/server');
  const app = await server.build({ dbPath: ':memory:', llmMock: true });
  try {
    for (const url of ['/../package.json', '/%2e%2e/package.json',
      '/views/../../package.json', '/../src/server.js', '/nonexistent.js']) {
      const r = await app.inject({ method: 'GET', url });
      assert.ok(r.statusCode === 403 || r.statusCode === 404,
        url + ' 返回了 ' + r.statusCode + ' —— 不该被放行');
      assert.doesNotMatch(String(r.body), /"name":\s*"jujian"/,
        '★' + url + ' 把 web/ 之外的文件内容漏出去了');
    }
  } finally { await app.close(); }
});

test('★⑥ API 路由不受静态托管抢走', async () => {
  const server = require('../src/server');
  const app = await server.build({ dbPath: ':memory:', llmMock: true });
  try {
    // 这三条若被通配 '/*' 吃掉，返回的会是 HTML 而不是 JSON
    for (const url of ['/api/health', '/api/games', '/api/adapters']) {
      const r = await app.inject({ method: 'GET', url });
      assert.equal(r.statusCode, 200, url);
      assert.match(r.headers['content-type'], /application\/json/, url + ' 被静态托管抢走了');
    }
    // 未知 API 路径应回 JSON 404，而不是 HTML
    const nf = await app.inject({ method: 'GET', url: '/api/nope' });
    assert.equal(nf.statusCode, 404);
    assert.match(nf.headers['content-type'], /application\/json/);
  } finally { await app.close(); }
});

// ── 产品纪律进了界面 ─────────────────────────────────────────────────────

test('★⑦ 矛盾必须渲染成四段：描述/欠定度/无辜解释/回查', () => {
  const src = read('views/review.js');
  for (const [needle, why] of [
    ['clash-desc', '冲突描述'],
    ['欠定', '欠定度'],
    ['innocent', '无辜解释（★这是产品的地基，不许删）'],
    ['回查原文', '原文回查入口'],
    ['underdetermination', '欠定度字段'],
    ['innocent_explanations', '无辜解释字段'],
  ]) {
    assert.ok(src.includes(needle), '★复盘台缺了「' + why + '」这一段：' + needle);
  }
});

test('★⑧ 复盘台不得出现嫌疑排序（那是被实测证伪过的承诺）', () => {
  // ★只查复盘台、不查关于页，且**先剥注释再查**。
  //   两处都有原因：
  //   · 复盘台的代码里那段注释**正是在**说明它不做嫌疑排序；
  //     连注释一起禁掉，等于逼它删掉自己不做某件事的理由。
  //   · 关于页**必须**向用户解释「为什么不提供嫌疑排序」——
  //     隐瞒限制比限制本身更糟。
  const console_ = stripComments(read('views/review.js'));
  for (const banned of [/嫌疑排序/, /狼人排序/, /最可能(是狼|是凶手)/, /狼人榜/]) {
    assert.doesNotMatch(console_, banned, '复盘台出现了被证伪过的承诺');
  }
  // 关于页要**正面**写出它为什么不做
  const about = read('views/about.js');
  assert.match(about, /嫌疑排序/, '关于页应当说明为什么不提供嫌疑排序 —— 隐瞒限制比限制本身更糟');
  assert.match(about, /没被证明|证伪/, '关于页要给出那个限制的依据（实测结论），不是空口拒绝');
});

test('★⑨ 空态措辞不许被简化成「没有矛盾」', () => {
  const src = read('views/review.js');
  // 必须有那句自我纠正：空 ≠ 没人撒谎
  assert.match(src, /别把它读成|不是「这局没人撒谎」|也可能/,
    '★空态少了自我纠正 —— 「没抓到矛盾」很容易被读成「这局没人撒谎」');
});

test('⑩ 免责定位句在首页页脚（不是只在 about 页）', () => {
  const html = read('index.html');
  assert.match(html, /它不替你下结论/, '首页页脚必须常驻定位句 —— 它是产品的一部分');
});

test('⑪ 录入屏必须给「撤回」而不是给「删除」', () => {
  const src = read('views/record.js');
  assert.match(src, /撤回/, '录入屏必须有撤回');
  assert.doesNotMatch(src, />删除</, '★不要写「删除」—— 撤回是软删，行永远在库里');
  assert.match(src, /软删/, '必须说明撤回是软删、账本不可变');
});

test('⑫ 前端不得出现准确率承诺与荐结论式措辞', () => {
  for (const f of ['index.html', 'views/review.js', 'views/games.js', 'views/record.js', 'views/about.js']) {
    const src = read(f);
    for (const [re, why] of [[/准确率/, '准确率承诺'], [/必胜|稳赢|包赢/, '结果承诺'],
      [/建议你|推荐你/, '荐结论式措辞'], [/试用\s*\d+\s*天/, '试用倒计时']]) {
      assert.doesNotMatch(src, re, f + ' 出现被禁措辞：' + why);
    }
  }
});

test('⑬ 支持深色与浅色（跟随系统，不给用户开关折腾）', () => {
  const css = read('app.css');
  assert.match(css, /prefers-color-scheme:\s*light/, '缺浅色主题');
  assert.match(css, /--bg:/, '缺设计令牌');
  assert.match(css, /--clash:/, '缺矛盾色令牌');
  // 动效要尊重用户的系统设置
  assert.match(css, /prefers-reduced-motion/, '缺 reduced-motion 处理 —— 前庭敏感用户会难受');
});

test('⑭ 页面必须能用手机打开（它是饭桌上用的）', () => {
  const html = read('index.html');
  assert.match(html, /name="viewport"[^>]*width=device-width/, '缺 viewport —— 手机上会缩成桌面版');
  const css = read('app.css');
  assert.match(css, /@media\s*\(max-width/, '没有任何窄屏适配');
  assert.match(css, /grid-template-columns:\s*1fr/, '宏三型在窄屏没有降为单列');
});
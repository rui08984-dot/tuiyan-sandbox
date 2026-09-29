'use strict';
/**
 * p1b/src/paths.cjs —— 「我的数据该放哪」的解析层（SPEC-runtime-paths）
 *
 * 本件**只解析，不做 IO**：不建目录、不开库、不写文件。副作用一律留给调用方
 * （`p1a-terminal/src/db.js:403` 的 `db.init` 本来就会 mkdir 父目录，所以调用方
 * 不必重复做这件事——这也是「能带空格与中文的路径直接起服务」不需要额外代码的原因）。
 *
 * ── 优先级链（逐级生效，SPEC Testing Strategy 1）──────────────────────────
 *   ① P1B_DB_PATH    最高：直接就是库文件的全路径，**原样返回，一个字符都不加工**
 *   ② P1B_DATA_DIR   次之：数据目录，库落在 `<目录>/p1a.db`
 *   ③ 平台默认        最低：Windows %LOCALAPPDATA% / macOS ~/Library/Application Support / Linux $XDG_DATA_HOME
 *
 * ── ★③ 这一级为什么要分「源码树」与「已打包」两种 ──────────────────────────
 *   SPEC 的两条 Success Criteria 表面上打架：
 *     ·「仓库开发态行为**不变**（不设 P1B_DATA_DIR 时仍解析到今天的路径）」
 *     ·「Windows 默认落 %LOCALAPPDATA%\P1bSandbox\」
 *   两者只有在「③ 这一级本身分两种情形」时才同时成立，而这正是事实：
 *   从源码树跑（`node p1b/src/server.js`）时，数据本来就在 `p1a-terminal/data/`，
 *   突然改道 %LOCALAPPDATA% 会让开发者**看不到自己刚写的数据**；
 *   而陌生人的 zip 里那份拷贝同样叫 `p1a-terminal/`，靠目录名分不出来。
 *   ⇒ 判据取**仓库标记文件** `.git`（打包产物里不会有）：有 ⇒ 源码树，无 ⇒ 已打包。
 *   打包件（模块 `packaging` 的 `tools/pack.mjs`）也可以用 `P1B_DIST=1` 显式声明，
 *   不必依赖标记文件是否被打进去。
 *
 * ── ★Windows 为什么**不用** %APPDATA% ─────────────────────────────────────
 *   %APPDATA% 是**漫游**配置：域控/漫游配置文件会把里面的东西同步到公司服务器。
 *   一个 6 MB 的 sqlite 库放在漫游路径下 = 每天把这 6 MB 推到域控、还可能被组策略锁成只读。
 *   数据就该落 %LOCALAPPDATA%（本机、不漫游）。SPEC Testing Strategy 2 把这条钉成测试。
 *
 * 零依赖，纯 CommonJS。
 */

const os = require('os');
const path = require('path');

/** 应用在平台数据目录里的名字（三平台统一，SPEC 里写死 `%LOCALAPPDATA%\P1bSandbox\`）。 */
const APP_DIR_NAME = 'P1bSandbox';

/** 数据目录里的库文件名。与 `p1a-terminal/src/db.js` 的 `DEFAULT_DB_PATH` 同名。 */
const DB_FILE_NAME = 'p1a.db';

/** 仓库根 = 本文件（`<repo>/p1b/src/paths.cjs`）上溯两级。 */
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** 源码树里的默认库位置 = 今天的开发态行为，一个字符都不许变。 */
const REPO_DB_PATH = path.join(REPO_ROOT, 'p1a-terminal', 'data', DB_FILE_NAME);

/**
 * 平台标准数据目录（SPEC 的 Windows 口径：**%LOCALAPPDATA%**，不是 %APPDATA%）。
 *
 * 纯函数：`env` / `platform` / `homedir` 全部可注入，所以三平台都能在 Windows 上测。
 * @param {{env?: object, platform?: string, homedir?: string}} [o]
 * @returns {string}
 */
function platformDataDir(o) {
  const opt = o || {};
  const env = opt.env || process.env;
  const platform = opt.platform || process.platform;
  const home = opt.homedir || os.homedir();

  if (platform === 'win32') {
    // ★绝不用 %APPDATA%（漫游）：漫游会把库同步到域控，还会跟着组策略变只读。
    const local = String(env.LOCALAPPDATA || '').trim();
    if (!local) throw new Error('[p1b] 拿不到 %LOCALAPPDATA%，无法确定数据目录');
    return path.join(local, APP_DIR_NAME);
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', APP_DIR_NAME);
  }
  // linux / 其他：XDG 优先，缺失回落 ~/.local/share
  const xdg = String(env.XDG_DATA_HOME || '').trim();
  return path.join(xdg || path.join(home, '.local', 'share'), APP_DIR_NAME);
}

/**
 * 现在是不是在**源码树**里跑（而不是打包件）。
 *
 * ★2026-09-29 改判据：原来是「仓库根有没有 `.git`」，那是**问错了问题**——
 *   它问的是「这是不是 git 仓库」，而我们真正要问的是「**我的数据在不在原地**」。
 *   后果很具体：把仓库打包成 zip（★打包模块产出的正是没有 `.git` 的东西）再本地跑，
 *   判据翻成 false ⇒ 数据**静默改道** `%LOCALAPPDATA%\P1bSandbox\`，
 *   不报错、不提示，只是「昨天还在的数据今天不见了」——
 *   而那是本轮所有改动里唯一一处会让人**今天干不了活**的情形。
 *
 * ⇒ 改成**两级**判据，缺一不可：
 *
 *   【第一级】原地那个库文件在 ⇒ 落原地，**不看有没有 .git**。
 *     · 开发者 git clone：库在 ⇒ 落原地（与从前一致，开发态行为零变化）
 *     · zip 副本里已有数据：库在 ⇒ 落原地（★这一级救的就是上面那个坑）
 *
 *   【第二级】原地没有数据 ⇒ 退回看 `.git`。
 *     ★为什么这一级不能省：**fresh clone 与 fresh zip 在文件系统上完全一样**
 *       （都有 p1a-terminal/ 与 p1b/、都没有库文件），唯一能分辨的信号就是 `.git`。
 *       第一版改成「有 p1a-terminal/ 与 p1b/ 就算源码树」，结果 fresh zip 安装
 *       也往程序目录里写数据 ⇒ **卸载即丢**，比原判据更糟 —— 被测试 ⑨c 当场抓住。
 *     · 开发者刚 clone 完还没建库：有 .git ⇒ 落原地（他期望数据就在仓库里）
 *     · 打包件全新安装：无 .git ⇒ 落平台数据目录
 *     · 想强制走平台目录：`P1B_DIST=1` 显式覆盖（打包启动器用）
 *
 * ★为什么第一级也不能只看「有 package.json」：打包件里**也有** package.json
 *   （根那个就是为打包建的），那样判据恒真 ⇒ 又回到第二级那个坑。
 */
function isSourceCheckout(o) {
  const opt = o || {};
  const env = opt.env || process.env;
  if (String(env.P1B_DIST || '').trim() === '1') return false;
  const fs = require('fs');
  const root = opt.root || REPO_ROOT;
  // 第一级：数据已经在这里，就不许改道（管它有没有 .git）
  if (fs.existsSync(opt.dbPath || REPO_DB_PATH)) return true;
  // 第二级：数据不在原地 ⇒ fresh clone 与 fresh zip 只剩 .git 能分辨
  return fs.existsSync(path.join(root, '.git'));
}

/**
 * 解析数据目录（第 ② ③ 级）。`P1B_DB_PATH` 不参与——它给的是**文件**不是目录。
 * @returns {string}
 */
function resolveDataDir(env) {
  const e = env || process.env;
  const explicit = String(e.P1B_DATA_DIR || '').trim();
  return explicit || platformDataDir({ env: e });
}

/**
 * 解析库文件全路径。**不建目录、不碰盘**。
 *
 * @param {object} [env]  环境变量（可注入，便于测试逐级验证）
 * @param {object} [opts] `{ isSourceCheckout?: boolean, root?: string }` —— 覆盖源码树判定，便于测试
 * @returns {string}
 */
function resolveDbPath(env, opts) {
  const e = env || process.env;
  const o = opts || {};

  // ① P1B_DB_PATH 最高：原样返回。它给的是什么就是什么，不解析、不补扩展名。
  const explicitFile = String(e.P1B_DB_PATH || '').trim();
  if (explicitFile) return explicitFile;

  // ② P1B_DATA_DIR
  const explicitDir = String(e.P1B_DATA_DIR || '').trim();
  if (explicitDir) return path.join(explicitDir, DB_FILE_NAME);

  // ③ 平台默认。★源码树里维持今天的路径（开发态行为零变化），已打包才落平台目录。
  //   ★2026-09-29 修一处自相矛盾：原先**检测**用 o.dbPath（可注入）、**返回**却硬给
  //   REPO_DB_PATH —— 查一个路径、返回另一个。生产下两者相同所以从未暴露，
  //   但它让「注入一个假 root 验证判据」根本验不了（测试只能靠改文件本身）。
  //   现在检测与返回用同一个 repoDb：生产行为逐字节不变，可注入性则真正成立。
  const repoDb = o.dbPath || REPO_DB_PATH;
  const inSource = o.isSourceCheckout === undefined ? isSourceCheckout(o) : !!o.isSourceCheckout;
  if (inSource) return repoDb;
  return path.join(platformDataDir({ env: e, platform: o.platform, homedir: o.homedir }), DB_FILE_NAME);
}

/**
 * 这个库路径是从哪一级解析出来的 —— 给启动横幅「打印真实值」用。
 * （横幅铁律：不许让横幅在说一件没发生的事。）
 * @returns {'P1B_DB_PATH'|'P1B_DATA_DIR'|'repo'|null}
 */
function dbPathSource(dbPath, env, opts) {
  const e = env || process.env;
  if (String(e.P1B_DB_PATH || '').trim()) return 'P1B_DB_PATH';
  if (String(e.P1B_DATA_DIR || '').trim()) return 'P1B_DATA_DIR';
  const o = opts || {};
  const inSource = o.isSourceCheckout === undefined ? isSourceCheckout(o) : !!o.isSourceCheckout;
  return inSource ? 'repo' : null;
}

/** 横幅上跟在库路径后面那句括号说明。 */
function describeDbPath(dbPath, env, opts) {
  switch (dbPathSource(dbPath, env, opts)) {
    case 'P1B_DB_PATH': return '（P1B_DB_PATH 指定）';
    case 'P1B_DATA_DIR': return '（P1B_DATA_DIR 指定）';
    case 'repo': return '（源码树默认，与终端共用同一个库）';
    default: return '（平台数据目录）';
  }
}

module.exports = {
  APP_DIR_NAME, DB_FILE_NAME, REPO_ROOT, REPO_DB_PATH,
  platformDataDir, isSourceCheckout, resolveDataDir, resolveDbPath, dbPathSource, describeDbPath,
};

'use strict';
/*
 * file-map.cjs —— 项目「文件全图」生成器（用户令 2026-09-14 深夜：项目地图要「目录一样，每个相关文件路径都在，并说是什么」）
 *
 * 输出：markdown（默认追加用片段，可直接贴进 `项目全资源地图-20260914.md` 的 §10）
 *   分区：根目录 / docs（规格·计划·锚·sandbox）/ .scratch（交接链·研究档案·备份）/ p1b（src·scripts·test·读数组件）/ 其它
 *   每行：`路径` —— 一句话（抽取自文件首标题或首个实义行；关键件用 OVERRIDE 手写短述）
 * 纪律：只读；跳过依赖/构建/媒体目录；不复制内容、只给路径与一句话。
 *
 * 用法：node p1b/scripts/file-map.cjs [--out <file>] [--stdout]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const OUT = arg('out', null);
const STDOUT = process.argv.indexOf('--stdout') >= 0;

// 关键件短述（覆盖自动抽取；只写「是什么/干什么」，不复述内容）
const OVERRIDE = {
  'AGENTS.md': '工作区指令＋代码地图（dsh-openwolf 生成）',
  '项目全资源地图-20260914.md': '**本文件**：项目总索引（§0 一分钟现状 → 各期现状节〔顺序追加；最新＝最大编号节，以该节为准〕→ 末节 §10 文件全图）',
  'docs/specs/2026-09-11-万物可预测性审计器-design.md': '权威设计：六层分类＋G2 门禁（R4 系列）＋接题层 §8',
  'docs/specs/推演沙盘-终极路线图-20260913.md': '阶段 0–5 全图（宏观）',
  'docs/specs/README-总索引.md': '文档总导航（权威层级＋§4.5 施工产物）',
  'docs/specs/变更留痕索引-20260912.md': '变更留痕（每批一节，含 commit；节号连续递增，权威＝文内末节）',
  'docs/specs/通俗说明-这套干什么怎么用-v1.md': '任务 5 交付件（用户已验收）',
  'docs/specs/简化重构方案-v1.md': '任务 6 清单（B1-1…B1-6）',
  'docs/specs/参数表-人话版-v1.md': '环境变量/CLI 参数表（批次 2）',
  'docs/specs/kind-目录表.md': '**kind 目录表**（生成件；`p1b/scripts/kind-table.cjs`；权威计数＝该表表头所列）',
  'docs/specs/阶段5-检索式预测-立项书-v1.1.md': '阶段 5 立项书（评审后修订；待用户拍板）',
  'docs/specs/阶段5-立项评审-检索式预测-20260914.md': '阶段 5 独立评审（16 发现/8 必改）',
  'docs/specs/阶段5-功能映射表与信号源勘察-20260915.md': '阶段 5 裁决落盘（2026-09-15）：铁律④选(b) 实验臂声明＋功能映射表＋信号源勘察（29 主机/52 kind）',
  'p1b/scripts/backfill-base-rate.cjs': '老行 evidence.baseRate 物化回填器（零翻转安全集；dry-run 默认＋快照＋pureAdd 校验）',
  'p1b/scripts/stage5-leak-probe.cjs': '阶段 5 泄漏三层探针（工程验证；SQL 断言＋源码扫描＋canary；leak=0 才过）',
  'p1b/scripts/effective-source-snapshot.cjs': '阶段 5 生效源冻结快照（零 key；LLM 侧＋检索侧现状）',
  'p1b/src/retrieval/aggregate.js': '阶段 5 retrieval 臂固定聚合规则（纯函数；LLM 不出概率）',
  'p1b/src/retrieval/sham.js': '阶段 5 sham 臂构造器（确定性、±5% 长度预算）',
  'p1b/test/stage5-retrieval.test.cjs': '阶段 5 工程验证测试（聚合规则/sham/泄漏探针）',
  'p1b/test/backfill-base-rate.test.cjs': '回填器单测（安全集/pureAdd/读数零翻转/快照回滚）',
  'docs/specs/命题A-全量消融判定报告-20260914.md': '命题 A 判定（负结果止发维持）',
  'docs/specs/阶段4-分层真跑报告-20260914.md': '阶段 4 分层真跑报告（含 §六 L5 追加）',
  'docs/specs/历史回测引擎-规格D2-20260913.md': 'D2 回测引擎规格（F4/防泄漏判据）',
  'docs/plans/2026-09-14-通往最终目标-分步实施计划.md': '三幕七任务实施计划（任务 6 批次 3 ✅）',
  'p1b/src/evidence/baseRate.js': '**基率读数单一真源**（批次 3；三读序＋结构化字段）',
  'p1b/scripts/vault-sync.cjs': 'truth_vault 同步器（批次 3 F4 操作；dry-run 默认）',
  'p1b/scripts/kind-table.cjs': 'kind 目录表生成器（批次 3）',
  'p1b/scripts/scripts-index.cjs': '脚本目录索引生成器 → `p1b/scripts/README.md`',
  'p1b/scripts/README.md': '在役脚本目录（按前缀分组＋写库标记；权威计数＝`scripts-index.cjs` 输出，勿手数）',
  'p1b/scripts/archive/README.md': '归档区说明（69 件历史探针的路径映射）',
  'p1b/scripts/board.cjs': '一页看板（门读数/采信/五层/账本）',
  'p1b/scripts/exp-health.cjs': '跑批体检（进程/DB 增长/队列陈旧三件套）',
  'p1b/scripts/g2-report.cjs': 'G2 门月报（R4 口径实现）',
  'p1b/scripts/stage4-run.cjs': '五层分层真跑（L1/L2/L3/L5/L6）',
  'p1b/test/fixtures/base-rate-golden.json': '基率解析金样（151 条真实注记×三读序；批次 3 冻结）',
  '.scratch/forecast-debate/PREREG-命题A-3.0消融-v1.md': 'PREREG 冻结件（sha 5d6907d1；改动＝版本递进）',
  '.scratch/forecast-debate/PREREG-检索式预测-v1-骨架.md': '阶段 5 PREREG 骨架（**未冻结**；2026-09-15 已填裁决要点＋谓词计数＋N_min=256）',
  '.scratch/forecast-debate/PREREG附件A-检索式预测-提示词-v1-草案.md': '阶段 5 提示词全文附件（LLM 出证据行、不出概率；冻结时写 sha）',
  '.scratch/handoff/推演沙盘-交接-20260914-深夜-批次3.md': '**最新唯一入口**（覆盖此前全部交接链）',
};
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.tmp', '_session_extract', 'p7-chrome-profile', 'assets', '素材库', 'out', 'cache']);
const EXT_OK = /\.(md|json|cjs|mjs|js|txt|log|out|db|bat|cmd|ps1)$/i;
const SKIP_FILE = /^(p1a-bd3-backup|p1a-multidev|package-lock\.json)/;

// ★二进制守卫（2026-09-18 修）：`readFileSync(p,'utf8')` 对二进制**不抛错**——非法字节被静默替换成 U+FFFD，
//   于是 `.db` 的 SQLite 头（含 NUL）被当成「一句话」写进地图 ⇒ 生成物含 NUL/控制字符
//   （实测：`p1b/test/fixtures/stage4-golden-db-20260917.db` 那一行 ⇒ 文件对 grep/编辑器/Edit 类工具变「二进制」）。
//   ⇒ 判据下移到**字节层**：前 8KB 出现 NUL 即视为二进制，不抽句。
function isBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}
// ★出口兜底：任何进入地图的文本行都不得含 C0 控制字符（NUL 等）——防未来再有二进制/异常字节泄漏。
function sanitize(s) {
  return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '�');
}
function headline(p) {
  if (OVERRIDE[p]) return OVERRIDE[p];
  let t = '';
  try {
    const buf = fs.readFileSync(path.join(ROOT, p));
    if (isBinary(buf)) return '（二进制体：不抽句；随目录级列出）';
    t = buf.toString('utf8').split(/\r?\n/).slice(0, 30).join('\n');
  } catch (e) { return '（不可读/二进制）'; }
  const lines = t.split('\n');
  for (let s of lines) {
    s = s.trim().replace(/^#+\s*/, '').replace(/^\/\*+\s*/, '').replace(/^\*\s?/, '').replace(/^\/\/\s?/, '').replace(/\*\/\s*$/, '').trim();
    if (!s || s.length < 6) continue;
    if (/^['"]use strict['"]/.test(s) || s === '---' || s.charAt(0) === '#') continue;
    if (/^(shell|bash|node|powershell)$/i.test(s)) continue;
    return s.length > 110 ? s.slice(0, 108) + '…' : s;
  }
  return '（无一句话可抽）';
}
function walk(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }); } catch (e) { return; }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (SKIP_DIRS.has(e.name)) continue;
    const rel = (dir ? dir + '/' : '') + e.name;
    if (e.isDirectory()) { walk(rel, out); continue; }
    if (!EXT_OK.test(e.name) || SKIP_FILE.test(e.name)) continue;
    if (/\.db$/.test(e.name) && rel.indexOf('.scratch/backup') === 0) continue; // 快照只列目录级
    out.push(rel);
  }
}
const SECTIONS = [
  ['根目录', ['AGENTS.md', '项目全资源地图-20260914.md', 'AI音乐电台账号调研与执行方案.md', '电台执行手册-整理版.md']],
  ['docs/specs（规格·报告·判据）', null],
  ['docs/plans 与 docs/sandbox（计划与锚）', null],
  ['.scratch/handoff（交接链）', null],
  ['.scratch/forecast-debate（研究档案·PREREG）', null],
  ['p1b/src（产品代码）', null],
  ['p1b/scripts（脚本：取数/跑批/报表/体检）', null],
  ['p1b/test（测试）', null],
  ['p1b/sim/out（收据·读数件）', null],
];
const md = [];
md.push('## §10 文件全图（' + new Date().toISOString().slice(0, 10) + ' 刷新 · 由 `p1b/scripts/file-map.cjs` 生成，勿手改）');
md.push('');
md.push('> 目标（用户令）：「目录一样，每个相关文件路径都在里面，还说是是什么」。');
md.push('> 生成命令：`node p1b/scripts/file-map.cjs --out …`；跳过依赖/构建/媒体目录与 `.db` 快照体（只列目录级）。');
md.push('');
const POINTER = {
  'p1b/scripts': '逐件索引：`p1b/scripts/README.md`（`scripts-index.cjs` 生成）',
  'p1b/scripts/archive': '归档说明与路径映射：`p1b/scripts/archive/README.md`',
  'p1b/sim/out': '收据为 `.md`（上面已逐件列）；其余为各轮读数件（可用对应脚本重跑生成）',
  'docs/sandbox/p1b/itest': '进度锚 p7–p22 为长项目锚（**最新 p19/p20+** 见本目录）',
};
function emit(title, list) {
  md.push('### ' + title + '（' + list.length + '）');
  md.push('');
  // 同类折叠：>12 件的目录（按「目录+扩展类型」分组）折叠成一行；收据类 .md 保留逐件
  const byKey = {};
  for (const p of list) {
    const d = path.posix.dirname(p);
    const ext = path.posix.extname(p).toLowerCase();
    const kind = (ext === '.md') ? 'md' : 'other';
    const key = d + '|' + kind;
    (byKey[key] = byKey[key] || []).push(p);
  }
  const collapsed = new Set();
  for (const [key, group] of Object.entries(byKey)) {
    const [d, kind] = key.split('|');
    if (group.length <= 12) continue;
    if (kind === 'md' && group.length <= 60) continue; // .md（文档/收据/锚）逐件列：它们正是「是什么」的主体
    const sample = group[0];
    const ptr = POINTER[d + '/' + path.posix.basename(sample)] || POINTER[d] || '';
    group.forEach((g) => collapsed.add(g));
    md.push('- `' + d + '/`（' + group.length + ' 件' + (kind === 'md' ? ' .md' : '') + '）—— 代表件 `'
      + path.posix.basename(sample) + '`：' + headline(sample) + (ptr ? '；' + ptr : ''));
  }
  for (const p of list) {
    if (collapsed.has(p)) continue;
    md.push('- `' + p + '` —— ' + headline(p));
  }
  md.push('');
}
// 根目录（固定清单）
emit(SECTIONS[0][0], SECTIONS[0][1].filter((f) => fs.existsSync(path.join(ROOT, f))));
// 其余按目录
const all = [];
walk('docs/specs', all); emit('docs/specs（规格·报告·判据）', all.filter((p) => p.startsWith('docs/specs/')));
const plans = []; walk('docs/plans', plans); walk('docs/sandbox/p1b/itest', plans);
emit('docs/plans 与 docs/sandbox/p1b/itest（计划与进度锚）', plans);
const ho = []; walk('.scratch/handoff', ho); emit('*.scratch/handoff（交接链，最新入口在末行）', ho);
const fd = []; walk('.scratch/forecast-debate', fd); emit('.scratch/forecast-debate（研究档案/PREREG/实验报告）', fd);
const src = []; walk('p1b/src', src); emit('p1b/src（产品代码）', src);
const sc = []; walk('p1b/scripts', sc); emit('p1b/scripts（脚本；归档区见 archive/README.md）', sc);
const te = []; walk('p1b/test', te); emit('p1b/test（测试）', te);
const so = []; walk('p1b/sim/out', so); emit('p1b/sim/out（收据与读数件；大件 .db/截图不入列）', so);
md.push('### 其它（目录级）');
md.push('');
md.push('- `.scratch/backup/` —— 迁移/修复前的 SQLite 快照（sha256 记在各收据；本目录不逐件列）');
md.push('- `.scratch/merged-migration/`、`.scratch/backtest/` —— F4/迁移排练件与只读题面库');
md.push('- `p1a-terminal/data/p1a.db` —— **生产账本**（predictions/verdicts/truth_vault…）；`p1a-terminal/**` 为 p1a 线（含禁改面）');
md.push('- `p1b/web/`（前端源码与 dist 构建）、`tools/`、`scripts/` —— 见各自 README/索引');
md.push('');
md.push('（§10 完 · 2026-09-14 深夜 · 生成器 `p1b/scripts/file-map.cjs` · 计数：共 ' + (all.length + plans.length + ho.length + fd.length + src.length + sc.length + te.length + so.length) + ' 件在列）');

const text = md.map(sanitize).join('\n');
// ★自检（写盘前）：生成物不得含 NUL —— 违反即硬失败，禁把二进制泄漏写进仓库文件。
if (/\u0000/.test(text)) { console.error('[file-map] 生成物含 NUL ⇒ exit 3（防二进制泄漏；见 headline 的 isBinary 守卫）'); process.exit(3); }
if (STDOUT || !OUT) console.log(text);
else { fs.writeFileSync(path.resolve(OUT), text + '\n', 'utf8'); console.log('[file-map] -> ' + OUT + ' (' + text.split('\n').length + ' 行)'); }

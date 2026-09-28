'use strict';
/**
 * scripts/plan-audit.cjs —— 最终方案完成审计器（2026-09-28）
 *
 * 用途：机械核对 `docs/plans/2026-09-28-最终方案-可信层对外.md` 的每一项交付物
 *       **是否真的在盘上、是否真的被测试锁住**。不靠回忆，不靠信任。
 *
 * ★纪律：**本脚本全程只读**。不写任何文件，不碰 p1a.db（除 {readOnly:true} 查 schema）。
 * ★每项给出「证据路径」，没有证据的一律记 FAIL —— 绿灯不等于做完。
 *
 * 用法：node scripts/plan-audit.cjs [--json]
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const asJson = process.argv.includes('--json');

const 结果 = [];
function 记(阶段, 项, 通过, 证据) {
  结果.push({ 阶段, 项, 通过: !!通过, 证据: 证据 || '' });
}

const 有 = (p) => fs.existsSync(path.join(ROOT, p));
const 读 = (p) => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch { return ''; } };
const 计数 = (p, re) => { const t = 读(p); if (!t) return -1; return (t.match(re) || []).length; };

// ───────────────────────── 阶段〇：锚与纪律 ─────────────────────────
记('锚', '最终方案锚文件在盘上', 有('docs/plans/2026-09-28-最终方案-可信层对外.md'),
  'docs/plans/2026-09-28-最终方案-可信层对外.md');
记('锚', '第 22 份交接件在盘上', 有('.scratch/handoff/推演沙盘-交接-20260928-终态.md'),
  '.scratch/handoff/推演沙盘-交接-20260928-终态.md');
记('锚', '五份 09-28 文档全部在盘上（迁入后）',
  ['docs/specs/推演沙盘-投资级评审报告-20260928.md',
   'docs/specs/推演沙盘-架构ADR与商用化目标-20260928.md',
   'docs/specs/推演沙盘-Agent化命题评估报告-20260928.md',
   'docs/specs/推演沙盘-特化智能体方案设计书-20260928.md',
   'docs/specs/推演沙盘-外部基座选型与设计书修订-20260928.md'].filter(有).length === 5,
  '5 份，逐个 test -f');

// ───────────────────────── 阶段一：可证伪实验 ─────────────────────────
const prereg = 'docs/specs/PREREG-base-rate-decision-value-v1.md';
记('阶段一', '判据已冻结成文件', 有(prereg), prereg);
记('阶段一', '判据冻结件带 sha256 登记', 有(prereg) && /sha256|[0-9a-f]{16,}/i.test(读(prereg)),
  prereg + ' 内含 sha256');
记('阶段一', '实验脚本在盘上', 有('p1b/scripts/base-rate-decision-value.cjs'),
  'p1b/scripts/base-rate-decision-value.cjs');
const bs = 读('p1b/scripts/base-rate-decision-value.cjs');
记('阶段一', '★顶层有 require.main 守卫（scripts-require-safety 回归锁要求）',
  bs.includes('require.main === module'), 'grep require.main === module');
记('阶段一', '实验有测试', 有('p1b/test/base-rate-decision-value.test.cjs'),
  'p1b/test/base-rate-decision-value.test.cjs');
记('阶段一', '★读数件已产出（json 或 md）',
  有('p1b/sim/out/base-rate-decision-value-20260928.json') ||
  有('p1b/sim/out/base-rate-decision-value-20260928.md') ||
  fs.readdirSync(path.join(ROOT, 'p1b/sim/out')).some((f) => /^base-rate-decision-value-.*\.(json|md)$/.test(f)),
  'p1b/sim/out/base-rate-decision-value-*.{json,md}');
记('阶段一', '实验库只读（无裸 new DatabaseSync 无 readOnly）',
  !/new DatabaseSync\([^)]*\)(?!\s*;?\s*[\s\S]{0,40}readOnly)/.test(bs) ||
  (bs.match(/readOnly/g) || []).length > 0,
  '脚本内 readOnly:true 出现 ' + (bs.match(/readOnly/g) || []).length + ' 次');

// ───────────────────────── 阶段二：诚实区间 ─────────────────────────
记('阶段二', 'ErrorBar 支持可空 value（区间独立于点估计）',
  /value\??\s*:\s*(number\s*\|\s*)?null/.test(读('p1b/web/src/charts/ErrorBar.tsx')) ||
  /value\??\s*:\s*number\s*\|\s*null/.test(读('p1b/web/src/charts/ErrorBar.tsx')),
  'p1b/web/src/charts/ErrorBar.tsx');
记('阶段二', 'auditKpi 的 ci_lo/ci_hi 是独立字段',
  /ci_lo/.test(读('p1b/src/routes/auditKpi.js')) && /ci_hi/.test(读('p1b/src/routes/auditKpi.js')),
  'p1b/src/routes/auditKpi.js');
const 路由目录 = 有('p1b/src/routes') ? fs.readdirSync(path.join(ROOT, 'p1b/src/routes')) : [];
const 诚实端点 = 路由目录.filter((f) => {
  const t = 读('p1b/src/routes/' + f);
  return /interval|coverage_guarantee|point_estimate/.test(t);
});
记('阶段二', '★存在输出区间/点估计的只读端点', 诚实端点.length > 0,
  诚实端点.length ? 'p1b/src/routes/' + 诚实端点.join(', ') : '未找到');
记('阶段二', '★三态语义在盘上（够样本 / 不足 30 / 一道都没有）',
  诚实端点.some((f) => {
    const t = 读('p1b/src/routes/' + f);
    return /not_due|enough|不足\s*30|n\s*===\s*0|no_history/.test(t);
  }),
  '端点源码内的三态分支');
记('阶段二', '诚实区间有测试',
  fs.readdirSync(path.join(ROOT, 'p1b/test')).some((f) => /honest|interval|decision-value/.test(f)),
  'p1b/test/*honest*|*interval*|*decision-value*');

// ───────────────────────── 阶段三：判词层换口径 ─────────────────────────
const vs = 读('p1b/src/db/verdictsStore.js');
记('阶段三', 'verdicts 表有 leak_state（或等价）列', /leak_state|post_settlement/.test(vs),
  'p1b/src/db/verdictsStore.js');
记('阶段三', '★历史行零 backfill（列可空 + 无全表 UPDATE verdicts）',
  /leak_state/.test(vs) ? !/UPDATE verdicts SET leak_state/i.test(vs) : false,
  '未出现 UPDATE verdicts SET leak_state（应靠 NULL 默认自然入桶）');
记('阶段三', 'saveVerdict 有三态（clean / post_settlement / legacy）',
  /post_settlement/.test(vs) || /legacy/.test(vs),
  'p1b/src/db/verdictsStore.js');
记('阶段三', '★落点不是 process_roles（那张表运行期零执行）',
  !/process_roles/.test(vs.split('saveVerdict')[1] || ''),
  'saveVerdict 内未引用 process_roles');
记('阶段三', '读侧有 verdicts_clean 视图或等价收口',
  /verdicts_clean/.test(读('p1b/src/db/dbSchema.js') || '') ||
  /verdicts_clean/.test(vs) ||
  fs.readdirSync(path.join(ROOT, 'p1b/src/db')).some((f) => /verdicts_clean/.test(读('p1b/src/db/' + f))),
  'verdicts_clean');
记('阶段三', '★5156 条判词未被清空', 计数('p1b/src/db/verdictsStore.js', /DELETE FROM verdicts/gi) === 0,
  '源码内无 DELETE FROM verdicts');

// ───────────────────────── 阶段四：判据 → 模型协议 ─────────────────────────
const 协议候选 = ['p1b/src/protocol', 'p1b/src/agentProtocol', 'p1b/src/lib/protocol'];
const 协议命中 = 协议候选.filter(有);
记('阶段四', '模型可遵循的协议件在盘上', 协议命中.length > 0,
  协议命中.length ? 协议命中.join(', ') : '未找到');
记('阶段四', '★判词输出已从「末行 P=0.xx 正则抽」升级为结构化',
  /json_schema|response_format|structured/.test(读('p1b/src/routes/verdicts.js')) ||
  协议命中.some((p) => /json_schema|response_format|structured/.test(读(p))),
  'response_format / json_schema / structured');
记('阶段四', '★缺失即拒、不回退文本抽取的闸在盘上',
  /no_fallback|缺失即拒|必须结构化/.test(读('p1b/src/routes/verdicts.js')) ||
  协议命中.some((p) => /no_fallback|缺失即拒|必须结构化/.test(读(p))),
  '回退禁令的落点');

// ───────────────────────── 阶段五：打包（可抛弃）─────────────────────────
记('阶段五', 'MCP 适配层存在（或明确记录为「推迟，可抛弃」）', 有('p1b/mcp'),
  'p1b/mcp/（缺席=本轮刻意不做，符合方案的「可抛弃」定性）');

// ───────────────────────── 横切纪律 ─────────────────────────
记('纪律', '★未引入任何新依赖（后端 package.json）', (() => {
  const p = JSON.parse(读('p1b/package.json') || '{}');
  const deps = Object.keys(p.dependencies || {});
  return deps.every((d) => ['fastify', '@fastify/cors', '@fastify/static', 'lunar-javascript'].includes(d));
})(), 'p1b/package.json dependencies');
记('纪律', '★SKILL.md 禁词自查（界面与注释不得出现「预测」）',
  计数('p1b/skill/SKILL.md', /预测/g) === 0, 'p1b/skill/SKILL.md 中「预测」出现 ' + 计数('p1b/skill/SKILL.md', /预测/g) + ' 次');
记('纪律', '★统一闸门命令存在', 有('p1b/gates/gates.cjs'), 'p1b/gates/gates.cjs');
记('纪律', 'pre-commit 钩子未擅自启用', !有('.git/hooks/pre-commit'),
  '.git/hooks/pre-commit 缺席（启用与否由用户拍板）');
记('纪律', '★新增测试随每批落地（后端用例文件 ≥ 90）',
  fs.readdirSync(path.join(ROOT, 'p1b/test')).filter((f) => f.endsWith('.test.cjs')).length >= 90,
  'p1b/test/*.test.cjs 共 ' + fs.readdirSync(path.join(ROOT, 'p1b/test')).filter((f) => f.endsWith('.test.cjs')).length + ' 个');

// ───────────────────────── 输出 ─────────────────────────
const 按阶段 = {};
for (const r of 结果) {
  (按阶段[r.阶段] ||= { 通过: 0, 失败: 0, 项: [] });
  按阶段[r.阶段][r.通过 ? '通过' : '失败']++;
  按阶段[r.阶段].项.push(r);
}
const 总通过 = 结果.filter((r) => r.通过).length;
const 总失败 = 结果.length - 总通过;

if (asJson) {
  console.log(JSON.stringify({ 总通过, 总失败, 按阶段 }, null, 2));
} else {
  console.log('最终方案 · 完成审计（只读机械核对）');
  console.log('='.repeat(72));
  for (const [阶段, g] of Object.entries(按阶段)) {
    console.log('\n【' + 阶段 + '】 ' + g.通过 + ' 过 / ' + g.失败 + ' 失');
    for (const r of g.项) {
      console.log('  ' + (r.通过 ? '[PASS] ' : '[FAIL] ') + r.项);
      if (r.证据) console.log('         ↳ ' + r.证据);
    }
  }
  console.log('\n' + '='.repeat(72));
  console.log('合计：' + 总通过 + ' 过 / ' + 总失败 + ' 失');
  console.log('★[FAIL] 不等于「没做」，可能确实没做，也可能做了但证据路径写错了 —— 两种都要查。');
}
process.exit(总失败 > 0 ? 1 : 0);

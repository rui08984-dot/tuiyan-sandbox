'use strict';
// _qc_check.cjs — 两份真实局档案机械核验（E-编号连续性 / 头部泄露 / 人数口径）
const fs = require('fs');
const base = 'E:/music player/docs/sandbox/p0-replay/';
const out = [];

function check(label, fn) {
  try { const r = fn(); out.push('PASS | ' + label + (r ? ' | ' + r : '')); }
  catch (e) { out.push('FAIL | ' + label + ' | ' + e.message); }
}

const games = {
  lyingman: { pub: base + 'replay-werewolf-lyingman-s02e01.md', truth: base + 'replay-werewolf-lyingman-s02e01.truth.md' },
  pandakill: { pub: base + 'replay-werewolf-pandakill-s1e7.md', truth: base + 'replay-werewolf-pandakill-s1e7.truth.md' }
};

for (const [id, g] of Object.entries(games)) {
  const pub = fs.readFileSync(g.pub, 'utf8');
  const truth = fs.readFileSync(g.truth, 'utf8');
  out.push('===== ' + id + ' =====');

  // 1) E-编号连续性
  const ids = [...pub.matchAll(/\bE-(\d+)\b/g)].map(m => parseInt(m[1]));
  const uniq = [...new Set(ids)].sort((a, b) => a - b);
  const max = Math.max(...uniq);
  const missing = [];
  for (let i = 1; i <= max; i++) if (!uniq.includes(i)) missing.push(i);
  check(id + ' E-编号连续性（1..' + max + ' 无跳号）', () => {
    if (missing.length) throw new Error('跳号: ' + missing.join(','));
    return uniq.length + ' 个唯一编号，共 ' + ids.length + ' 次引用';
  });
  check(id + ' E-编号无重复定义（- N: 模式）', () => {
    const defs = [...pub.matchAll(/^- E-(\d+):/gm)].map(m => parseInt(m[1]));
    const dups = defs.filter((v, i) => defs.indexOf(v) !== i);
    if (dups.length) throw new Error('重复定义: ' + dups.join(','));
    return defs.length + ' 条事件定义';
  });

  // 2) 头部泄露检查（切片屏蔽前的档案原貌问题清单）
  const head = pub.split(/^## /m)[0];
  check(id + ' 头部泄露：结果行', () => {
    if (/结果[:：]/.test(head)) throw new Error('头部含「结果:」行（botc 范本无此行；逐日切片会泄露终局）→ 建议组装切片时屏蔽头部');
    return '无结果行';
  });
  check(id + ' 头部泄露：叙事标签', () => {
    const tags = [];
    if (/JY封神|封神之路/.test(head)) tags.push('JY封神');
    if (/阴阳倒钩/.test(head)) tags.push('阴阳倒钩');
    if (tags.length) throw new Error('头部含叙事标签: ' + tags.join('/') + '（探针已证模型有此背景知识）→ 切片时屏蔽');
    return '无叙事标签';
  });

  // 3) 人数口径：truth 狼名单 vs 公开版头部声明
  const wolfM = truth.match(/(?:狼人阵营|坏人阵营\s*=\s*狼人)\s*=?\s*\{([^}]+)\}/) || truth.match(/坏人阵营\s*=\s*狼人\s*\{([^}]+)\}/);
  const wolves = wolfM ? wolfM[1].split(/[,，、]/).length : NaN;
  const headDecl = head.match(/(\d+)\s*狼/);
  check(id + ' 人数口径一致（truth 狼数 vs 头部声明）', () => {
    if (!wolfM) throw new Error('truth 层未找到狼人阵营名单行');
    if (headDecl && parseInt(headDecl[1]) !== wolves) {
      throw new Error('truth 狼数=' + wolves + '，头部声明=' + headDecl[1] + ' 狼 → 矛盾，需修正公开版头部');
    }
    return 'truth 狼数=' + wolves + (headDecl ? '，头部=' + headDecl[1] + ' 狼，一致' : '，头部无狼数声明');
  });
  check(id + ' truth 好人名单', () => {
    const goodM = truth.match(/好人阵营\s*=\s*\{([^}]+)\}/);
    if (!goodM) throw new Error('未找到好人阵营行');
    const n = goodM[1].split(/[,，、]/).length;
    return '好人=' + n + '，狼=' + wolves + '，合计=' + (n + wolves);
  });
}
fs.writeFileSync(base + '_qc_check-out.txt', out.join('\n'), 'utf8');
console.log(out.join('\n'));

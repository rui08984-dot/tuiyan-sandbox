import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * 弹层一致性闸（2026-09-23 七轮）
 *
 * 起因：用户反馈「叠加页交互有点奇怪」。排查后确认不是"奇怪"而是**不一致**——
 *   站点里 9 个弹层，只有术语抽屉支持 Esc，其余八个按 Esc 没反应；
 *   点遮罩关闭也各有各的（有的能关有的不能）。
 *
 * 本闸钉住「键盘与指针行为必须统一」这条不变量：所有弹层都要走同一个
 * useModalDismiss（它统一提供 Esc / 点遮罩 / 锁滚动 / 焦点管理）。
 *
 * ★ 允许的例外（必须显式声明并写明理由）：
 *   确认卡（ConfirmCard）禁用「点遮罩关闭」——里面是未入库的人工录入，
 *   误触丢失代价高于便利。它仍必须走同一个 hook（保持 Esc 与锁滚动一致）。
 */
const here = dirname(fileURLToPath(new URL('./useModalDismiss.ts', import.meta.url)));

/** 使用弹层的组件清单（新加弹层时同步补进来——漏了就会在下面被点名） */
const MODALS = [
  'components/NewGameWizard.tsx',
  'components/ProviderEditorSheet.tsx',
  'components/input/MacroSheet.tsx',
  'components/input/EditSheet.tsx',
  'components/input/ConfirmCard.tsx',
  'components/input/TopBar.tsx',
  'pages/live/OracleZone.tsx',
];

function read(rel) {
  return readFileSync(join(here, '..', rel), 'utf8');
}

test('所有弹层走统一的 useModalDismiss（Esc / 点遮罩 / 锁滚动 / 焦点）', () => {
  const missing = [];
  for (const f of MODALS) {
    const src = read(f);
    // 只检查真正声明了 role="dialog" 的组件（TopBar 的抽屉在子组件里，容错）
    if (!src.includes('role="dialog"')) continue;
    if (!src.includes('useModalDismiss')) missing.push(f);
  }
  assert.deepEqual(missing, [], '以下弹层未接入统一行为（Esc/点遮罩会与其他弹层不一致）：\n' + missing.join('\n'));
});

test('useModalDismiss 提供的四条行为一个不少', () => {
  const src = readFileSync(join(here, 'useModalDismiss.ts'), 'utf8');
  assert.ok(src.includes("e.key === 'Escape'"), '缺 Esc 关闭');
  assert.ok(src.includes('e.target === e.currentTarget'), '缺「只在点遮罩本身时关闭」的判定（否则点内容区会误关）');
  assert.ok(src.includes("document.body.style.overflow = 'hidden'"), '缺背景锁滚动');
  assert.ok(src.includes('.focus'), '缺焦点管理（键盘用户会卡在背后页面）');
});

test('取消型弹层禁用点遮罩关闭（防误触丢失未入库内容）', () => {
  const confirm = read('components/input/ConfirmCard.tsx');
  assert.ok(confirm.includes('closeOnOverlay: false'), '确认卡未禁用点遮罩关闭（误触会丢未入库的录入）');
  // 但仍必须走 hook：Esc 与锁滚动要保持一致
  assert.ok(confirm.includes('useModalDismiss'), '确认卡未接入统一行为');
});

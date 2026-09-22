import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * 色板单一真源闸（2026-09-22 全方面重构 · 收尾）
 *
 * 背景：色板由暖棕羊皮纸换成抹茶绿后，tokens.css 的**基色**改了，但各页面 CSS 里
 * 的**半透明档**（rgba 形式的 ok/danger 底与边框）仍是旧色相常量 —— 同一语义在
 * 「文字色」走新 token、「底色」走旧常量，视觉上就是半新半旧。已一次性清掉 25 处，
 * 本闸防止复发。
 *
 * 规则：除 tokens.css（唯一定义处）外，任何 CSS 不得再出现：
 *   ① 旧色板常量（ok #58B368 / danger #E05C4A 及其 rgba 分量）
 *   ② 任何 6 位十六进制色值（色值必须走 var(--...)）
 * 半透明档一律用 --ok-bg / --ok-border / --danger-bg / --danger-border / --warn-bg / --warn-border。
 */
const dir = dirname(fileURLToPath(new URL('./tokens.css', import.meta.url)));
const LEGACY = [
  { pat: /#58B368/i, why: '旧 ok 基色 #58B368' },
  { pat: /#E05C4A/i, why: '旧 danger 基色 #E05C4A' },
  { pat: /88,\s*179,\s*104/, why: '旧 ok rgba 分量 88,179,104' },
  { pat: /224,\s*92,\s*74/, why: '旧 danger rgba 分量 224,92,74' },
];

function cssFiles() {
  return readdirSync(dir).filter((f) => f.endsWith('.css') && f !== 'tokens.css');
}

test('除 tokens.css 外无旧色板常量残留', () => {
  const hits = [];
  for (const f of cssFiles()) {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const { pat, why } of LEGACY) {
      const m = src.match(pat);
      if (m) hits.push(`${f}: ${why}`);
    }
  }
  assert.deepEqual(hits, [], '旧色板常量残留（会造成半新半旧）：\n' + hits.join('\n'));
});

test('除 tokens.css 外不写死 6 位十六进制色值（色值须走 var）', () => {
  const hits = [];
  for (const f of cssFiles()) {
    const src = readFileSync(join(dir, f), 'utf8');
    // 去掉注释再查，避免注释里的示例色值误报
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
    const m = code.match(/#[0-9a-fA-F]{6}\b/g);
    if (m) hits.push(`${f}: ${[...new Set(m)].join(' ')}`);
  }
  assert.deepEqual(hits, [], '硬编码 6 位色值（应改用 tokens 变量）：\n' + hits.join('\n'));
});

test('tokens.css 提供语义色三档（基色 + -bg 底 + -border 边框）', () => {
  const tok = readFileSync(join(dir, 'tokens.css'), 'utf8');
  for (const name of ['ok', 'warn', 'danger']) {
    assert.ok(new RegExp('--' + name + ':\\s*#').test(tok), `缺 --${name} 基色`);
    assert.ok(new RegExp('--' + name + '-bg:\\s*rgba').test(tok), `缺 --${name}-bg 底档`);
    assert.ok(new RegExp('--' + name + '-border:\\s*rgba').test(tok), `缺 --${name}-border 边框档`);
  }
});

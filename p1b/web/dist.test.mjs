import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const assetsDirPath = join(dirname(fileURLToPath(new URL('./dist/x', import.meta.url))), 'assets');

test('dist 已构建且产物非空（防空集假通过）', () => {
  assert.ok(existsSync(assetsDirPath), 'dist/assets 不存在——先跑 vite build');
  const js = readdirSync(assetsDirPath).filter((f) => f.endsWith('.js'));
  const css = readdirSync(assetsDirPath).filter((f) => f.endsWith('.css'));
  assert.ok(js.length > 0, 'dist/assets 无 js——空集会让后续断言假通过');
  assert.ok(css.length > 0, 'dist/assets 无 css——空集会让后续断言假通过');
});

test('dist 无「预测」字样（铁律①）', () => {
  const files = readdirSync(assetsDirPath).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const s = readFileSync(join(assetsDirPath, f), 'utf8');
    assert.equal(s.includes('预测'), false, f + ' 含「预测」');
  }
});

/** 构建会把中文转成 \uXXXX 转义序列，断言前须解码（否则假阴性） */
function decodeEsc(s) {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

test('dist 保留不确定性文案（未为「好懂」而隐藏）', () => {
  const files = readdirSync(assetsDirPath).filter((f) => f.endsWith('.js'));
  const all = decodeEsc(files.map((f) => readFileSync(join(assetsDirPath, f), 'utf8')).join(''));
  assert.ok(all.includes('样本不足'), '「样本不足」丢失');
  assert.ok(all.includes('基率'), '专业术语被删');
});

test('dist 含术语机制与观测台底纹', () => {
  const files = readdirSync(assetsDirPath).filter((f) => f.endsWith('.js'));
  const js = files.map((f) => readFileSync(join(assetsDirPath, f), 'utf8')).join('');
  assert.ok(js.includes('ui-term'), '术语组件未进包');
  const cssFiles = readdirSync(assetsDirPath).filter((f) => f.endsWith('.css'));
  const css = cssFiles.map((f) => readFileSync(join(assetsDirPath, f), 'utf8')).join('');
  assert.ok(css.includes('--grid-line'), '观测台底纹令牌未进包');
  assert.ok(css.includes('ui-drawer'), '术语抽屉样式未进包');
});

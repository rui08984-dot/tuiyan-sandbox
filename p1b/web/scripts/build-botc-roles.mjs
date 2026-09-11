/**
 * build-botc-roles.mjs —— B4 角色静态快照生成器（一次性数据管线，改动角色数据后重跑）。
 *
 * 源：docs/sandbox/botc-adapt/data/roles-zh.json（S1 交付，130 角色归一化数据，唯一数据源）
 * 出：p1b/web/src/botc/roles.json（前端精简快照：id/name_zh/name_en/team/editions/ability_zh/unique_note）
 *
 * 快照文件头带 _comment 注记「生成自 … 勿手改」；手改会被下次重跑覆盖。
 * 用法：node scripts/build-botc-roles.mjs（在 p1b/web 目录下）
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '..', '..', '..', 'docs', 'sandbox', 'botc-adapt', 'data', 'roles-zh.json');
const OUT = resolve(here, '..', 'src', 'botc', 'roles.json');

const raw = JSON.parse(readFileSync(SRC, 'utf8'));
if (!Array.isArray(raw) || raw.length === 0) {
  throw new Error('角色数据为空或非数组: ' + SRC);
}

const roles = raw.map((r) => ({
  id: String(r.id),
  name_zh: r.name_zh ?? '',
  name_en: r.name_en ?? '',
  team: String(r.team),
  editions: Array.isArray(r.editions) ? r.editions.map(String) : [],
  ability_zh: r.ability_zh ?? r.ability_en ?? '',
  unique_note: r.unique_note ?? '',
}));

const snapshot = {
  _comment: '生成自 docs/sandbox/botc-adapt/data/roles-zh.json 勿手改（p1b/web/scripts/build-botc-roles.mjs）',
  source: 'docs/sandbox/botc-adapt/data/roles-zh.json',
  generated_at: new Date().toISOString(),
  count: roles.length,
  roles,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
console.log('OK roles snapshot: ' + OUT + ' (' + roles.length + ' roles)');

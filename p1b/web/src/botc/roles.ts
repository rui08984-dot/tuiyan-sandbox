/**
 * BOTC 前端角色数据层（B4）—— 只读 build-botc-roles.mjs 生成的静态快照
 * （src/botc/roles.json 文件头注记「勿手改」；角色数据更新后重跑生成脚本）。
 *
 * 三本剧本 = tb 暗流涌动 / bmr 黯月初升 / snv 梦殒春宵（BRIEFS 拍板三本一起）。
 * 角色解析三口径对齐 p1b/src/botc/roles.js：id 精确 → name_zh 精确 →
 * name_en 大小写不敏感 → id 大小写不敏感（实验角色 mephit 无中文名回落英文）。
 */
import snapshot from './roles.json';
import type { BotcScript } from '../types';

export interface BotcRole {
  id: string;
  name_zh: string;
  name_en: string;
  team: string;
  editions: string[];
  ability_zh: string;
  unique_note: string;
}

const ALL: BotcRole[] = snapshot.roles as BotcRole[];

/** 剧本中文名 + 英文缩写（新建局抽屉选项 / 列表与详情徽章） */
export const SCRIPT_LABEL: Record<BotcScript, string> = {
  tb: '暗流涌动 TB',
  bmr: '黯月初升 BMR',
  snv: '梦殒春宵 SNV',
};
export const SCRIPT_NAME_EN: Record<BotcScript, string> = {
  tb: 'Trouble Brewing',
  bmr: 'Bad Moon Rising',
  snv: 'Sects & Violets',
};

/** 团队徽章文案（roles.json team 字段 → 中文） */
export const TEAM_LABEL: Record<string, string> = {
  townsfolk: '镇民',
  outsider: '外来者',
  minion: '爪牙',
  demon: '恶魔',
  traveller: '旅人',
  fabled: '传奇',
};
export function teamLabel(team: string): string {
  return TEAM_LABEL[team] ?? team;
}

export function isBotcScript(v: unknown): v is BotcScript {
  return v === 'tb' || v === 'bmr' || v === 'snv';
}

/** 本剧本全部角色（角色参考面板 / 宏角色建议） */
export function rolesByScript(script: BotcScript): BotcRole[] {
  return ALL.filter((r) => r.editions.includes(script));
}

/** 角色解析：id 精确 → name_zh 精确 → name_en 不敏感 → id 不敏感；未解析返回 null */
export function resolveBotcRole(input: string | null | undefined): BotcRole | null {
  const v = String(input ?? '').trim();
  if (v === '') return null;
  const lv = v.toLowerCase();
  return (
    ALL.find((r) => r.id === v)
    || ALL.find((r) => r.name_zh !== '' && r.name_zh === v)
    || ALL.find((r) => r.name_en !== '' && r.name_en.toLowerCase() === lv)
    || ALL.find((r) => r.id.toLowerCase() === lv)
    || null
  );
}

/** 角色类声称 object 的展示名：可解析 → 中文名（无中文名回落英文）；否则原文透显 */
export function botcRoleDisplay(object: string | null | undefined): string {
  const r = resolveBotcRole(object);
  return r ? (r.name_zh || r.name_en) : String(object ?? '');
}

'use strict';
/**
 * 局鉴 · src/kernel/botc/roles.js —— BOTC（血染钟楼）角色数据层访问器
 *
 * ★血统：从推演沙盘 `p1b/src/botc/roles.js` 平移而来，**数据源路径是唯一的改动点**——
 *   改为本项目自带的 `jujian/data/roles-zh.json`（逐字节同源，sha256 e9d56ba4…），
 *   其余逻辑一字未改。环境变量覆写口同步改名 `JUJIAN_BOTC_ROLES_PATH`
 *   （保留 `P1B_BOTC_ROLES_PATH` 旧名以兼容既有部署）。
 *   ⇒ `jujian/test/kernel-drift.test.cjs` 守卫「除本段外两版必须逐字节一致」。
 *
 * 数据源：jujian/data/roles-zh.json（130 角色归一化：
 * id/name_en/name_zh/team/editions/ability_en/ability_zh/first_night/other_night/
 * reminders/unique_note）。本模块只读该 JSON，零网络、零复制。
 *
 * 关键语义：
 *   - 剧本枚举 SCRIPTS = tb|bmr|snv（三本一起）。
 *   - 唯一角色由 unique_note 数据驱动：/^唯一/ 视为唯一（BOTC 常规角色每局唯一）；
 *     「非唯一（旅行者…）」按官方规则允许多座位同角色，不参与对跳。
 *   - 角色解析三口径：id 精确 / name_zh 精确 / name_en 大小写不敏感（实验角色
 *     mephit 无中文名，回落 name_en）。
 *   - ability 中文摘要访问器供判词注入使用。
 */
const fs = require('fs');
const path = require('path');

const SCRIPTS = ['tb', 'bmr', 'snv'];
const ROLES_PATH = process.env.JUJIAN_BOTC_ROLES_PATH
  || process.env.P1B_BOTC_ROLES_PATH
  || path.join(__dirname, '..', '..', '..', 'data', 'roles-zh.json');

let _roles = null;

/** 懒加载 + 缓存；文件缺失/坏 JSON 直接抛带路径的错（启动期可发现） */
function loadRoles() {
  if (_roles) return _roles;
  if (!fs.existsSync(ROLES_PATH)) {
    throw new Error('BOTC 角色数据不存在: ' + ROLES_PATH + '（S1 数据层未就位？）');
  }
  const raw = JSON.parse(fs.readFileSync(ROLES_PATH, 'utf8'));
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('BOTC 角色数据为空或非数组: ' + ROLES_PATH);
  }
  _roles = raw;
  return _roles;
}

/** 按剧本取角色集（editions 含该剧本的全部角色，含旅行者） */
function getRolesByEdition(edition) {
  if (!SCRIPTS.includes(edition)) return [];
  return loadRoles().filter((r) => Array.isArray(r.editions) && r.editions.includes(edition));
}

/** 按剧本取团队结构计数（数据驱动，不硬编码） */
function getTeamStructure(edition) {
  const out = {};
  for (const r of getRolesByEdition(edition)) out[r.team] = (out[r.team] || 0) + 1;
  return out;
}

/** 唯一性判定（unique_note 驱动：/^唯一/ = 每局唯一） */
function isUniqueRole(role) {
  return !!role && /^唯一/.test(String(role.unique_note || ''));
}

/** 按剧本取唯一角色 id 集合（对跳检测的账本） */
function getUniqueRoleIds(edition) {
  return new Set(getRolesByEdition(edition).filter(isUniqueRole).map((r) => r.id));
}

/** 角色解析：id 精确 → name_zh 精确 → name_en 大小写不敏感 → id 大小写不敏感；null 表示未知 */
function resolveRole(input) {
  const v = String(input === undefined || input === null ? '' : input).trim();
  if (!v) return null;
  const roles = loadRoles();
  let hit = roles.find((r) => r.id === v)
    || roles.find((r) => r.name_zh && r.name_zh === v)
    || roles.find((r) => r.name_en && r.name_en.toLowerCase() === v.toLowerCase());
  if (!hit) {
    const lv = v.toLowerCase();
    hit = roles.find((r) => r.id.toLowerCase() === lv);
  }
  return hit || null;
}

/** 角色是否属于某剧本（对越剧本声称校验用；editions 空数组=实验角色，任何剧本都不可用） */
function roleInEdition(role, edition) {
  return !!role && SCRIPTS.includes(edition)
    && Array.isArray(role.editions) && role.editions.includes(edition);
}

/** 中文显示名（mephit 无中文名回落英文） */
function roleNameZh(role) {
  return (role && (role.name_zh || role.name_en)) || '';
}

/** 能力中文摘要（B3 判词注入用；无中文回落英文） */
function abilityZh(role) {
  return (role && (role.ability_zh || role.ability_en)) || '';
}

/** 团队中文映射（数据 team 为英文枚举；未知值原样回落，数据驱动不抛错） */
const TEAM_ZH = {
  townsfolk: '镇民', outsider: '外来者', minion: '爪牙', demon: '恶魔', traveler: '旅行者',
};

function teamZh(team) {
  return TEAM_ZH[team] || String(team || '');
}

/** 角色一行简介（B3 判词注入用）：中文名（团队）：能力中文摘要 */
function roleBriefZh(role) {
  if (!role) return '';
  return roleNameZh(role) + '（' + teamZh(role.team) + '）：' + abilityZh(role);
}

module.exports = {
  SCRIPTS, ROLES_PATH, TEAM_ZH,
  loadRoles, getRolesByEdition, getTeamStructure, isUniqueRole,
  getUniqueRoleIds, resolveRole, roleInEdition, roleNameZh, abilityZh,
  teamZh, roleBriefZh,
};

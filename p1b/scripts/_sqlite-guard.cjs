'use strict';
/**
 * p1b/scripts/_sqlite-guard.cjs —— SQLite 连接「写意图」守卫。
 *
 * 来历（2026-09-13 合并迁移复盘）：本轮 8 次失败中有 2 次同一根因 ——
 * 把**只读连接**用在写路径上：
 *   ① gd2-0-accept 的 surface 构建：RO 主连接 ATTACH 建新文件 → SQLITE_CANTOPEN
 *   ② 回滚排演的事后探针：RO 连接插入 → SQLITE_READONLY（拿到的是"权限错"而不是
 *      想要的 "CHECK constraint failed"，等于**证据是错的**）
 * 该根因已用最小复现坐实（见 docs/assets/merged-migration/probe-readonly.cjs）：
 *   db.readonly === true  ⇔  ATTACH-create / INSERT 必失败
 * 守卫把「我以为它是可写连接」变成**显式、带原因的失败**，不再让它以
 * SQLITE_CANTOPEN / SQLITE_READONLY 的形式在别处隐式翻车。
 */
function assertWritable(conn, label) {
  if (!conn) throw new Error('assertWritable: 无连接（' + (label || '?') + '）');
  if (conn.readonly === true) {
    throw new Error('assertWritable: ' + (label || '?')
      + ' 拿到的是**只读连接**，写路径不可用（历史故障：RO 主连接 ATTACH 建文件 → SQLITE_CANTOPEN；RO 插入 → SQLITE_READONLY）');
  }
  return conn;
}
module.exports = { assertWritable };

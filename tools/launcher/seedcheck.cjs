'use strict';
/**
 * launcher/seedcheck.cjs —— 启动器第 ② 步的**校验那一半**：种子库拷到 .tmp 之后、rename 之前，
 * 跑一次 `PRAGMA integrity_check`。不过就不许落位。
 *
 * ★为什么非查不可：同卷 rename 只能保证「要么完整要么不存在」，**保证不了拷过来的东西是好的**
 *   （拷贝中断、磁盘满、杀软锁文件都会留下一个截断的库）。一个坏库被 rename 成 p1a.db 之后，
 *   后面每一次读都会炸，而那时人已经以为「装好了」。
 *   顺序是刻意的：拷 .tmp → 查 → rename。查完再落位 ⇒ 要么是一份好库，要么什么都没有。
 *
 * 用法：runtime\node\node.exe launcher\seedcheck.cjs "<.tmp 路径>"
 * 退出码：0 = ok ／ 1 = 校验不过（打印 integrity_check 的原话）／ 2 = 用法错／ 3 = 打不开
 *
 * ★只读打开：绝不给这个库开写权限——它是包里的种子，改了就等于篡改发行物。
 */

const fs = require('fs');

const p = process.argv[2];
if (!p) {
  process.stderr.write('用法：seedcheck.cjs "<db 路径>"\n');
  process.exit(2);
}
if (!fs.existsSync(p)) {
  process.stderr.write('[seedcheck] 文件不存在：' + p + '\n');
  process.exit(3);
}
let db;
try {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(p, { readOnly: true });
} catch (e) {
  process.stderr.write('[seedcheck] 打不开（多半是文件被截断了）：' + ((e && e.message) || e) + '\n');
  process.exit(3);
}
try {
  const r = db.prepare('PRAGMA integrity_check').get();
  const v = r && typeof r === 'object' ? (r.integrity_check !== undefined ? r.integrity_check : JSON.stringify(r)) : String(r);
  if (v === 'ok') {
    process.stdout.write('[seedcheck] integrity_check = ok（' + fs.statSync(p).size + ' 字节）\n');
    process.exit(0);
  }
  process.stderr.write('[seedcheck] integrity_check ≠ ok：' + v + '\n');
  process.exit(1);
} catch (e) {
  process.stderr.write('[seedcheck] 校验命令本身抛错：' + ((e && e.message) || e) + '\n');
  process.exit(1);
} finally {
  try { db.close(); } catch { /* 已关 */ }
}

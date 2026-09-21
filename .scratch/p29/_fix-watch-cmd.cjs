'use strict';
// 一次性工具：修 watch-task.cmd 的引号（运维书实锤坑：无引号 ⇒ cmd 劈成 "C:\Program" ⇒ 链路必死）
const fs = require('fs');
const P = 'E:/music player/.sessionrelay/watch-task.cmd';
let t = fs.readFileSync(P, 'utf8');
const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const SCRIPT = 'C:\\Users\\crx\\AppData\\Roaming\\npm\\node_modules\\@ewanjasper\\sessionrelay\\dist\\srelay.js';
const oldS = NODE + ' ' + SCRIPT;
const newS = '"' + NODE + '" "' + SCRIPT + '"';
if (t.indexOf(oldS) < 0) {
  console.error('未找到目标串');
  console.error('文件实际内容：');
  console.error(JSON.stringify(t));
  process.exit(2);
}
t = t.replace(oldS, newS);
fs.writeFileSync(P, t, 'utf8');
console.log('已加引号 ✓');
console.log('修后内容：');
console.log(t);
// 验证：控制字符扫描（运维书纪律：落盘验证须打印实际值+控制字符扫描）
const bad = [...t].filter((c) => c.charCodeAt(0) < 32 && c !== '\n' && c !== '\r');
console.log('控制字符扫描:', bad.length === 0 ? '干净 ✓' : ('发现 ' + bad.length + ' 个'));

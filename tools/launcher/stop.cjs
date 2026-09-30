'use strict';
/**
 * launcher/stop.cjs —— stop.bat 的 Node 半边：**停服务，保留数据**
 *
 * 做法：读数据目录里的 logs/server.pid（boot.cjs 启动时写的**它自己的** pid），
 * 发终止信号，然后轮询等它真的消失（不「发完就报成功」—— 端口没释放就是没停干净）。
 *
 * ★为什么不用端口反查 PID：netstat 那条路要解析多行 IPv4/IPv6 输出，脆；
 *   pid 文件是启动方自己写的，一对一，没有歧义。
 * ★pid 复用的已知风险（如实登记，不装看不见）：pid 文件长期留在盘上、而那个 pid
 *   又被别的程序捡去时，本脚本会杀掉不相干的进程。缓解＝停成功后立刻删 pid 文件，
 *   并且 boot.cjs 启动前会检查旧 pid 是否还活着。窗口内的正常使用碰不到这个。
 *
 * 退出码：
 *   0  停了，或本来就没在跑（★两种都算成功：「没在跑」不是错误）
 *   1  pid 文件在，但杀不掉（权限不足 / 那个 pid 已经不是本服务）
 *   2  缺 P1B_DATA_DIR
 *   3  停了但 10 秒内端口/进程没消失（部分成功，如实报，不假装干净）
 */

const fs = require('fs');
const path = require('path');

const 数据目录 = String(process.env.P1B_DATA_DIR || '').trim();
const 日志目录 = path.join(数据目录, 'logs');
const pid文件 = path.join(日志目录, 'server.pid');
const 停止标记 = path.join(日志目录, 'stop-request.flag');
const 库文件 = path.join(数据目录, 'p1a.db');
const 等待上限 = 10000;

const 说 = (s) => process.stdout.write(s + '\n');

function 活着(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === 'EPERM'; }
}

(async function 主流程() {
  if (!数据目录) {
    process.stderr.write('[stop] 缺 P1B_DATA_DIR（start.bat 一定会设；手跑本文件请自己设同一个值）\n');
    process.exit(2);
  }
  let pid = 0;
  try { pid = Number(String(fs.readFileSync(pid文件, 'utf8')).trim()); } catch { pid = 0; }
  if (!Number.isInteger(pid) || pid <= 0) {
    说('服务本来就没在跑（没有 pid 文件）：' + pid文件);
    说('数据保留在：' + 数据目录);
    process.exit(0);
  }
  if (!活着(pid)) {
    说('pid ' + pid + ' 已经不在了（多半是窗口被直接关掉了）；清掉陈旧 pid 文件。');
    try { fs.unlinkSync(pid文件); } catch { /* 已不在 */ }
    说('数据保留在：' + 数据目录);
    process.exit(0);
  }

  // ★先落「停止请求」标记再杀。
  //   为什么需要它：Windows 上 process.kill 走的是 TerminateProcess，**不执行任何信号处理**，
  //   被杀进程的退出码是 1 —— 与「启动崩了」在 start.bat 眼里一模一样。
  //   于是「我按了 stop.bat，它却报错」＝ 每次正常停止都吓用户一跳。
  //   有了这个标记，start.bat 能区分「按要求停的」与「自己崩的」。
  //   标记由 start.bat 读后删除；万一窗口被直接关掉没人删，下次启动时 boot.cjs 会清掉它
  //   （见 boot.cjs 挂启动日志后的清 pid 那段下方）。
  try { fs.writeFileSync(停止标记, new Date().toISOString(), 'utf8'); } catch { /* 写不了就退回旧行为 */ }

  try { process.kill(pid); 说('已向服务（pid ' + pid + '）发终止信号，等它退出…'); }
  catch (e) {
    process.stderr.write('[stop] 杀不掉 pid ' + pid + '：' + ((e && e.message) || e) + '\n');
    process.stderr.write('        兜底：任务管理器 → 结束 node.exe（数据不会丢）。\n');
    process.exit(1);
  }

  const 止 = Date.now() + 等待上限;
  while (Date.now() < 止) {
    if (!活着(pid)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  try { fs.unlinkSync(pid文件); } catch { /* 已不在 */ }
  if (活着(pid)) {
    process.stderr.write('[stop] 10 秒后 pid ' + pid + ' 还在（可能被别的程序顶了号，或它正在写库不愿立刻退）。\n');
    process.stderr.write('        数据仍在，不会损坏；想强制结束就任务管理器里结束它。\n');
    process.exit(3);
  }
  说('服务已停。');
  try { 说('账本保留：' + 库文件 + '（' + (fs.statSync(库文件).size / 1048576).toFixed(2) + ' MB）'); } catch { 说('账本保留：' + 库文件); }
  process.exit(0);
})();

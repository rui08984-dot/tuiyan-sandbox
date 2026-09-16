#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/metaculus-token-check.cjs —— Metaculus token 接入检查（任务 10 步骤 1 · 2026-09-16）
 *
 * 背景：此前勘察「免 key 通道全封」——2026-09-16 复核实测：`/api2/questions/` 无 token 返回
 *   403「The API is only available to authenticated users…use your API token」。⇒ P4 方案复活的前置＝申请 token。
 * 本件做三件事（**零写库、零落盘、token 绝不出现在任何输出/日志**）：
 *   ① 检查 gitignored 配置文件是否存在（默认 `p1a-terminal/config/metaculus.json`，可用 env `METACULUS_TOKEN_FILE` 覆盖）；
 *   ② 若存在：只回显**脱敏** token（前 3 后 2 ＋ 长度），不发明文；
 *   ③ 若存在：带 token 探一次 API，回报状态（200=生效；401/403=无效或权限不足）。
 * 用法：node p1b/scripts/metaculus-token-check.cjs [--no-probe]
 * 退出码：0=检查完成（含「未配置」情形）；2=配置存在但读取/解析失败；3=探测失败。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const NO_PROBE = process.argv.indexOf('--no-probe') !== -1;
const CFG = process.env.METACULUS_TOKEN_FILE || path.join(ROOT, 'p1a-terminal', 'config', 'metaculus.json');
const API = 'https://www.metaculus.com/api2/questions/?limit=1';

function mask(t) { const s = String(t || ''); return s.length <= 6 ? '***' : s.slice(0, 3) + '***' + s.slice(-2) + '（len=' + s.length + '）'; }

(async () => {
  console.log('=== Metaculus token 检查（零写库；token 不出明文）===');
  console.log('配置路径: ' + CFG + '（gitignored 目录：p1a-terminal/config/）');
  if (!fs.existsSync(CFG)) {
    console.log('状态: 未配置（n/a）——申请路径：metaculus.com 账号 → Account Settings → API token；');
    console.log('      落盘格式示例（该行**不要**写进任何仓库文件）：{"token":"<你的 token>"}');
    process.exitCode = 0; return;
  }
  let cfg = null;
  try { cfg = JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch (e) { console.log('状态: 配置存在但解析失败 —— ' + e.message); process.exitCode = 2; return; }
  const tok = cfg && (cfg.token || cfg.api_token || cfg.METACULUS_TOKEN);
  if (!tok) { console.log('状态: 配置存在但无 token 字段（期望 token/api_token/METACULUS_TOKEN）'); process.exitCode = 2; return; }
  console.log('token: ' + mask(tok));
  if (NO_PROBE) { console.log('探测: 跳过（--no-probe）'); return; }
  try {
    const r = await fetch(API, { headers: { Authorization: 'Token ' + tok }, signal: AbortSignal.timeout(15000) });
    console.log('探测: HTTP ' + r.status + (r.ok ? ' ⇒ token 生效' : ' ⇒ 无效或权限不足（申请后请复核账号状态）'));
    const body = await r.text();
    const kind = body.slice(0, 120).replace(/\s+/g, ' ');
    if (!r.ok) console.log('      响应头 200 字: ' + kind);
    process.exitCode = r.ok ? 0 : 3;
  } catch (e) { console.log('探测: 失败 —— ' + e.message); process.exitCode = 3; }
})();

'use strict';
// 一次性：给坑总表第八节追加 3 条（2026-09-21 实测）——用文件方式避开 bash 反引号
const fs = require('fs');
const P = 'C:/Users/crx/.zcode/cli/memories/projects/music-player-7d1623ec4df6adfd/memory/sandbox-env-gotchas.md';
const BQ = String.fromCharCode(96);   // 反引号
let t = fs.readFileSync(P, 'utf8');
const anchor = '判「存在/有料/真有权重」的三级证据：URL 200／' + BQ + '/contents' + BQ + ' 有真代码或权重／' + BQ + 'HF api/models/<o>/<n>?blobs=true' + BQ + ' 给**文件字节数**。';
if (t.indexOf(anchor) < 0) { console.log('★锚未找到'); process.exit(1); }
const add = [
  '',
  '- **★代理坑：本机代理常不在运行 ⇒ 设了 ' + BQ + 'HTTPS_PROXY' + BQ + ' 反而全域失败**〔有疤有闸·2026-09-21 实测〕：跑结算 daemon 时按记忆设 ' + BQ + 'NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7897' + BQ + ' ⇒ **全域 fetch-fail**（代理未监听 ⇒ 所有请求走死代理）。撤掉后重跑 ⇒ eurostat/frankfurter/dlt **直连 200**。**纪律：设代理前先探端口**（' + BQ + 'curl -x http://127.0.0.1:<port>' + BQ + ' 实测；本次 7897/7890/10809/1080 **全不通**）。**默认姿势＝直连**，只在实测确认代理活着且该源确实需要时才设。',
  '- **★反爬的两种形态（处置完全不同）**〔有疤有闸·2026-09-21 实测〕：①**应用层 UA 检查**——' + BQ + 'sporttery' + BQ + '（体彩）对「浏览器 UA」要求完整浏览器头上下文：**裸浏览器 UA ⇒ HTTP 567**，**加 ' + BQ + 'Referer' + BQ + ' ⇒ 200**，**非浏览器 UA（' + BQ + 'curl/8.0' + BQ + '）⇒ 200**；本项目 daemon L74 强制注入浏览器 UA ⇒ 恰好踩中（dlt 域 **38/38 全未解**）。**修法＝resolver 显式传 Referer**（最小改动）②**网关/IP 地域封禁**——' + BQ + 'data.cityofchicago.org' + BQ + '／' + BQ + 'data.elexon.co.uk' + BQ + ' 连**站点首页／' + BQ + '/health' + BQ + '** 都 403（elexon 响应体含 ' + BQ + 'Microsoft-Azure-Application-Gateway/v2' + BQ + '），换任何 headers 无效，**跨站点**（另一 Socrata 站 seattle 也 403）⇒ 本机 IP（Beijing CN）被拦，**代码无法解决**。**判据：curl 默认 UA 也 403 ⇒ ②；curl 通而 daemon 不通 ⇒ ①**。',
  '- **★诊断网络问题必须设对照组**〔有疤有闸·2026-09-21〕：判「是不是本机网络坏了」要同时测**已知可用站点**（github/crossref 200 ⇒ 本机正常，是特定站点拦）；判「是不是 headers 问题」要跑**逐项矩阵**（UA／+Referer／+Origin／非浏览器 UA 四组）。单测一个 URL 就下结论＝易错。',
].join('\n');
t = t.replace(anchor, anchor + add);
fs.writeFileSync(P, t, 'utf8');
console.log('坑总表已更新（+3 条）');

# P1b-5 集成实测报告（2026-09-08 · 收尾棒）

环境：后端 node p1b/src/server.js @0.0.0.0:8787（PID 6068，测毕已停）；共享库 p1a-terminal/data/p1a.db；
LLM 真实配置（/api/health llm_mock=false）；前端 dist 静态托管；真浏览器 = Chrome headless CDP :9223（复用同任务链遗留测试实例，测毕已停并注明）。
驱动：p5-drive.mjs（零依赖 CDP，390x844 + iPhone 移动 UA 全程），日志 p5-drive-log.txt。

## 全链步骤表

| # | 步骤 | 结果 | 证据 |
|---|---|---|---|
| S0 | 移动 UA + 390x844 视口 + 前端可达 | PASS | S0a/S0b/S0c OK |
| S1 | 建局 8 人局（改真名 张三/李四） | PASS | game **#6**；服务端回读 1=张三 3=李四 |
| S2 | 录入页顶部条/名单横条（真名跨页） | PASS | S2a/S2b OK；p5-entry-mobile-390.png |
| S2 | 自由文本 → **真实 LLM** 抽取（12s）→ 确认入账 | PASS | 无 MOCK 徽标；raw 原文入时间线 |
| S3 | 3 宏各一条（跳身份/查杀/金水，确认卡复核） | PASS | 时间线见 c19/c20/c21 宏徽标 |
| S4 | 事件流最新在上 | PASS | 首条=金水（最后录入），时序断言 OK |
| S5 | 天结算 → 202 → 生成中横幅 → 3s 轮询 | PASS（提交/轮询链路） | taskId adv-mtskxals-1-1xwqi |
| S5x | 参谋卡 LLM 生成 | **FAILED → 合规回退** | 121s 后 failed：429→504→504；按任务书改用 game1 服务端存档历史卡完成看卡（已如实注明，未造假） |
| S6 | 看卡：卡头/矛盾区+欠定度色标（high 红）/竞争假设**双栏对峙**（390px 几何断言）/验证点区渲染 | PASS | S6a-S6f OK；p5-card-mobile-390.png |
| S7 | 历史卡按天回看（chip 重开） | PASS | S7a/S7b OK |
| S8 | 导出 JSON（UI toast + 文件落盘 + 服务端一致） | PASS | p5-export-game-6.json：4 事件/5 声称/0 行动 |
| S9 | 响应式截图 390/1280 两档关键页 | PASS | 7 张 p5-*.png（对局/录入/卡片） |

## 局域网可达性

- netstat：TCP 0.0.0.0:8787 LISTENING（PID 6068=node src/server.js）✓
- 本机 LAN IP（ipconfig 实测，Intel Wi-Fi 6E AX211 / WLAN）：**10.38.23.183**；其余 26.68.126.72(Radmin VPN)/172.26.208.1(WSL)/198.18.0.1(Mihomo) 非手机目标
- curl http://10.38.23.183:8787/api/health → HTTP 200（注意：本机自连不穿越防火墙入站规则，不等于手机可达）
- 防火墙（只查未改）：**无任何 8787 规则**，三档全 ON，WLAN=Public 类别 → 手机直连大概率被拦；
  手动放行命令（管理员 PowerShell）与回滚见 p5-手机实测指引.md

## 产物清单（p5- 前缀，docs/sandbox/p1b/itest/）

p5-drive.mjs / p5-drive-log.txt / p5-server-log.txt / p5-server-err.txt /
p5-games-mobile-390.png / p5-entry-mobile-390.png / p5-card-mobile-390.png / p5-advisor-archive-mobile-390.png /
p5-games-desktop-1280.png / p5-entry-desktop-1280.png / p5-card-desktop-1280.png /
p5-advise-task-final.json / p5-export-game-6.json / p5-手机实测指引.md / 本报告

## 遗留问题（只记录，未改动任何受限路径）

1. **advise 上游不稳**（本轮 429+504×2；P1b-4 亦 504×2）：cards 生成链路对中转可用性敏感。抽取链路本轮真实 LLM 12s 稳定。建议：换稳定中转或增加引擎级退避重试（任务书限定不改 p1b/src，未动）。
2. **验证点 checklist 勾选交互本轮未覆盖**：服务端存档卡验证点不入库（既定语义），localStorage 兜底卡（game2）被服务端卡遮蔽且无 .cp-item。该交互在 P1b-4 验收（p4-checks.mjs G2/G3）已证，本轮环境性缺卡。
3. 防火墙需用户手动放行（命令已写指引）后真机抽查。
4. 清场说明：已停 测试后端(PID 6068) 与测试 chrome(PID 33168，前棒遗留 CDP 实例，temp profile cdp-profile-p1b3，杀前已复核 PID 归属)；9223/8787 释放。

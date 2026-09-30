# Spec: packaging · 绿色 zip 与三个启动器

> 能力地图模块 id `packaging` · 依赖：`release-gate` · `deps-fix` · `runtime-paths` · 规模 2.5 人日
> **这是「陌生人双击就能用」那一步。** 前面所有工作都靠它才能被外面的人看到。

## Objective

写一个打包脚本，产出一棵**解压即用**的目录树：双击 `start.bat`，浏览器自己打开工作台。

**给谁用**：一个不会 `npm install`、机器上可能根本没装 Node 的人。
**成功的样子**：解压到**含空格与中文**的路径（`C:\测试 空格\路径\`），双击，浏览器自动打开 `http://127.0.0.1:8787/`。

## Commands

```bash
node tools/pack.mjs                      # 产出到 out/p1b-sandbox-v0.1.0-win-x64/
node tools/pack.mjs --check              # 只体检不产出（跑 audit-release C1–C14）
```

## Project Structure

```
tools/pack.mjs                 ← 本模块主文件
tools/pack.test.mjs            ← 新建
out/p1b-sandbox-v0.1.0-win-x64/  ← 产物（gitignore）
├─ start.bat                   ← 启动器（八步时序）
├─ README.md                   ← 极简上手（正式 README 在根，另有归属）
├─ runtime/node.exe            ← 便携 Node（唯一二进制）
├─ app/
│  ├─ p1a-terminal/{src,node_modules/better-sqlite3,config/providers.template.json}
│  ├─ p1b/{src,cli,mcp,gates,skill,scripts,web/dist}
│  └─ node_modules/            ← 4 个运行时依赖
└─ seed/{p1a-seed.db,seed_provenance.json}
```

## Code Style

零新依赖（打包脚本只用 Node 内置 ＋ 已有的 `@vercel/nft`，若它不可用则退回手工清单）。
产物目录里**不许有 `.git`、不许有 `node_modules` 之外的大件**。

## Testing Strategy

★**本模块的验收是「真跑」，不是「断言写对了」**：

1. **A1**：把产物解压到临时目录 → 双击（= `start.bat` 传一个不启动浏览器的开关）→ `/api/health` 返回 200
2. **A1b**：★**解压到含空格与中文的路径**再跑（bat 是 shell，不加引号会断——这是方案点名的坑）
3. **A2**：`/api/health` 的 `web_built === true`、`db_path` 落在数据目录而不是 app 目录
4. **A9/A10**：`node p1b/cli/index.cjs 体检 看板` / `体检 跑批` 退出码 0（★覆盖 `deps-fix`）
5. **发行闸**：`node p1b/scripts/audit-release.cjs --tree <产物>` ⇒ **14 项全绿**
6. **反向锁**：往产物里塞一个 `config/providers.json` ⇒ C1 必须红

## Boundaries

- **Always**：产物里**绝不含** `config/*.json`（只放 `.template.json`）、绝不含 `*.db`（除种子库）、绝不含 `*.db-wal`/`*.db-shm`
- **Ask first**：换便携 Node 的版本；改种子库
- **Never**：把 `p1a-terminal/data/` 整目录打进包（14.2 MB，含生产库与旧备份）；让启动器依赖任何环境变量才���跑

## ★启动器八步时序（可用的注入点已全部存在，0 行新后端代码）

```
① 解析数据目录   DATA = %P1B_DATA_DIR% 或 %LOCALAPPDATA%\P1bSandbox\
   ├─ 不存在 → mkdir -p $DATA\config $DATA\backups $DATA\logs
   └─ 失败（无权限/路径含中文与空格）→ 打印可读错误 ＋ 退出码 3
② 种子库（仅当 $DATA\p1a.db 不存在）
   ├─ 复制 seed/p1a-seed.db → $DATA/p1a.db.tmp
   ├─ 校验 PRAGMA integrity_check = ok
   ├─ ★再 rename（同卷 rename 是原子的 ⇒ 要么完整要么不存在）
   └─ 写 seed-copied 时间戳（幂等标记）
③ 配置模板（仅当 providers.json 不存在）→ 复制 .template.json，★不含任何 key
④ 环境变量注入（不碰任何源码）
   P1B_DB_PATH / P1B_PROVIDERS_PATH / PORT=8787（被占则探测 3 次）
   ★P1B_LLM_MOCK=1   首启强制 mock
⑤ 起服务器   runtime\node.exe app/p1b/src/server.js
⑥ 健康检查   轮询 http://127.0.0.1:PORT/api/health，最多 30 秒
   └─ 超时 → 打印 $DATA\logs\startup.log 路径，退出码 5
⑦ 打开浏览器 start "" http://127.0.0.1:PORT/
⑧ 首启横幅   数据目录 / 账本行数 / 当前 provider / mock 状态 / 停止方法
```

**★首启 `P1B_LLM_MOCK=1` 的理由**：陌生人没有 key。若不 mock，`p1a-terminal/src/llm.js` 的 LIVE 路径会因无 key 抛错。
首启强制 mock = 打开就能看到全部只读功能，**不撞任何墙**。用户在设置页填了 key 后，下次启动检测到有非空 key 则自动退出 mock。
**启动器必须在横幅里明确打印当前是 LIVE 还是 MOCK**（`server.js` 已有这行，保留即可）。

## ★体积账（为什么不是 Electron）

| 组件 | 大小 |
|---|---:|
| `p1a-terminal/src`（6 文件） | 145 KB |
| `p1b/src`（71 文件） | 740 KB |
| `p1b/cli` / `mcp` / `gates` | 105 KB |
| `p1b/web/dist` | 711 KB |
| 4 个运行时依赖 | 3.86 MB |
| better-sqlite3 单平台 prebuild | 2.0 MB |
| **应用小计（不含便携 Node）** | **≈ 13.8 MB** |

对比今天的完整 checkout：**165 MB**（p1a 26.4 ＋ p1b 14.8 ＋ web 73.2 ＋ sim 40 ＋ test 7.9）。
**省掉的是 vite/typescript/react 开发依赖**——构建期用，运行时不需要。
**这 165 MB 本身就是「陌生人会不会被劝退」的第一顺位解释。**

**Electron 44 空壳 release zip 已 ≥ 150.9 MB**（未含任何你的代码）⇒ 对它唯一的真实价值是
「陌生人双击就能用」这个感知，而绿色 zip 已经拿到了同样的感知，且零 Electron 依赖。**不做 Electron。**

## ★三个启动器

`start.bat`（主）／`start-debug.bat`（不关窗口，退出码可见）／`stop.bat`（停服 ＋ 保留数据）。
★**bat 是 shell**：路径含空格必须加引号，**中文路径要 `chcp 65001`**。方案 A1b 点名的坑在这里。

## Success Criteria

- [ ] `node tools/pack.mjs` 产出一棵可解压即用的树；`--check` 只体检不产出
- [ ] **A1**：解压 → 启动 → `/api/health` 200（真跑，不是断言）
- [ ] **A1b**：★解压到**含空格与中文**的路径再跑，同样通
- [ ] `web_built === true`；`db_path` 落在数据目录，**不是 app 目录**
- [ ] **A9/A10**：产物里 `体检 看板` / `体检 跑批` 退出码 0
- [ ] 发行闸 **14 项全绿**
- [ ] **反向锁**：产物里塞 `config/providers.json` ⇒ C1 红
- [ ] 产物体积 < 12 MB（不含便携 Node）——C6 判的就是这个
- [ ] 产物里**零** `config/*.json`、`*.db-wal`、`*.db-shm`、`.git`、`.env`
- [ ] 首启走 mock；填 key 后重启横幅显示 LIVE
- [ ] 四道闸门 exit 0

## Open Questions

- **便携 Node 从哪来**？本机 `node.exe` 直接拷，还是下载官方 zip？后者要联网且要校验 sha256——
  **本项目「零新依赖＋零外呼」的服务端纪律到打包这一步可能要让步**，需要拍板。
- 三个平台（win/mac/linux）还是只做 Windows？本轮只做 win-x64，另外两个归 P2。

## 【勘误 1 · 2026-09-29】锚点审计报 9 项「失效」属预期

`tools/pack.mjs`、`tools/pack.test.mjs`、`out/` 下的产物目录、`seed/p1a-seed.db`
（被 `.gitignore` 挡住、本就不在盘）都是本模块**新建／产物**，尚未创建；
`runtime/node.exe` 是**打包时装进去的**，仓库里本来就不该有。
★**这不是断链，是「还没建」**。（另 12 项锚点是真实存在的文件与命令，已判绿。）

## 【勘误 2 · 2026-09-29】★便携 Node 的来源是**本轮唯一需要创始人拍板**的点

`runtime/node.exe` 从哪来，两条路各有代价：

| 方案 | 代价 |
|---|---|
| **拷本机的 `node.exe`** | 零外呼、不出网、体积 89 MB。代价：**它绑死了本机这个 Node 版本**，且它是某个已安装的产物——拷它的**再分发权**需要确认 |
| **下载官方 zip 并校验 sha256** | 版本可控、体积 35.88 MB 压缩包。代价：**要联网**，而本项目的服务端纪律是「零外呼、不联网」——到打包这一步要明确让步 |

★**本 spec 不替这个决定拍板。** 施工时按「拷本机 node.exe ＋ 在 README 写清版本」推进，
并在 `landmines` 里显式登记「再分发权未确认」这一条。

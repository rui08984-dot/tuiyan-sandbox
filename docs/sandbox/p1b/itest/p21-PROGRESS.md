# p21 进度锚 —— UI 通用化改造：游戏类型动态化（后端驱动）

- 日期：2026-09-13 ｜ 状态：**收口（验收门全过）** ｜ 端口：隔离 :8794（8787 零接触）
- 任务书：`E:/music player` ｜「游戏类型不再硬编码，改后端 `GET /api/adapters` 驱动」

## 1. 问题（施工前实锤）
前端类型名硬编码 4 处，阿瓦隆适配器（`p1b/src/adapters/avalon.js`，681 行）UI 不认：
| 文件 | 行 | 内容 |
|---|---|---|
| `web/src/components/NewGameWizardSteps.tsx` | 6 | `TYPE_LABEL`（狼人杀/血染钟楼/剧本） |
| `web/src/pages/ManagePage.tsx` | 11 | 同上 |
| `web/src/pages/manage/GameDetail.tsx` | 10 | 同上 |
| `web/src/components/input/TopBar.tsx` | 30 | 同上（TopBar + GameSheet 两处下拉） |
后端 `p1b/src/util.js:8` `GAME_TYPES=['werewolf','botc','script']`，建局 400 拒 avalon。

## 2. 改动文件（新增 4 / 修改 6）
**新增**
- `p1b/src/routes/adapters.js`（2899B）— register 风格端点 `GET /api/adapters`：BUILTIN(3) + 扫 `src/adapters/*.js`（只读 require，认 ADAPTER_ID + 五方法契约；失败/缺方法如实 ready:false+missing，禁编造）
- `p1b/web/src/lib/adapters.ts`（2603B）— 前端拉取 + 形状校验 + FALLBACK_TYPES 降级 + 模块级缓存 + `typeLabel()`
- `p1b/web/src/lib/useGameTypes.ts`（825B）— React 绑定；初值恒 FALLBACK（首帧不空）
- `docs/sandbox/p1b/itest/p21-e2e.mjs`（8631B）— 隔离实例 + headless Edge CDP 端到端实测

**修改**
- `p1b/src/server.js` 75 行 — 注册 adapters 路由（照 audit.js 同句风格）
- `p1b/src/routes/games.js` 12/38-46/73 行 — 建局类型枚举改为 `GAME_TYPES ∪ adapters 登记 id`（`allowedGameTypes()`），否则下拉选了阿瓦隆建局必 400
- `p1b/web/src/api.ts` — 新增 `listAdapters()`（mock 分支齐）
- `p1b/web/src/mock.ts` — mock `listAdapters()`
- `p1b/web/src/types.ts` — `GameType = string`（登记表驱动）+ `AdapterInfo` 接口
- 4 个前端页面/组件 — 删 `TYPE_LABEL`，改 `useGameTypes()` 的 `typeLabel()` / `types.map()`

## 3. /api/adapters 实测输出（真 HTTP，隔离 :8794）
```json
[{"id":"werewolf","name":"狼人杀","kind":"engine","ready":true,"source":"p1a-terminal 原生引擎"},
 {"id":"botc","name":"血染钟楼","kind":"engine","ready":true,"source":"p1b/src/botc（只登记）"},
 {"id":"script","name":"剧本","kind":"script","ready":true,"source":"内置文本类型"},
 {"id":"avalon","name":"阿瓦隆","kind":"adapter","ready":true,"source":"adapters/avalon.js",
  "layer":"L6","checklist":"avalon-v1","contract":"5/5"}]
```
落盘：`itest/p21-api-adapters.json`

## 4. 验收门（全部实测，证据在位）
| 门 | 结果 | 证据 |
|---|---|---|
| `node --check` 后端 | OK ×3 | adapters.js / games.js / server.js |
| `npm.cmd run build`（p1b/web） | **exitCode 0**，78 modules，index-DIeIuPwW.js 280.71kB | `itest/p21-build-out.txt` |
| 起服实测 /api/adapters 含 avalon | HTTP 200，4 项，avalon ready=true | `itest/p21-api-adapters.json` |
| 向导下拉 4 项 | `[狼人杀, 血染钟楼, 剧本, 阿瓦隆]`（vals werewolf/botc/script/avalon） | `itest/p21-e2e-out.txt` |
| 降级（网络层阻断 /api/adapters） | 下拉回落 3 项、页面非空白 | 同上（Network.setBlockedURLs，blockedN=1） |
| 回归 `node --test` | 174 pass / 0 fail | p1b/test |
| UI 无「预测」字样 | OK（body innerText 全扫） | `itest/p21-ui-text.txt` |
| 建局契约 | POST type=avalon → **201**；type=nope → 400 且枚举含 avalon；werewolf → 201 | 见第 5 节 |
| 硬约束 | botc 五文件 mtime 全为 9/9（零改动，只 require）；p1a-terminal/meihua/8787/providers.json 未触碰 | 见第 5 节 |

## 5. 关键补充实证
- 建局：`POST /api/games {type:'avalon'}` → 201；非法 `nope` → `400 game_type 必须是 werewolf|botc|script|avalon`。
- **已知边界（如实报）**：阿瓦隆目前只到「可建局 + UI 可选」，适配器五方法 `listOpenQuestions/resolveQuestion/featurePack/baseline/exposure` 已就位（contract 5/5）但**尚未接进赛事流程链**（判题/入账仍走 werewolf/botc 路径）；且阿瓦隆语料未入库（适配器自带内存 fixture）。
- 硬约束核对：`p1b/src/botc/` 五文件 LastWriteTime 全为 2026/9/9（本棒仅 `routes/adapters.js` 只读 require，未改本体）。

## 6. 复现命令
```powershell
cd 'E:\music player'
node --check p1b\src\routes\adapters.js; node --check p1b\src\routes\games.js; node --check p1b\src\server.js
cd p1b\web; npm.cmd run build
cd ..\..\docs\sandbox\p1b\itest; node p21-e2e.mjs     # 起 :8794 + headless Edge，全断言 OK EXIT=0
```
## 7. 勘误与精确化（施工后自查）
- 第 4 节「p1a-terminal 未触碰」精确化：本棒对 `p1a-terminal/` **源码零改动**；目录内近 1h 有改动的是 `data/p1a.db(+-wal/-shm)`，系**常驻 8787 服务自身**的 WAL 写入（本棒全部实测用 `P1B_DB_PATH` 指向 `:memory:` 或 `itest/p21.db`，端口用 :8794，未连 8787）。`meihua.js` mtime 仍 09-07，零改动。
- 残留「狼人杀」字面量 3 处，**均属设计内**：`lib/adapters.ts:14` = 降级基线 FALLBACK_TYPES（任务书要求）；`mock.ts:243` = `VITE_USE_MOCK=1` 假接口；`mock.ts:61` = 既有示例局演示数据（与本棒无关）。UI 渲染路径已 100% 走后端登记表。
- 本棒踩坑记录（供续作者）：① 用 `-replace` 做代码改写会按正则解释 `$1`/`\` → 改用 split/join 纯文本替换；② 按「首个匹配行」插代码时若写成 `$lines[0..$i]+$new+$lines[($i+1)..]` 再叠 -replace 会误插到文件尾 → 一律按行号直改 + 改后 node --check + 打印尾部核对；③ 前端 tsc 严格模式下 hook 必须放在**使用它的组件函数内**（TopBar / GameSheet 是两个函数，各自取一份）。
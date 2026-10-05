# 局鉴 · 分发（npm 包与 MCP 注册表）

> 这份文档给**要发版的人**看，不是给用户看的。
> 它记的是「发出去」这一步独有的坑 —— 本地全绿也挡不住的那一类。

---

## 一、npm 包

### 发什么

`package.json` 的 `files` 白名单**显式枚举**（不许通配，`test/package.test.cjs` ⑤ 守着）：

```
.gitattributes  LICENSE  README.md  bin  bench  data/roles-zh.json
docs  gates  scripts  src  test  web
```

★ 三个容易搞错的地方，每一条都被真实事故逼出来过：

| 条目 | 为什么必须在 | 曾经怎么坏的 |
|---|---|---|
| `web/` | HTTP 服务从 `web/` 读页面与静态资源 | 漏了它 ⇒ 装完前端四屏全 404，而命令行一切正常，「看起来装好了」 |
| `bench/` | `bin/jujian-bench.cjs` require `../bench/run-bench.cjs` | 漏了它 ⇒ 三个入口有一个一跑就 `MODULE_NOT_FOUND` |
| `web/package.json` + `.gitattributes` | `test/render.test.cjs` 的动态 `import` 要前者；`test/readme.test.cjs` ⑭ 要后者 | 排掉它们（"构建标记不该外发"是个**想当然**）⇒ **发行树里跑测试 7 条红** |

★ 最后一条是这份文档最该被记住的：**「发出去的那份自己是不是绿的」比「少发两个小文件」重要得多。**
两个标记文件各几百字节，缺了它们，别人 `npm i jujian` 之后跑 `npm test` 是红的。

### 反向：什么不许进包

- **运行期库文件**：`data/*.db` 是**玩家自己的对局**（谁在第几号位、说了什么）。
  连自己的库一起发给别人，是这个包能犯的最糟的错。`test/package.test.cjs` ③ 逐个模式拦。
- `node_modules/`：用户自己 `npm install`（或干脆不用 —— 三个入口零依赖）。

### 版本门槛

`engines.node` 写的是 `^22.13.0 || >=23.4.0`。**这不是抄来的，是量出来的**：

```
v22.12.0 → require('node:sqlite') THROWS
v22.13.0 → OK
v23.0.0  → THROWS     ← ★注意这里：23 线又回到标志后面
v23.1.0  → THROWS
v23.2.0  → THROWS
v23.3.0  → THROWS
v23.4.0  → OK
```

免 `--experimental-sqlite` 标志的门槛**不是一条直线**（官方版本史只写了前半段）。
照「≥22.5 就行」写，会让 22.5–22.12 与 23.0–23.3 的用户体检全绿、然后每个命令都崩在
`No such built-in module: node:sqlite` 上 —— 那种报错没人猜得到是版本问题。

### 发布前自检

```bash
node test/package.test.cjs     # 6 则打包守卫（真跑 npm pack 取文件清单）
npm pack --dry-run             # 人眼再看一眼清单
npm pack                       # 出一个 tarball
```

**装一遍再发**（这一步不能省 —— 上面所有坑都是在这一步现形的）：

```bash
mkdir /tmp/try && cd /tmp/try && npm init -y
npm i /path/to/jujian-0.1.0.tgz
node node_modules/jujian/bin/jujian.cjs games-types    # 零依赖入口 ①
node node_modules/jujian/bin/jujian-bench.cjs          # 零依赖入口 ②
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node node_modules/jujian/bin/jujian-mcp.cjs   # 零依赖入口 ③
PORT=8899 node node_modules/jujian/src/server.js &     # HTTP 入口（要 fastify）
curl -s localhost:8899/api/health
curl -s -o /dev/null -w '%{http_code}\n' localhost:8899/views/review.js   # 前端必须 200
```

---

## 二、MCP 注册表

目标登记名：`io.github.rui08984-dot/jujian`（`docs/mcp/server.json`，同时是 `package.json` 的 `mcpName`）。

### 顺序（不能颠倒）

1. `package.json` 里有 `"mcpName": "io.github.rui08984-dot/jujian"` —— **必须与 server.json 的 `name` 逐字符一致**。
   注册表靠它验证「这个 npm 包确实是这个 server 的」（`test/package.test.cjs` ④ 守着这条一致性）。
2. **先把包发上 npm** —— 注册表只存元数据，不存产物；包不在 npm 上，归属验证无从做起。
3. `mcp-publisher` → `login github`（设备码）→ `publish`。

### server.json 的字段口径（都有官方一手依据）

| 字段 | 值 | 注意 |
|---|---|---|
| `registryType` | `npm` | 合法枚举是 npm/pypi/nuget/cargo/oci/mcpb；**没有 "mcp" 这个取值** |
| `identifier` | `jujian` | 填 **npm 包名**，不是 server name。填成 server name 会让客户端去找一个不存在的包 |
| `registryBaseUrl` | **不填** | 它的语义是「底层包注册表」（npm 时才是 `https://registry.npmjs.org`）；官方模板不含此字段 |
| `transport` | `{"type":"stdio"}` | ✔ |
| `environmentVariables[].format` | `string` | 可选，建议补 |

★ 早先那版 `server.json` 把 `registryType` 写成 `mcp`、`identifier` 写成 server name、
`registryBaseUrl` 指到 MCP 注册表自己 —— 三处都是**语义错**，不是笔误：
它们各自看起来都"像那么回事"，只有对着 schema 逐字段核才发现。

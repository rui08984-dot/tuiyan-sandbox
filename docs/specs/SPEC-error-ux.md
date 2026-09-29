# Spec: error-ux · 错误提示人话化与静默失败消除

> 能力地图模块 id `error-ux` · 依赖：无 · 规模 0.8 人日
> ⚠️ **与 `runtime-paths` 同改 `p1b/src/server.js`，两者必须串行，不可并行。**

## Objective

把陌生人遇到错误时看到的东西，从「HTTP 500」和「一个纯 JSON 字符串」换成**一句人话 ＋ 一条能走的下一步**。

**给谁用**：第一次遇到报错、不知道该怎么办的陌生人。
**成功的样子**：他看到「你打开的地址不对。回 `/` 试试。」，而不是 `{"statusCode":404}`。

## Commands

```bash
node -e "const {copy}=require('./p1b/web/src/lib/errorCopy.ts')"   # 类型检查由 tsc 覆盖
cd p1b && node gates/gates.cjs
```

## Project Structure

```
p1b/web/src/lib/errorCopy.ts   ← 新建，把退出码映射成中文人话 ＋ hint ＋ 下一步
p1b/web/src/lib/errorCopy.test.mjs  ← 新建
p1b/src/server.js              ← 改两处：:193 静默跳过改 stderr 警告；:139 附近加 SPA fallback
```

## Code Style

**★不要另写一套映射。** 复用 `p1b/mcp/exitMap.cjs`（129 行，逐码 ＋ `hint` 中文）的那份数据，
`errorCopy.ts` 只做「Web 端怎么呈现它」的薄封装。数据源单一是纪律。

## Testing Strategy

1. **逐码覆盖**：每个退出码都有中文文案 ＋ hint ＋ 下一步动作
2. **反向锁**：喂一个码表里没有的码 ⇒ 文案是「后端报错了。这不是你操作的问题。」而不是空白
3. **SPA fallback**：删掉 `dist/index.html` 后访问 `/xxx`，**不得**见 JSON 字符串
4. **静默失败**：删掉 `dist` 启动 ⇒ stderr 出现明确警告 ＋ `/api/health` 带 `web_built:false`

## Boundaries

- **Always**：`web_built:false` 要出现在 `/api/health` 里，让机器也能判；警告走 stderr 不走 stdout（stdout 会被脚本捕获）
- **Ask first**：改任何退出码的**含义**（只能改呈现）
- **Never**：为了「让报错好看」而吞掉真实错误；把栈信息返给前端

## ★三条必须消掉的「静默失败」

| 现象 | 现状 | 改后 |
|---|---|---|
| 前端没构建 | `server.js:193` `if (fs.existsSync(WEB_DIST))` 不存在就**静默跳过** ⇒ 服务器起来了，浏览器打开是 JSON 或空白，**没有一句说「前端没构建」** | stderr 警告 ＋ `/api/health` 带 `web_built:false` |
| 404 | **现在是最坏的一屏：纯 JSON 字符串** | 「你打开的地址不对。回 `/` 试试。」＋ 非 `/api` 路径一律回 `index.html`（HashRouter 下的 SPA fallback） |
| 退出码 | Web 端一律显示 HTTP 500 | 逐码人话（见下） |

**退出码人话表**（数据源是 `exitMap.cjs`，此处是它该被呈现成的样子）：

| 码 | 人话 | 下一步 |
|---|---|---|
| 2 确认闸 | 「这一操作会写账本，已被拦下，什么都没执行。」 | 「要真执行，复制这行到终端加 `--确认`」 |
| 3 门禁码 | 「门禁给出了结论：这一批不通过。**这不是程序坏了。结论就是结论，别重试。**」 | — |
| 4 预检失败 | 「需要的脚本不存在或被列为不可用。**重试没用。**」 | 「检查安装是否完整」 |
| 其它 | 「后端报错了。这不是你操作的问题。」 | 「刷新一次；还不行就重启」 |

★**退出码 3 那一行是本项目最重要的一句文案**：它是「空集不许被读成通过」这个设计在说话，**CLI 绝不抹平它，Web 端也不许**。

## Success Criteria

- [ ] 每个退出码都有中文文案 ＋ hint ＋ 下一步；无码时不空白
- [ ] 数据源唯一：文案映射来自 `exitMap.cjs`，不另写一份
- [ ] 删 `dist/index.html` 后访问 `/xxx` 不见 JSON
- [ ] 删 `dist` 启动 ⇒ stderr 有警告 ＋ `/api/health` 带 `web_built:false`
- [ ] 四道闸门 exit 0；`tsc --noEmit` exit 0

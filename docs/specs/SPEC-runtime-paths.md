# Spec: runtime-paths · 数据目录与降级保护

> 能力地图模块 id `runtime-paths` · 依赖：无 · 规模 1.0 人日
> ⚠️ **与 `error-ux` 同改 `p1b/src/server.js`，两者必须串行，不可并行。**

## Objective

让程序知道「**我的数据该放哪**」，并在遇到比自己新的数据库时**拒绝启动而不是把数据搞坏**。

**给谁用**：第一次双击启动的陌生人；以及三个月后回来打开旧版的自己。
**成功的样子**：他把 zip 解压到任何路径（含中文与空格）都能起来；数据落在平台标准位置；哪天他拿新版程序打开旧格式库，程序**停下来告诉他怎么回事**，而不是静默改坏。

## Commands

```bash
P1B_DATA_DIR=/tmp/p1btest node p1b/src/server.js     # 应在新目录建库并起来
node -e "require('./p1b/src/paths.cjs').resolveDbPath()"   # 打印解析结果
cd p1b && node gates/gates.cjs
```

## Project Structure

```
p1b/src/paths.cjs            ← 新建，约 60 行
p1b/src/schemaVersion.js     ← 新建，app_meta 表 ＋ 降级拒绝
p1b/src/server.js            ← 改 2 行（:33 / :35）
p1b/test/paths.test.cjs      ← 新建
p1b/test/schema-version.test.cjs  ← 新建
```

## Code Style

纯 CommonJS，零依赖。`paths.cjs` 只做解析不做 IO，副作用一律留给调用方。

## Testing Strategy

1. **优先级链**：`P1B_DB_PATH` ＞ `P1B_DATA_DIR` ＞ 平台默认——逐级测
2. **Windows 不用 `%APPDATA%`**：漫游会把 6 MB 库同步到域控，测试须断言落在 `%LOCALAPPDATA%`
3. **含空格与中文的路径**：路径解析后 `mkdirSync` 成功（bat 是 shell，不加引号会断——这是方案 A1b 的根因）
4. **降级保护反向锁**：喂一个 `schema_version` 高于程序支持的库 ⇒ **拒绝启动、退出码 6、且不碰数据**

## Boundaries

- **Always**：仓库开发时的行为**不变**（不设 `P1B_DATA_DIR` 时仍解析到今天的路径）；迁移前自动备份
- **Ask first**：改动 `p1a-terminal/**`（禁改面）；任何 schema 变更
- **Never**：**自动降级 schema**（那会丢数据）；删除或覆盖用户数据目录

## ★降级保护为什么是「成品」和「脚本」的分界线

脚本可以假设只有作者在用，成品必须处理「用户拿旧版打开新版库」。

```
读到 schema_version > 当前程序支持的最大值：
  ✗ 不启动
  ✗ 打印：「你的数据是 v1.2 格式，这个程序只认到 v1.0。
           两种修法：① 升级程序 ② 回退数据：p1b seed --restore <备份>」
  ✗ 退出码 6（与「程序错误」1–5 区分）
  ★绝不做「自动降级 schema」——那会丢数据
```

配套：每次迁移前自动执行一次备份（复用已有的 `backup-offsite.cjs` 逻辑）。

## Success Criteria

- [ ] 三个优先级逐级生效，仓库开发态行为不变
- [ ] Windows 默认落 `%LOCALAPPDATA%\P1bSandbox\`，**不用 `%APPDATA%`**
- [ ] 含空格与中文的 `P1B_DATA_DIR` 能建目录、能起服务
- [ ] 高版本 schema ⇒ 拒绝启动 ＋ 退出码 6 ＋ **数据零改动**
- [ ] 迁移前自动备份被测试覆盖
- [ ] `server.js` 只改了 `:33` `:35` 两行；四道闸门 exit 0

## Open Questions

- 退出码 6 与现有 `p1b/cli/index.cjs:14-24` 的码表要同步登记，否则 MCP 侧会把它当「未知错误」

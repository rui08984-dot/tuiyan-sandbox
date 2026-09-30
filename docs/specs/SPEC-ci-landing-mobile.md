# Spec: ci-landing-mobile · CI、落地页与移动端实测

> 能力地图三个模块合并成一份：`ci`（0.5 人日）＋ `landing`（0.8 人日）＋ `mobile`（1.0 人日）
> 三者**无依赖关系**，可三条并行。合并成一份 spec 是因为它们都很薄，各写一份不值得。

## Why merged

三个模块的共同点是：**都不是产品能力，而是「让人看见 / 让人敢用」的收尾件**。
各自不足 1 人日，拆成三份 spec 只会让地图变长而不增加信息。

---

## 模块 1 · ci · GitHub Actions

### Objective

让每一次 push 都自动跑那四道闸门——**让「闸门绿」不再依赖记���记得跑**。

**成功的样子**：推上去，Actions 自己跑完四道闸门，红了就在 PR 上写清楚红在哪一道。

### Project Structure

```
.github/workflows/ci.yml    ← 新建（本仓���没有 .github）
```

### 测试与验收

1. `ci.yml` 里的命令与 `p1b/gates/gates.cjs` **逐条同源**（不许在 yml 里另写一套）
2. yml 能被解析（有一个测试读它并断言四条命令都在）
3. **反向锁**：从 yml 里删掉一条命令 ⇒ 该测试红（否则 yml 与闸门会悄悄漂移）

### Boundaries

- **Never**：在 yml 里放宽任何闸门判据；用 `continue-on-error` 掩盖失败
- **Ask first**：改闸门本身的判据（那是 gates.cjs 的事）

### Success Criteria

- [ ] `.github/workflows/ci.yml` 存在，四道闸门命令与 `gates.cjs` 同源
- [ ] 测试读 yml 并断言四条命令都在
- [ ] **反向锁**：删掉一条命令 ⇒ 测试红
- [ ] 零新依赖（只用 `actions/checkout` ＋ `actions/setup-node`）

---

## 模块 2 · landing · 落地页与 server.json

### Objective

一个**只做落地页**的 GitHub Pages 站点 ＋ 一份 MCP server 描述文件。

### ★GitHub Pages 的能力边界（先认清，避免许愿）

| 能 | 不能 |
|---|---|
| 放文档、截图、下载跳转 | 跑后端 |
| — | 托管账本 |
| — | 代理 API |

⇒ **落地页只能是静态页**。它唯一的任务是「点一下跳到 README 和 zip 下载」。

### Project Structure

```
.github/landing/index.html    ← 新建，纯静态
docs/mcp/server.json          ← 新建（MCP registry 描述，P1 才用得上）
```

### server.json 三必需字段

`name`（反向 DNS ＋ **恰好一个斜杠**）／`description`／`version`。
可用 `mcp-schema-lint`（MIT、零依赖、只读）预校验。

### Boundaries

- **Never**：让落地页看起来像能在线跑（它不能）
- **Ask first**：定 MCP server 的反向 DNS 名（那是发布身份的一部分）

### Success Criteria

- [ ] 落地页是**纯静态**，无后端调用
- [ ] 页面上的每个链接都指向真实存在的东西（反链检查）
- [ ] `server.json` 三个必需字段齐全，且通过 schema 校验
- [ ] 落地页不承诺任何「在线试用」

---

## 模块 3 · mobile · 移动端真机实测

### Objective

让手机上的核心三个动作**真的能用**，并留一份可复核的证据。

### ★现状：CSS 能过，真机从未验过

19 个 css 共 47 处 `@media`（1024/768/480/420/375 四档 ＋ 6 处 `prefers-reduced-motion`）；
`index.html:5` 有 `viewport-fit=cover`；`p1b6.css:236` 有 sticky 输入条（拇指可达）。

**唯一的卡点**：`p1b6.css:24-31` 的 `.appbar-nav { overflow-x: auto }` ＋ `::-webkit-scrollbar { height: 0 }`
⇒ 手机上 3 个题线动作 ＋ 现场 ＋ 2 个工具钮挤在一条**滚动条被隐藏**的横条里。
**陌生人大概率只看到「待落定」四个字，右侧还有内容但看不出来。**

★**项目至今没有任何真机记录。** 唯一一次「手机实测」是 `p5-integration-report.md`，
第 4 行写明「真浏览器 = **Chrome headless CDP**」，第 43 行遗留「防火墙需用户手动放行后真机抽查」——**没做**。

### 三件事

1. 滚动条改留 **3px 淡色指示条**（0.1）
2. ★**真机跑一遍「记一笔 → 落定 → 复盘」并留回执文件**（0.5）
3. 录 30 秒竖屏录屏进 README（0.4）

### ★第 2 条需要创始人本人

真机需要：一部真手机 ＋ 一次手动放行防火墙。**代理做不了**（无头浏览器不是真机）。
⇒ 你要做的：跑一遍，把三步截图 ＋ 你看到的现象写进回执文件。
**助手能做的：把第 1、3 条做完，并把回执文件的骨架与验收清单写好，等你填。**

### Boundaries

- **Always**：回执文件里**如实写**看到了什么，包括「不好看」；不许把 headless 截图当真机证据
- **Ask first**：改任何 `@media` 断点值
- **Never**：用 headless 截图冒充真机记录

### Success Criteria

- [ ] 滚动条有 3px 淡色指示条
- [ ] 真机回执文件**骨架已就位**（含三步的截图位 ＋ 现象填写位 ＋ 验收清单）
- [ ] **回执文件里明确写着「此三张为待补，headless 不算真机证据」**——不许留白让人误以为做过了
- [ ] 四道闸门 exit 0

---

## 三模块共同的 Boundaries

- **Always**：零新依赖；UTF-8 ＋ LF
- **Ask first**：改任何门禁判据或红线措辞
- **Never**：为了让某个检查变绿而放宽它

## 【勘误 1 · 2026-09-29】锚点审计报 2 项「失效」属预期

`docs/mcp/server.json`（另一处 `server.json` 是同一文件的简称）是本模块**新建**文件，尚未创建。
★**这不是断链，是「还没建」**。（另 5 项锚点是真实存在的文件与命令，已判绿。）

## 【勘误 2 · 2026-09-29】本文件里有几处占位字是编辑器吞字，登记在此以免后来人找不到

- 「让『闸门绿』不再依赖记**得记得**跑」——原意是「不再依赖**记**得**记得**跑」
- 「本仓**无** .github」
- 「纯静态页（本仓**库**没有 .github）」

⇒ 三处都是同一个笔误（重复的「记/无/库」），**不影响任何判据与命令**，原文保留不��

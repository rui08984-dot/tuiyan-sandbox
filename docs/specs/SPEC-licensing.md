# Spec: licensing · 许可证与包元数据

> 能力地图模块 id `licensing` · 依赖：无 · 规模 0.7 人日
> `readme` / `remote` / `landing` 三个模块都依赖它。

## Objective

把仓库从「私有的、未声明许可的、npm 拒发的」变成「许可明确、元数据完整、可被陌生人合法使用与分发」。

**给谁用**：任何将来 clone 或 `npm install` 这个项目的人。
**成功的样子**：他们知道**能不能用、怎么署名、出了事找谁**——而这些写在文件里，不是靠猜。

## Commands

```bash
node -e "const p=require('./p1b/package.json');console.log(p.private,p.license)"   # 应输出 false Apache-2.0
npm publish --dry-run                                                            # 应无 private 警告
```

## Project Structure

```
LICENSE                    ← 新建，Apache-2.0 全文
package.json               ← 新建（根），把 p1a-terminal/ 与 p1b/ 打进同一 tarball
docs/RIGHTS.md             ← 新建，8 条红线全文（对外版）
p1b/package.json           ← 改：private:true 去掉、license 改 Apache-2.0
p1a-terminal/package.json  ← 改：同上
```

## Code Style

`package.json` 字段顺序照 npm 惯例；`files` 白名单用显式数组，不用 glob（`node_modules` 必须显式列出需要的那几个依赖）。

## Testing Strategy

`npm publish --dry-run` 的退出码与输出；加一条后端测试断言两个 `package.json` 的 `private !== true` 且 `license` 为 `Apache-2.0`——**防止将来被人改回去**。

## Boundaries

- **Always**：`private: true` 必须在改动前后各跑一次 `--dry-run` 留证；`files` 白名单要逐条列出
- **Ask first**：改 `p1a-terminal/package.json`（在禁改面上）；选定最终包名
- **Never**：把 `p1a-terminal/config/` 放进 `files`；设 `publishConfig.access` 以外的发布配置

## ★关于根 `package.json` 的关键设计

`p1b/src/deps.js:9` 有一行 `path.join(__dirname,'..','..','p1a-terminal')` —— **跨目录逃逸**。
这让 `p1b` 无法作为独立 npm 包安装。**零代码改动的可行解**：根 `package.json` 把 `p1a-terminal/` 与 `p1b/` **打进同一个 tarball**，保持相对路径 ⇒ `deps.js` 一行不用改。

⇒ **不要为了「让 p1b 能独立装」去改 `deps.js`。** 那会动到跨包解析的核心，且与 P1 的 `node:sqlite` 迁移冲突。

## Success Criteria

- [ ] 根 `LICENSE` 为 Apache-2.0 全文
- [ ] 两个 `package.json` 的 `private` 去掉、`license` 改为 `Apache-2.0`
- [ ] 根 `package.json` 存在，`files` 白名单显式列出 `p1a-terminal/` 与 `p1b/`
- [ ] `npm publish --dry-run` 无 private 警告，tarball 里**不含** `config/`、`*.db`、`.env`
- [ ] 后端测试断言上述字段，并**反向锁**（有人改回 private 即红）
- [ ] `docs/RIGHTS.md` 含 8 条红线全文

## Open Questions

- **包名**：方案未指定。⚠️npm 包名被抢注即永久拿不回，发布前须 `npm view <包名>` 确认是空的。**本模块不发布**，只把字段修好。

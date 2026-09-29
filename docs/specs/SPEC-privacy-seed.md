# Spec: privacy-seed · 种子库与隐私剔除

> 能力地图模块 id `privacy-seed` · 依赖：无 · 规模 1.0 人日
> **本模块是 `remote` 的硬前置**——发行树里那 5 行真人数据不进 remote。

## Objective

做一个**可复现的种子库构建脚本**，从 `p1a.db` 拷出结构与读数，但**剔除 4 个真实玩家的昵称和他们说过的原话，以及 6 行对他们的角色判断**，并产出一份 `seed_provenance.json` 写清「剔了什么、为什么、剩多少」。

**给谁用**：一个陌生人第一次打开这个工具时看到的第一批数据。
**成功的样子**：他打开界面看到有数据，但那些数据里**没有未经同意的真实玩家信息**，而且有一条常驻说明告诉他「这是示范数据，不是你的成绩」。

## Tech Stack

Node 24（`node:sqlite` 的 `DatabaseSync`，**不引新依赖**）· 现有 `p1b/scripts/` 脚本范式。

## Commands

```bash
# 构建种子库（幂等：已存在则退出码 3，不覆盖）
node p1b/scripts/make-seed-db.cjs --out seed/p1a-seed.db

# 只做隐私体检，不产出（发布闸用）
node p1b/scripts/make-seed-db.cjs --check-only

# 验收：四道闸门
cd p1b && node gates/gates.cjs
```

## Project Structure

```
p1b/scripts/make-seed-db.cjs     ← 本模块唯一新增文件
p1b/test/make-seed-db.test.cjs   ← 顶层 if (require.main === module) main()（有回归锁）
seed/p1a-seed.db                 ← 产物，不入库（加 .gitignore，sha256 记进 seed_provenance.json）
seed/seed_provenance.json        ← 产物，入库
```

## Code Style

照抄 `p1b/scripts/secret-preflight.cjs` 的三条硬纪律：**绝不打印密钥本体**（本模块类比：绝不打印被剔掉的原文，只打印条数与 id）、**绝不联网**、**默认只读**（`--out` 才写）。

## Testing Strategy

`node --test`（后端 107 文件之一）。必测：

1. **隐私锁**：构建产物里 `events` 表按「N号+昵称」模式匹配的行数 **= 0**（判据见下）
2. **人数锁**：`hypotheses` 行数 = 种子声明值
3. **零泄漏**：`analytics_*` 与 `question_owners` 行数 = 0
4. **结构锁**：`sqlite_master` 表数与视图数与来源一致
5. **反向锁**：★**故意用一条带真人昵称的夹具跑 `--check-only`，必须红**——证明这把闸咬人

## Boundaries

- **Always**：账本不可变（**只读 `p1a.db`，绝不写**）；剔除动作在**副本**上做；`seed_provenance.json` 必须写明剔了什么
- **Ask first**：改动 `p1a.db` 本体；改动 `events`/`hypotheses` 的表结构
- **Never**：把被剔掉的原文写进任何日志/收据/测试夹具；用「静默脱敏」（不告知用户）代替 `seed_provenance.json`

## ★隐私判据（★这一条是对上游方案的修正）

上游方案写的是「`events.raw_text` 含中文且含'号'的行数 = 0」。**实测该判据不可用**：

| 口径 | 行数 | 说明 |
|---|---:|---|
| 机械匹配（含中文 + 含「号」） | **458** | 绝大多数是合法数据（如「3号查杀5号」），剔了就把种子库掏空 |
| 含「N号+昵称」模式 | **173** | 多数只有编号没有昵称 |
| ★**真正带真人昵称** | **5** | 1号【昵称已打码】／8号【昵称已打码】／5号【昵称已打码】／12号【昵称已打码】 等 |

⇒ **本模块的判据是「N号+昵称」模式 = 0，且人工核出的 5 行必须逐一列入剔除名单。**
不做「按 458 机械剔除」——那会删掉 90% 的合法示范数据，种子库的可信度就没了。

## Success Criteria

- [ ] `make-seed-db.cjs` 幂等：已存在则退出码 3，不覆盖
- [ ] 产物 `events` 按「N号+昵称」模式匹配 = 0 行
- [ ] 产物 `hypotheses` = 0 行（6 行真人判断全部剔除）
- [ ] 产物 `analytics_*` ＋ `question_owners` = 0 行
- [ ] `seed_provenance.json` 含：来源库 sha256、剔除了哪些表各多少行、五层读数（Brier 等）、**一句话写明「这不是你的成绩」**
- [ ] 反向锁测试：喂一条带真人昵称的夹具 ⇒ 体检脚本退出码非 0
- [ ] `node --test test/*.test.cjs` 全绿；四道闸门 exit 0

## Open Questions

- 剔除后 `games` 表里那些真人局的**结构性记录**（不含昵称）是否保留？默认**保留结构、去身份**。

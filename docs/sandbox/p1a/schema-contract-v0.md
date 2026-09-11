# P1a Schema 契约 v0（红队 YD4/PD1 前置，施工各方共同遵守）

> 日期：2026-09-07 ｜ 本契约是 A 数据层 / B CLI / C LLM 适配 / D 渲染 / E 实测 五方接口承诺。改契约必须走版本号（v0→v1）并通知全部依赖方。

## 1. SQLite 表（better-sqlite3，WAL 模式）

```sql
CREATE TABLE games (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, game_type TEXT NOT NULL,          -- werewolf/botc/script
  player_count INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE players (
  id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id),
  seat INTEGER NOT NULL, name TEXT NOT NULL, UNIQUE(game_id, seat)
);
CREATE TABLE events (
  id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id),
  day INTEGER NOT NULL, phase TEXT NOT NULL CHECK(phase IN ('night','day','dusk')),
  seq INTEGER NOT NULL,                                                         -- 局内单调递增
  type TEXT NOT NULL CHECK(type IN ('statement','vote','death','claim','action_reveal','system')),
  actor_seat INTEGER REFERENCES players(id),                                    -- system 事件可为 NULL
  raw_text TEXT NOT NULL,                                                       -- 用户原话（不可改写）
  UNIQUE(game_id, seq)
);
CREATE TABLE claims (
  id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id),
  seat INTEGER NOT NULL, subject_seat INTEGER NOT NULL,                         -- 谁说的 / 关于谁
  predicate TEXT NOT NULL CHECK(predicate IN
    ('is_wolf','is_good','is_role','claims_role','voted','did_action','said')),
  object TEXT NOT NULL,                                                         -- 角色名/动作名/自由命题
  extracted_by TEXT NOT NULL DEFAULT 'llm', confirmed_by_user INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE actions (
  id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id),
  seat INTEGER NOT NULL, action TEXT NOT NULL CHECK(action IN
    ('vote','abstain','kill_target','poison_target','protect_target','check_target','self_explode')),
  target_seat INTEGER, result TEXT                                              -- 结果描述（可空）
);
CREATE TABLE contradictions (
  id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id),
  claim_a INTEGER REFERENCES claims(id), claim_b INTEGER REFERENCES claims(id), -- 可一 NULL 一非（声称vs行动）
  action_a INTEGER REFERENCES actions(id), action_b INTEGER REFERENCES actions(id),
  conflict_desc TEXT NOT NULL,
  underdetermination TEXT NOT NULL CHECK(underdetermination IN ('high','mid','low')),
  innocent_explanations TEXT NOT NULL,                                          -- JSON 数组，非空强校验（RD1）
  generated_by TEXT NOT NULL CHECK(generated_by IN ('code','llm'))
);
CREATE TABLE hypotheses (
  id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id),
  day INTEGER NOT NULL, content TEXT NOT NULL, stance TEXT NOT NULL,            -- per-player 立场 JSON：{"1":"wolf_suspect","4":"good_believe",...}（PD1）
  support_events TEXT NOT NULL, oppose_events TEXT NOT NULL,                    -- JSON 数组，元素=事件 id
  tendency TEXT NOT NULL CHECK(tendency IN ('strong','mid','weak'))
);
```

## 2. 事件类型枚举（B/C 共同遵守）

statement（普通发言）/ claim（身份或信息声称：跳预言家、报查杀、称验人）/ vote（投票）/ death（死讯公布）/ action_reveal（行动公开化：认毒杀、认守人）/ system（法官宣布、天亮）。
抽取规则：一条用户输入可产出 1 个 event + 0..n claims + 0..1 actions。

## 3. LLM 输出契约（C 必须强校验，失败重试 ≤2 次）

抽取：`{event:{day,phase,type,raw_text}, claims:[{subject_seat,predicate,object}], action:{action,target_seat,result}|null}`——seat 必须是已存在玩家，不存在即丢弃该条并提示用户。
参谋卡：`{contradictions:[{pair_id,underdetermination,innocent_explanations[≥1]}], hypotheses:[{content,stance,support_events,oppose_events,tendency}], checkpoints:[{text, resolves:[hypothesis_idx]}]}`——innocent_explanations 空数组=校验失败。
自洽校验（机械，D 调用前）：hypothesis.stance 中标记 good_believe 的玩家不得出现在嫌疑排序（若有）Top 区；矛盾对引用的 claim/action id 必须存在于库（LY昼2 脱节负例为回归用例）。

## 4. 矛盾比对器（A，纯代码，可单测）

输入：claims+actions 全量。输出冲突对（不判欠定度——那是 LLM 层，RD1）：
- claims×claims：同 subject_seat+predicate 不同 object（对跳/矛盾声称）
- claims×actions：claims 声称与 actions 记录字面冲突（如声称验 8 而行动记录验 11）
- 死者活跃：death 事件后该 seat 出现 vote/新 claim（照录待查类，underdetermination 标记交 LLM）

## 5. 环境与安全（YD6）

- DeepSeek API key：**env-only**（DEEPSEEK_API_KEY），禁止写入任何文件；读不到即启动失败并提示。
- 仓库 git 化首日必须建 .gitignore：node_modules/、*.db、.env*、test-out*.txt。

## 6. 录入计时协议（YD2，E 必须预注册执行）

- 素材：werewolf-pandakill-s1e7-raw.txt（真实复盘原文，非预制结构化文本）。
- 流程：逐条朗读原文→口头转述录入（模拟局中速记节奏），秒表从开始说到确认入账。
- 口径：单条录入时间=「开始转述」到「回显确认完成」；剔除首次学习成本（前 3 条不计）；报 中位数+P90，gate=中位数 ≤30 秒。
- 预注册：本节即预注册，计时开始后不得改口径。

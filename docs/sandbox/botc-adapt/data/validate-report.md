# BOTC 数据层校验报告

- 生成时间: 2026-09-08T15:27:51.811Z
- 数据源: roles-townsquare.json (130 角色) / script-schema.json ($id: https://raw.githubusercontent.com/ThePandemoniumInstitute/botc-release/main/script-schema.json)

## 必填校验（schema 角色分支: ["id","name","team","ability"]）

- 错误数: 0
- 警告数: 0
- id 模式 ^[a-z0-9]+$: 全部通过
- team 枚举校验: 通过（townsquare "traveler" 映射官方 "traveller"，已注记归一化）

## 统计

| 维度 | 值 |
|---|---|
| 总角色数 | 130 |
| edition=(实验/无剧本) | 43 |
| edition=bmr | 30 |
| edition=snv | 30 |
| edition=tb | 27 |
| team=townsfolk | 60 |
| team=minion | 20 |
| team=outsider | 19 |
| team=traveller | 16 |
| team=demon | 15 |

### edition × team 交叉

| edition | townsfolk | outsider | minion | demon | traveller |
|---|---|---|---|---|---|
| tb | 13 | 4 | 4 | 1 | 5 |
| bmr | 13 | 4 | 4 | 4 | 5 |
| snv | 13 | 4 | 4 | 4 | 5 |
| (实验/无剧本) | 21 | 7 | 8 | 6 | 1 |

## 字段清单（130 角色字段覆盖数）

- id: 130
- name: 130
- edition: 130
- team: 130
- firstNight: 130
- firstNightReminder: 130
- otherNight: 130
- otherNightReminder: 130
- reminders: 130
- setup: 130
- ability: 130
- remindersGlobal: 5

## roles-zh.json 覆盖校验

- 总条数: 130（id 集合与源一致: true）
- 中文译名覆盖: 129/130
- 中文能力覆盖: 124/130
- 官方剧本角色（非实验非旅行者 72 个）译名覆盖率: 100%

- 结论: ✅ 全部通过
# P4-B' · Manifold Markets 探测收据（2026-09-13 · 只读）

> 边界遵守：**零写 p1a.db / 零改项目代码 / 零调 LLM** / 只访问 api.manifold.markets。
> 全部请求**串行 + 1.3s 退避**；UA=p4b-manifold-probe/0.1；探测窗口 UTC ≈10:47–11:00。
> 话术纪律：以下全部为**社区共识参考，非真值；对表一致 ≠ 正确**。

## 一、可达性矩阵（23 请求 / 8 类端点形；全 200 或 400，无 403、无 429、无 Cloudflare 挑战）

| # | 端点 / 参数 | HTTP | 实测要点 |
|---|---|---|---|
| 1 | GET /v0/markets?limit=N | 200 | 列表项字段：id/question/createdTime/closeTime/outcomeType/mechanism/volume/isResolved（BINARY 附 probability） |
| 2 | GET /v0/markets?…&filter=resolved | 400 | Unrecognized key 'filter' ⇒ **不支持任何 resolved 过滤** |
| 3 | GET /v0/markets?…&resolved=true | 400 | Unrecognized key 'resolved' ⇒ 旧布尔参数也不存在 |
| 4 | GET /v0/markets?…&sort=resolve-time | 400 | sort 合法枚举仅：created-time / updated-time / last-bet-time / last-comment-time |
| 5 | GET /v0/search-markets?term=X&filter=resolved&limit=N | 200 | **按关键词找已 resolve 的唯一最短路径**；limit=50 实测生效 |
| 6 | GET /v0/search-markets?…&sort=resolve-time | 400 | Invalid input ⇒ 近期裁决采样需客户端按 resolutionTime 排序 |
| 7 | GET /v0/market/[id] | 200 | 详情多出：pool/p/resolution/resolutionTime/resolutionProbability/resolverId/description/groupSlugs |
| 8 | GET /v0/bets?contractId=[id]&limit=N | 200 | 概率历史：probBefore/probAfter/createdTime ⇒ **close 时刻社区概率 = closeTime 前最后一笔 bet 的 probAfter** |

## 二、resolution 取值谱（实测所见）
YES / NO / **MKT**（按市场概率裁决，resolutionProbability 为数值，可用但须标注「自我实现」）/ **CANCEL**（取消局，对表必剔）/ 答案 id（MULTIPLE_CHOICE、DATE）

## 三、真实样例（本目录，均 /v0/market/[id] 全字段转录 + 写后读回核验）
| 文件 | 市场 | 域匹配 |
|---|---|---|
| sample-1-temp-global-avg.json | 全球年均温 2024 超 2023？BINARY YES（1873 注单） | 气温域·标的异（域级匹配） |
| sample-2-cpi-yoy.json | US CPI YoY 2026-06 ≥4.5%？BINARY NO（19 注单） | 经济域·强同构（序列+期次+阈值） |
| sample-3-co2-monthly-ppm.json | 2024-02 月度 CO2 >422ppm？BINARY YES（30 注单，裁决时滞 ≈10 天=NOAA 月度值发布） | CO2 域·强同构（noaa_gml_co2_daily 型） |

## 四、深度实测（filter=resolved，原始命中≠有效对）
term=CPI → **50 命中**（44 BINARY / 2 MULTI_NUMERIC / 4 MC，resTime 2023-11~2026-09）；
term=temperature → **50 命中**（30 BINARY + 19 MC，需归约）；
term=Carbon Dioxide → 全量仅 **11 条**（8 BINARY，含 NOAA 月度 ppm 系列）——**CO2 域深度薄是短板**。

## 五、一句话结论
**对表可执行**（免 key 实证可达，窗口/判据/kill 条款照用）；**重叠 = CPI 域 + CO2 月度浓度域强同构、气温域弱重叠（域级）**；CO2 深度仅 11 条 ⇒ 探针 5–10 → 正式 N≥25，五条规则过滤后有效对不足即 **kill 条款 2** 如实报。

（收据完 · 2026-09-13）

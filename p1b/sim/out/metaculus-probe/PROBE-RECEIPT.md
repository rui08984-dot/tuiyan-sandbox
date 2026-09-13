# P4 · Metaculus 公共 API 探测收据（2026-09-13 只读）

> 边界遵守：**零写 p1a.db / 未改任何项目代码 / 未调 LLM / 只访问 metaculus.com**。全部请求串行 + 1.2–1.5s 退避。
> 探测时刻：2026-09-13T09:45:54Z（UTC）＝ 17:45 +08。

## 一、结论（先说结果）
**免 key 的公共通道全封，无法拉取任何真实问题数据。**
- 所有数据/规范端点一律 **HTTP 403**，原文：Permission Error: The API is only available to authenticated users. Please create an account and use your API token to access the API.
- 官网页面与 /static 静态资源被 **Cloudflare 人机挑战**拦截（HTML 标题 Just a moment...）。
⇒ 任务书要求的「实测 2-3 个真实问题拉取并落样例 JSON」**无法完成**；本收据**不提供任何伪造样例**。
⇒ 与查阅A 预警一致（合议纪要 §1.4 行 153：「metaculus.com 403 陷阱、API 为转述级证据」）。

## 二、探测矩阵（5 轮 / 14 个不同 URL）
| # | URL | HTTP | 说明 |
|---|---|---|---|
| 1 | /api/posts/?limit=2 | 403 | auth 必需 |
| 2 | /api2/questions/?limit=2 | 403 | 旧版 v2 同样封 |
| 3 | /api/posts/ | 403 | auth 必需 |
| 4 | /api2/questions/1/ | 403 | 单题详情亦封 |
| 5 | /api/posts/1/ | 403 | 同上 |
| 6 | /api/ | **200** | 仅 Swagger 文档壳（HTML 2593 B，无数据） |
| 7 | /questions/ | 403 | Cloudflare Just a moment...（浏览器 UA 亦被拦） |
| 8 | /api/schema/ | 403 | auth |
| 9 | /api/schema.json | 403 | auth |
| 10 | /api/openapi.json | 403 | auth |
| 11 | /api/docs/ | 403 | auth |
| 12 | /api/schema/?format=openapi | 403 | auth |
| 13 | /static/openapi.6835eb50da0b.yml | 403 | Cloudflare 挑战（文档壳给出的规范地址） |
| 14 | /api/static/openapi.6835eb50da0b.yml | 403 | auth |

**唯一 200** 是 /api/ 的文档壳；从其中**仅**能提取到静态规范地址 /static/openapi.6835eb50da0b.yml（第 13 行，同样被拦）。
未发现任何免鉴权数据端点；未在 403 响应中看到 x-ratelimit-* 头 ⇒ **限速参数不可观测**。

## 三、取证原文
- 403 响应头（5 轮取证，round5-403-headers.json）：
  server=cloudflare, cf-ray=a3a638c138d585a0-HKG, content-type=text/plain;charset=UTF-8, date=Sun, 13 Sep 2026 09:45:54 GMT
- 403 响应体（逐字）：
  Permission Error: The API is only available to authenticated users. Please create an account and use your API token to access the API.
- Cloudflare 拦截页（第 7 行，public-questions-page.raw.txt，5736 B）：标题 Just a moment... + /cdn-cgi/challenge-platform/scripts/jsd/main.js

## 四、落盘证据清单（p1b/sim/out/metaculus-probe/）
| 文件 | 内容 |
|---|---|
| round2-summary.json | 第 2 轮 5 端点 JSON 摘要（status/ct/len/head） |
| round3-schema-summary.json | 第 3 轮 5 端点摘要 |
| round4-openapi-summary.json | 第 4 轮 2 端点摘要 |
| round5-403-headers.json | 403 完整响应头 + 响应体（逐字） |
| api-root.raw.txt | 唯一 200 的文档壳原文（含规范地址） |
| public-questions-page.raw.txt | Cloudflare 挑战页原文 |
| api2-question-detail.raw.txt / api-post-detail.raw.txt / api2-with-browser-ua.raw.txt / schema-*.raw.txt | 各 403 响应原文 |

**未产出**：真实问题样例 JSON（原因见 §一，拒绝编造）。
## 五、若提供 API token 的可执行路径（建议，本棒未执行）
本棒**不索取、不存储**任何 token（安全边界）。若后续拍板提供 token，最小探测步骤：
1. GET /api/posts/?limit=3&status=open（Authorization: Token <token>）→ 取 id / slug / title / question 文本
2. GET /api/posts/{id}/ → 取 question.open_time / close_time / scheduled_resolution_time / actual_resolution_time、
   question.aggregations（recency_weighted / unweighted 的 latest 与 history 社区分布）、resolution
3. 串行 1 请求/秒 + 429 退避（探测脚本骨架已按此风格写：_p4-metaculus-probe*.cjs）
> 注：上述字段名系**转述级**（来自公开文档与既往用法），**本棒未实测**，落地前须以真实响应为准。

## 六、对后续两件交付的输入
- 探测**未取得**任何字段级实证 ⇒ 窗口映射方案只能基于**文档语义**编写，并逐项标注「待实测」（见 window-mapping.md）。
- 对表**不可执行**（数据面 0 条）⇒ 按任务自带 kill 条款处置（见 docs/specs/Metaculus对表方案-20260914.md §六 kill）。

（探测收据完 · 2026-09-13）

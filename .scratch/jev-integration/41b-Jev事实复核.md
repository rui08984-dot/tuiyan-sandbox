# 41b · Jev 承重事实独立复核（三条决定「调 API / 本地跑」的主张）

> 作者：独立复核员（Jev 事实复核员）
> 证据等级：★一手原文级 —— 厂商一手源亲自 HTTP 取回原文，＋ 我本次对 `api.typesafe.ai` 的实测；三条主张：2 条复现、1 条部分纠正

---

## 0. 判定速览

| # | 待核主张（起点文件 §4 原话） | 判定 | 一句话 |
|---|---|---|---|
| 1 | TypeSafe 未发布 Jev 权重、无自托管方案，只能调托管 API | **✅ 成立（带一处措辞修正）** | 权重确实没有；但「自托管方案」需要区分「跑 Jev」与「跑 Jev 形状的替身」——厂商自己发了一个让本地 LLM 冒充 Jev 客户端的适配器 |
| 2 | 单端点、三种题型原语、返回带概率的类型化决策 | **✅ 成立（补一处遗漏）** | 逐字复现；`Score` 还多返一个 `legend`，起点文件漏了 |
| 3 | 延迟 70–500ms、每次约 **0.042 美元**，「在原始出处上确实成立」 | **⚠️ 部分成立 —— 数字对、单位错** | 原始来源已找到（厂商自己的发布博文）；70–500ms 与 `$0.042` **确实在原始出处上**，但单位是 **/ 1M 输入 token**，**不是 / 决策** |

**最要紧的一条**：主张 3 里「$0.042 / 决策」这个单位是错的，而且错的来源可以精确定位——起点文件是从一个**博客标题**（`kie.ai` 的「The $0.042 Decision Model」）里把 `$0.042` 抄成了「每决策」，而正确单位（per 1M input tokens）**当时就已经在它自己标 ★已核 的那篇 MarkTechPost 上**。这正是「标题级证据」的具体代价。

---

## 1. 主张一：未发布权重、无自托管方案、只能调托管 API

**判定：成立。** 依据分四路，全部为我本次亲自取回。

### 1.1 厂商自己的 GitHub 组织里没有权重仓（我亲测）

```bash
curl -s -m 20 "https://api.github.com/orgs/typesafe-ai"
# → public_repos 10 | created 2024-05-28T20:57:18Z | blog https://typesafe.ai/
curl -s -m 20 "https://api.github.com/orgs/typesafe-ai/repos?per_page=100"
```
10 个仓全列出，**没有任何模型/权重仓**：
`typesafe-ai.github.io`(2026-06-04) / `vllm`(2025-05-23) / `LLaDA`(2025-06-17) / `daggerverse`(2026-09-09) / `pulumi-clickhouse`(2026-07-08) / `system-one-adapter-python`(2026-09-18) / `skills`(2026-09-12) / `Overwatch`(2026-09-03) / `typesafe-sdk-python`(2026-09-18) / `typesafe-sdk-js`(2026-09-15)

组织页 `blog` 字段指向 `https://typesafe.ai/`，**这个组织就是厂商本人**，不是同名者。

### 1.2 HuggingFace 上没有 Jev 权重（我亲测）

```bash
HTTPS_PROXY=http://127.0.0.1:2080 curl -s -m 30 "https://huggingface.co/api/models?search=jev&limit=100"
# → count 100，全部为第三方，无一条属于 TypeSafe
curl -s -m 25 "https://huggingface.co/api/models?author=typesafe-ai"
# → []   （HTTP 200，空数组）
curl -s -m 25 "https://huggingface.co/api/models?author=TypeSafeAI&limit=50"
# → 仅 1 条：TypeSafeAI/Step-5-Preview-BF16（stepfun-community-license，非 Jev）
```
- `author=typesafe-ai` 返回 **空数组**（不是 404，是 HTTP 200 的 `[]`）。
- 唯一带 `TypeSafeAI/` 前缀的模型是 **StepFun Step-5 的 BF16 重传**（`license_name: stepfun-community-license`），**不是 Jev**；而且 `https://huggingface.co/api/organizations/TypeSafeAI` 返回 `{"error":"Sorry, we can't find the page you are looking for."}` —— 该命名空间连组织页都没有。
- `search=jev` 命中的 100 条里，前排全是第三方「open-jev / Jev-Style / …-jev」命名（如 `com-kotobalabs/open-jev-deberta-v3-large`、`ZefanCai/Open-Jev-9B`、`ZefanCai/Open-Jev-2B`、`chaoliangUNSW/Jev-Style-Qwen3.5-2B-Decision-GGUF`）——**别人的复刻，不是权重的发布**。

### 1.3 厂商一手材料通篇不提权重/自托管（我亲测）

- 发布博文 `https://typesafe.ai/blog/introducing-system-one-models-and-jev`（HTTP 200，254126 B）全文检索 `weight|open.source|self-host|parameter count`：**零命中**。只有一句交付方式：「Our first public model is **Jev, available today in early access**.」
- 文档侧 `https://docs.typesafe.ai/models` 明确写「Every model on this page is **served by the same endpoint**」，正文和 SDK 页面检索 `self-host|base_url|weights|VPC|on-prem`：**零命中**。
- 厂商官网页脚/导航只有 waitlist / console / API keys / docs，**没有任何 download 入口**。

### 1.4 第三方与厂商的独立复述

- **第三方媒体（MarkTechPost，2026-09-19，Asif Razzaq）** 原文：「Is it deployable? Yes, as a **hosted API in early access behind a waitlist**. **TypeSafe has not published weights, a parameter count, or a self-hosting option.**」
- **第三方分析（openchamber.dev，2026-09-17 发布／09-19 更新）** 原文：「**Closed weights** limit what outsiders can establish about Jev's implementation.」以及「As of the review date, the API offered **no fine-tuning option**.」

### 1.5 ⚠️ 必须写清的一处措辞修正

「无自托管方案」这句**对 Jev 本体成立**，但有一个易被误读的地方，会直接影响方案走向：

厂商确实发了一个能让**本地方案**跑起来的东西 —— `typesafe-ai/system-one-adapter-python`。其 README 原文第一句：

> A drop-in replacement for `typesafe_sdk`'s `system_one` evaluation API, **backed by LLM APIs instead of TypeSafe**.
> Useful for comparing TypeSafe against an LLM on cost/speed/intelligence.

也就是说：它让你**把 TypeSafe 形状的客户端指向一个本地/第三方 LLM**，用来做 A/B 对比——**这不是自托管 Jev，这是自托管一个替身**。加上 HF 上那一批第三方 `open-jev` 复刻，实际局面是：

> **「跑不了 Jev」≠「跑不了 Jev 的形状」。** 前者是本条主张的内容（成立）；后者另有第三方在做，属于本棒另一路（候选核查）的范围，本条不替它背书。

**本条结论对方案的硬含义**：想用**真正的 Jev**，只有一条路——托管 API（直连 waitlist early access，或经 Vercel AI Gateway / AI/ML API 等第三方网关）。想**完全本地、离线、不依赖外部服务**，那就不是接 Jev，而是接一个别人的复刻，其校准与行为**没有厂商背书**。

---

## 2. 主张二：单端点、三题型原语、返回带概率的类型化决策

**判定：成立，且证据强度是三条里最高的**（既有厂商文档，又有我本次亲测的活体端点）。

### 2.1 端点存在性 —— 我本次亲测（这是最硬的一条）

```bash
curl -s -m 20 -X POST -H "Content-Type: application/json" -d "{}" https://api.typesafe.ai/v1/systemone
```
输出（HTTP 403）：
```
{"detail":{"error_type":"authentication_error","message":"Must supply an API key! Check your request and try again."}}
```
同一次请求的响应头：
```
HTTP/1.1 403 Forbidden
server: istio-envoy
x-typesafe-request-id: req_01a0c35bca2c76acb5808169ed51fa3a
x-envoy-upstream-service-time: 3
```
旁证：对同一路径发 **GET** 返回 `405`（方法不允许）——即路径存在、只是不接受 GET。

**这批证据的分量**：`x-typesafe-request-id` 是带厂商名的自有头、`server: istio-envoy` 是真实生产网关、错误体是结构化 JSON。**这不是一台停放页，是一个活着、路由正常、只差 API key 的生产端点。**

### 2.2 三种原语与返回形状 —— 厂商文档逐字

`https://docs.typesafe.ai/primitives.md`：

| Type | What it answers | Returns |
|---|---|---|
| Choice | Which of these options? | `choice`, `probabilities`, `confidence` |
| Score | Which level? | `score`, **`legend`**, `probabilities`, `confidence` |
| Noul | Is this true? | `noul` (0 to 1) |

> 🔧 **对起点文件的补充**：`Score` 还返回 `legend`，起点文件 §4 未列。（**是遗漏，不是错误**——它列的 `score, probabilities, confidence` 也都在。）

顶层请求字段（`https://docs.typesafe.ai/primitives/noul.md`）：`state`、`model`、`questions`。每个 question 有 `type` / `instructions` / 可选 `criteria`。

**255 选项上限 —— 厂商两处各自独立确认**：
- 文档 `https://docs.typesafe.ai/primitives/choice.md`：「A Choice question **accepts up to 255 options**」
- 发布博文：「…to **255**. For the higher cardinality choices, we do a 2 stage-system of scoring independently then making an explicit choice, hence the occassional slowdown.」

**并行与隔离**：文档「Every question in a request sees the same state, is **evaluated independently**」。发布博文：「**Parallel.** Generates all outputs in a single query.」

### 2.3 `confidence` 由概率分布形状导出 —— 厂商文档逐字

`https://docs.typesafe.ai/confidence.md`：
> 「All Score and Choice answers from TypeSafe include a `probabilities` property… The answer's `confidence` property collapses that shape into a single number from 0 to 1… (**Noul answers don't carry one.**)」
> 「**Confidence is derived from the probabilities** — confidence is a statistic computed from the probability distribution the answer already gives you.」

起点文件说「由概率分布形状导出（不是独立预测）」——**与原文一致**。起点文件那个被截断的例子，原文完整为：`billing` 胜出 0.84，confidence 仅 **0.596**，因为 `technical` 仍占 0.159。

### 2.4 第三方独立复述（Vercel / AI/ML API，我亲测其活体模型表）

```bash
curl -s -m 25 "https://ai-gateway.vercel.sh/v1/models"   # 第三方网关，非厂商
curl -s -m 25 "https://api.aimlapi.com/v1/models"        # 另一家第三方网关
```
- Vercel 条目 `typesafe-ai/jev` 的描述：「…returns **choices, scores, and boolean probabilities**… **Multiple questions can be evaluated in parallel within a single request.**」
- AI/ML API 条目 `typesafe/jev`（`"name":"Jev 1.13"`，`"developer":"TypeSafe AI"`，`"contextLength":32000`）描述：「…it returns **typed answers (yes/no, choice, score) with calibrated probabilities**…」

**两家互相独立的第三方网关，用自己的字段描述复述了同一套三原语语义** —— 这比多篇二手博客有分量。

**本条结论**：三条主张里唯一一条**同时**拿到「厂商文档原文」＋「第三方网关独立字段」＋「我亲测活体端点」三重证据的，就是这条。**可放心作为接线设计的依据。**

---

## 3. 主张三：延迟 70–500ms、每次约 0.042 美元 —— 原始来源定位 ＋ 单位纠错

### 3.1 原始来源：找到了

起点文件说「$0.042 目前只有标题级证据，须另找源头」。**原始来源已定位并亲自取回原文**：

**厂商自己的发布博文** —— `https://typesafe.ai/blog/introducing-system-one-models-and-jev`
（HTTP 200，254126 B；署名 **Diogo Almeida, founder, TypeSafe**；页面日期 **Sep 15, 2026**）

我抓到的原文片段（一字未改）：
> **Input tokens: $0.042 / MTok ($42 per billion tokens). Output tokens: FREE (too cheap to meter).**

> **End-to-end response time is 70ms-500ms for TypeSafe.** This can range from 40x-200x faster for the same levels of frontier intelligence for System One shaped queries.

**旁证：两家第三方网关都把这篇博文当作该模型的权威 URL 引用。** AI/ML API 的 `typesafe/jev` 条目里字段 `"url"` ＝ `https://typesafe.ai/blog/introducing-system-one-models-and-jev`。这说明它就是业界认定的 canonical 出处，不是我先入为主挑的。

同时，厂商文档 `https://docs.typesafe.ai/models` 独立复述同一数字：
> Jev 1.13 | `jev-1.13.0` | **Price (per Btok / per Mtok) $42 / $0.042** | Rate limits 250,000 tokens per second / 1,200 requests per minute | Context length 64k tokens per request… | Price: **Charged per input token. Output tokens are free.**

### 3.2 「在原始出处上确实成立」—— 分半判定

| 断言 | 判定 |
|---|---|
| 「延迟 70–500ms 出现在原始出处上」 | **✅ 成立**。发布博文逐字有，且文档另有「Rate limits 250,000 tokens per second / 1,200 requests per minute」 |
| 「`$0.042` 这个数字的原始出处是厂商自己」 | **✅ 成立**。发布博文 ＋ 文档 ＋ 第三方网关三方一致 |
| 「`$0.042` 是**每次**（/ 决策）的价格」 | **❌ 不成立。单位错了。** 原文是 **/ 1M 输入 token（/ MTok）**，输出 token 免费 |

**第三方独立复算同一单位（我亲测，非厂商口径）**：
```bash
curl -s -m 25 "https://ai-gateway.vercel.sh/v1/models"
# typesafe-ai/jev 条目：
#   "pricing":{"input":"0.000000042","output":"0"}
```
`0.000000042` USD/token × 10⁶ ＝ **$0.042 / 1M input tokens**；`"output":"0"` ＝ 输出免费。**Vercel 是独立第三方，它按 per-token 计价，不是 per-call。** 同一接口还给 `"context_window":32000`、`"type":"evaluation"`、`"zdr":"all"`、`"no_training":"all"`、`"released":1789430400`。

把 `1789430400` 换算：**2026-09-15T00:00:00 UTC** —— 与发布博文的 `Sep 15, 2026` 对得上。

### 3.3 单位错误是怎么产生的（可追责到起点文件自己）

- 起点文件 §4 **★已核**段（MarkTechPost）里，该文 `meta description` 原文我这次抓到了：「TypeSafe AI's Jev returns typed decisions with calibrated probabilities instead of text, **at $0.042 per 1M input tokens**」，正文另写「Jev costs **$42 per billion input tokens**」、「**Input costs $0.042 per 1M tokens.** Output tokens are free.」
- 起点文件 §4 **○仅搜索摘要**段写的是「定价 **$0.042 / 决策**（来源：kie.ai 博客标题「The $0.042 Decision Model」）」。

**即：正确单位当时就在它自己标 ★已核 的那一篇里；「/ 决策」是从另一条的博客标题里推出来的。** 起点文件把这条列为「只有标题级证据」，判断是对的——**而实际核对下来，标题级证据确实不够，并且确实错了。**

### 3.4 顺带：193.6× / 444.6× 的归因（我本次算术复算）

厂商首页原文我抓到：「**193.6x Faster, 444.6x Cheaper.** \*based on workflows for System One tasks (proof)」，并列出示例：TypeSafe AI `Cost $0.000081 Completed in 0.114s` vs LLMs `Cost $0.013880 Completed in 8.566s`。

我用本机 `py` 复算这组示例自身：
```
speedup = 8.566/0.114 = 75.1x
cost    = 0.013880/0.000081 = 171.4x
```
**示例自己只给出 75.1× / 171.4×，而首页标题写 193.6× / 444.6×** —— 两者不是同一口径。发布博文对此的自我说明是：「This is where the claims of 193.6x faster, 444.6x cheaper on our home page comes from, and **we expect that these are on the higher end of real world gains**」，并附「our published evals are generally run from our laptops on the West Coast」。

**第三方反向信号**：openchamber.dev 那篇（收集 2026-09-15～18 的 12,759 条推文）给出对照表，我读到原文：

| 指标 | TypeSafe 宣称 | 用户自报测量 |
|---|---|---|
| 提速 | 首页 193.6×，发布帖 20–200× | 215 个数中位数 **7×**（四分位 2× / 20×） |
| 降本 | 首页 444.6×，发布帖 40–400× | 180 个数中位数 **30×**（四分位 5× / 85×） |
| 延迟 | 70–500 ms 端到端 | 333 个数中位数 **76 ms**（四分位 2 ms / 270 ms） |
| 输入价 | $42 / billion tokens，输出免费 | 「**A published rate, not a measured result**」 |

该文自己声明：「**This is a survey of public reports, not an independent benchmark. We did not rerun the experiments.**」——引用时必须带上这句，它**不是**独立基准。

### 3.5 本节判定

> **主张 3 的写法「70–500ms、每次约 0.042 美元，在原始出处上确实成立」应当改为：**
> **「70–500ms 与 $0.042 两个数字确实在原始出处（厂商发布博文）上；但 $0.042 的单位是每 1M 输入 token（输出免费），不是每次决策。两者均为厂商自报值，非独立实测。」**

---

## 4. 我本次亲测的附加事实：本机到该端点的网络往返

这一条不在三条主张内，但它直接改变「调 API」的成本判断，且是**我本次唯一亲手测到的时延数据**。

在**无鉴权**（返回 403，未触发模型推理）的前提下，我测了从**本机**到 `https://api.typesafe.ai/v1/systemone` 的往返：

```bash
# 冷连接（含 TLS 握手）
curl -s -m 20 -D - -o /dev/null -w "total=%{time_total} connect=%{time_connect} appconnect=%{time_appconnect}\n" \
  -X POST -H "Content-Type: application/json" -d "{\"state\":\"x\",\"model\":\"jev-1.13.0\",\"questions\":{\"q\":{\"type\":\"noul\",\"instructions\":\"is this true\"}}}" \
  https://api.typesafe.ai/v1/systemone
```
实测：`time_connect=0.204s`，`time_appconnect=0.396s`，`time_total=0.586s`；同次响应头 `x-envoy-upstream-service-time: 3`（毫秒）。

```bash
# 连接复用（keep-alive，一次 curl 连打 5 发）
# 5 次 time_total：0.549848 / 0.177597 / 0.177867 / 0.183835 / 0.182965 秒
```

**读法与边界（不许过度解读）**：
- **暖连接 RTT ≈ 178–184 ms**（4 次一致），冷连接 ≈ 0.55–0.59 s。
- 同次 `x-envoy-upstream-service-time: 3` 说明：服务端处理这次（被拒的）请求只花 **3 ms**，所以上面那 ~580 ms 几乎全是**网络**，不是算力。
- **⚠️ 这不等价于 Jev 的推理延迟**——请求在鉴权层就被拒了，模型没跑。我只能说清一件事：**从本机出发，光网络地板就是 ~180 ms（暖）/~580 ms（冷），模型时间要在其上叠加。**
- 因此：厂商的 70–500 ms 是**从其美西网络环境测得**（发布博文自述「run from our laptops on the West Coast」）。**本机不在同一网络位置，不能把 70–500 ms 当作本机可期望值。** 这一条对「要不要走 API」是承重的，须在方案里显式入账。

---

## 5. 未能证实 / 明确标为「未核」的条目

| 条目 | 状态 | 说明 |
|---|---|---|
| `$0.042` 的**真实账单**（不是标价） | **无法证实** | 无 API key，无法发一次真实计费请求。所有价格证据都是**标价**（厂商文档、Vercel 计价表），没有任何一方提供实测账单 |
| 70–500ms 的真实推理时延 | **无法证实（我未亲测）** | 同上，无 key。我测到的 ~180ms 是网络地板，不是推理时延。唯一第三方数据是 openchamber.dev 的**推文调查**（中位 76ms，其自称非独立基准） |
| 「无自托管方案」是一个**全称否定** | **只能给出证据强度，不能证明** | 我能给的是：厂商 10 个 GitHub 仓无权重、HF 两个命名空间无 Jev、厂商全部一手材料零提及、两篇独立第三方均称 closed weights。**这是强证据，不是数学证明** |
| MarkTechPost 的「可用性：early access 候补名单」 | **未亲测** | 我没走 waitlist 流程，无法确认当前是否仍在排队 |
| Vercel 那条「no waitlist needed」的措辞 | **未核** | 见 §6，我猜的 Vercel 页面 URL 404；但 Vercel 的**活体模型 API 里确实有该条目**（§3.2），这点已亲测 |
| `$40M seed、DCVC 领投`（openchamber 提到） | **未核** | 超出本次承重范围，未花预算去核 |
| 创始人「参与 ChatGPT 指令跟随研究」 | **部分核到** | 发布博文署名 `Diogo Almeida, founder` 并自述「At OpenAI, I helped build the methods that made language models useful at following instructions」，**厂商自述**，非第三方独立证实 |

---

## 6. 我尝试过但失败的路径（如实留痕）

| 尝试 | 结果 | 后续处置 |
|---|---|---|
| `WebFetch https://www.marktechpost.com/2026/09/19/typesafe-ai-releases-jev/` | 「extraction model returned no text」 | 改用 `curl` 抓原始 HTML ＋ `py` 正则剥离标签，成功取到正文 |
| `curl https://huggingface.co/api/models?search=jev`（**直连**） | `HTTP 000`（连不上） | 加 `HTTPS_PROXY=http://127.0.0.1:2080` 后 HTTP 200。**结论：本机访问 HF 必须走代理**，直连结论不可信 |
| `curl https://huggingface.co/api/organizations/TypeSafeAI` | `{"error":"Sorry, we can't find the page you are looking for."}` | 该命名空间无组织页（本身即为证据，见 §1.2） |
| `curl https://vercel.com/ai-gateway/models/typesafe-ai/jev`（**我猜的 URL**） | `HTTP 404` | 改用 Vercel 网关的**活体模型表** `https://ai-gateway.vercel.sh/v1/models`，成功命中（见 §3.2）。**我猜的页面 URL 是错的，这不影响模型表证据** |
| `curl https://openrouter.ai/api/v1/models` | 446 个模型中 **`jev`/`typesafe` 命中 0** | 与 openchamber.dev 所称「OpenRouter 新加的 beta」**对不上**。如实报告：**我本次探测时 OpenRouter 公开模型表里没有 Jev**（可能已下架，或从未进公开表）。我不做因果猜测 |
| `https://kie.ai/blog/what-is-jev`（起点文件所称 $0.042 出处） | **未重试** | 起点文件已实测其返回区域通知；我既已找到厂商一手源，该路径不再必要 |

---

## 7. 三条主张合并后，对「调 API / 本地跑」的净结论

1. **要真 Jev ⇒ 只能调托管 API。** 主张 1 成立，且证据足够硬（厂商 10 仓无权重 ＋ HF 无权重 ＋ 厂商材料零提及 ＋ 两篇独立第三方）。
2. **要完全本地 ⇒ 那不是 Jev。** 厂商的「适配器」是让本地 LLM **冒充** Jev 客户端做对比；HF 上那批 `open-jev`/`Jev-Style` 是**第三方复刻**。两者都**没有厂商背书**，校准行为不可假定等同。**这是本棒最容易糊过去、也最不该糊过去的一步。**
3. **接口形态可放心照抄。** 单端点 / 三原语 / 类型化概率决策 —— 三重证据（厂商文档 ＋ 两家独立网关字段 ＋ 我亲测活体端点）齐备，可作为接线契约。
4. **价格进出账要用对单位。** 计费口径是 **$0.042 / 1M 输入 token，输出免费**；**没有** per-decision 价。任何按「每次 $0.042」算的成本模型都会**高估 1–3 个数量级**（一次决策通常只吃几百到几千 input token）。**起点文件里这个单位必须先改掉，否则下游方案的成本表会全错。**
5. **本机网络地板必须入账。** 我实测暖连接 RTT ≈ 178–184 ms（冷 ≈ 0.58 s），且该数**几乎全是网络**（服务端自报 3 ms）。厂商 70–500 ms 是美西口径。**任何端到端延迟预期都要在本机地板之上重新估。**
6. **延迟与加速比的宣称不能当承诺用。** 厂商自认 193.6×/444.6×「on the higher end of real world gains」；第三方推文调查的中位数是 7× / 30×（且自称非独立基准）；厂商首页示例自身只算出 75.1× / 171.4×（我复算）。

---

### 附：本件引用的全部一手 URL（均本次 HTTP 取回）

厂商一手：`https://typesafe.ai/blog/introducing-system-one-models-and-jev` · `https://docs.typesafe.ai/models` · `https://docs.typesafe.ai/primitives.md` · `https://docs.typesafe.ai/primitives/choice.md` · `https://docs.typesafe.ai/primitives/noul.md` · `https://docs.typesafe.ai/confidence.md` · `https://docs.typesafe.ai/concepts/system-one` · `https://docs.typesafe.ai/llms.txt` · `https://api.github.com/orgs/typesafe-ai` · `https://raw.githubusercontent.com/typesafe-ai/system-one-adapter-python/main/README.md`
第三方：`https://www.marktechpost.com/2026/09/19/typesafe-ai-releases-jev/` · `https://ai-gateway.vercel.sh/v1/models` · `https://api.aimlapi.com/v1/models` · `https://openchamber.dev/blog/jev-typesafe-ai/` · `https://openrouter.ai/api/v1/models`
我本次亲测端点：`POST https://api.typesafe.ai/v1/systemone`

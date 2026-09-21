# 10 · Jev 本体（Q2：Jev 是什么、干什么、什么人做的、怎么用、硬事实）

> 作者：Jev 本体调查员
> 证据等级：V1（本体存在，本次亲测 HTTP 探测到真实服务端点）——对**厂商宣称**一类可达 V1+V4（官方文档可复核）；对「权重／自托管」这一分水岭事实**本次做到了强否证级交叉验证**；但**没有任何一条我本次能跑的端到端推理**（无 API key，属 early access 候补名单），所以本体能力**未达 V3/V4**。

调查日期：2026-09-21。所有 URL 均为本次亲自取回并读到原文；命令与输出原样附上。

---

## 0. 一页结论（先说最硬的四件）

| # | 结论 | 一句话证据 |
|---|---|---|
| **A** | **Jev 是真东西，不是生造。** 官方 API 端点本次亲测活着，且按 OpenAI 风格返回鉴权错误（不是 404 假站）。 | `POST https://api.typesafe.ai/v1/systemone` → `[HTTP 403] {"detail":{"error_type":"authentication_error","message":"Must supply an API key! ..."}}`；`GET` 同路径 → `405 Method Not Allowed`；乱造路径 → `404`；带假 key → `401 Cannot authenticate with the server` |
| **B** | **权重未发布，无自托管路径——这一条我本次做到了否证级交叉验证，是本方案的分水岭。** | 官方 OpenAPI 只暴露 2 个路径（`/v1/systemone`、`/v1/models`），全部 `HTTPBearer` 鉴权；HF `author=TypeSafeAI` 只有 1 个模型且**不是** Jev（见 §5）；`huggingface.co/api/models/typesafe/jev-1.13` → `401`；官方文档全文 grep `open-source|open-weight|self-host|huggingface|download the weights` **零命中**（唯一命中是 `the same weights serve every account`） |
| **C** | **起点文件 §4 的「定价 $0.042／决策」是错的——$0.042 是「每 1M 输入 token」，不是「每次决策」。** 这是本次最重要的纠错。 | TypeSafe 官方博客原文：`Input tokens: $0.042 / MTok ($42 per billion tokens).`／`Output tokens: FREE`。按官方自己的示例用量 `input_tokens: 296` 折算，**每次决策 ≈ $0.0000124**，比「每次 $0.042」低约 **3 个数量级** |
| **D** | **延迟 70–500ms 的原始出处＝TypeSafe 官方博客，不是第三方。** | 官方博客原文：`End-to-end response time is 70ms-500ms for TypeSafe.`；第三方实测落在其中（~302ms／~115ms 两个独立读数），**但都是点值、无 p95/p99** |

---

## 1. 三类来源分开列（铁律 4）

### 1.1 厂商宣称（vendor claim）——有官方原文可核

| # | 宣称 | 原文片段（英文原样） | 出处 |
|---|---|---|---|
| V1 | 定位：「System One Model」第一号，不做文本生成 | `Jev is TypeSafe's flagship model and the first System One model. Send state and typed questions; get structured answers your code can use directly.` ／ `Jev is transformer-based, but it is not a large language model. It does not generate text.`（后者见 MarkTechPost 转述，见 §1.2） | docs `introduction.md:1`（`https://docs.typesafe.ai/introduction.md`） |
| V2 | 三种原语 | 官方表：`Choice`→`choice, probabilities, confidence`；`Score`→`score, legend, probabilities, confidence`；`Noul`→`noul (0 to 1)` | `https://docs.typesafe.ai/primitives.md`（本次取回，24,810 字节） |
| V3 | 上限：Choice 255、Score 2–10 | `You can have a maximum of 255 options per Choice.`（`api.md`）／`A Score should have at least two levels; the API accepts up to 10.`（`api.md`） | `https://docs.typesafe.ai/api.md` |
| V4 | 端点 | `POST https://api.typesafe.ai/v1/systemone` ＋ `Authorization: Bearer <API_KEY>` | `https://docs.typesafe.ai/api.md` |
| V5 | 价格 | `Input tokens: $0.042 / MTok ($42 per billion tokens).`／`Output tokens: FREE (too cheap to meter).` | `https://typesafe.ai/blog/introducing-system-one-models-and-jev` |
| V6 | 延迟 | `End-to-end response time is 70ms-500ms for TypeSafe. This can range from 40x-200x faster for the same levels of frontier intelligence for System One shaped queries.` | 同上博客 |
| V7 | 加速/降本宣称 | `This is where the claims of 193.6x faster, 444.6x cheaper on our home page comes from, and we expect that these are on the higher end of real world gains.` ← **厂商自认这是上界** | 同上博客 |
| V8 | 架构/训练 | `with a new model architecture, parallel sampler for maximum efficiency, and training method we call Reinforcement Learning for Calibrated Decisions (RLCD)`／`We named Jev after William Stanley Jevons.` | 同上博客 |
| V9 | 不训练用户数据 | `Jev is not trained on customer requests or responses.` | `https://docs.typesafe.ai/models.md` |
| V10 | 每账号同一套权重（**暗示权重存在但不下发**） | `Jev is not fine-tuned or LoRA-adapted with customer data. It is trained with RLCD to return calibrated decisions, and the same weights serve every account.` | `https://docs.typesafe.ai/models.md` |
| V11 | 自曝短板（罕见的诚实例外，应记功） | 官方专页列 9 类失败模式：不识字面以外含义、不会算数、不会计数、日期比较不可靠、长 state 含无关细节会掉分、对抗内容、自相矛盾的 criteria、常识不变量、不会生成。`Jev is not a calculator.`／`jev-1.13 does not count reliably.` 页脚 `Last reviewed 2026-09-17.` | `https://docs.typesafe.ai/model-jaggedness/jev-1.13.md` |

**厂商宣称里必须打星号的三处**（都是官方自己承认的）：

1. 官方博客明写速度评测是**从他们自己的笔记本、在他们自己的美西服务上跑的**：`We truly are that fast, though our published evals are generally run from our laptops on the West Coast (this is where our service is currently based).` ⇒ 这是**厂商自测**，不是第三方。
2. 官方博客明写对比 LLM 时**给 LLM 套了自家 wrapper**：`The LLMs use our System One LLM wrapper, which constrains LLMs to output structured decisions compatible with our API.` ⇒ 对比基线被厂商改造过。
3. 官方博客明写 LLM 侧成本数字**取自 OpenRouter**，并有 `there almost certainly is bias here` ⇒ 分母不是他们自己量的。

### 1.2 第三方报道（非厂商自测，但仍是转述/独立媒体）

| # | 来源 | 我读到的原文片段 | 性质 |
|---|---|---|---|
| T1 | MarkTechPost，署名 Asif Razzaq，2026-09-19<br>`https://www.marktechpost.com/2026/09/19/typesafe-ai-releases-jev/` | `TypeSafe has not published weights, a parameter count, or a self-hosting option.` ／ `TypeSafe has not disclosed the architecture.` ／ `Jev supports up to 255 options`（Choice）／ `TypeSafe reports 70ms to 500ms end-to-end response times.` ／ `Input costs $0.042 per 1M tokens. Output tokens are free.` | **行业媒体转述厂商**，非实测 |
| T2 | TechCrunch，Tim Fernholz，2026-09-18 11:49 AM PDT<br>`https://techcrunch.com/2026/09/18/a-new-kind-of-ai-model-from-a-chatgpt-inventor-is-thrilling-developers/` | 创始人 `Diogo Almeida`；`Two years ago, Almeida left OpenAI to start TypeSafe AI`；`Almeida is "tight-lipped about the model's architecture"`；`outside observers suspect is built on top of an open-weight LLM`；开发者引述：Vercel 的 Pranit Sharma 称把 OpenAI Luna 换成 Jev 后 `five to 18 times more quickly and with greater accuracy`；Bryo AI CTO Nikhil Mudholkar 对比 Gemini：Gemini `slightly more accurate` 但 `10 to 20 times more expensive` | **行业媒体＋开发者轶事**；数字均为受访者自述，非受控实测 |
| T3 | DCVC（投资方）新闻稿，2026-09-15<br>`https://www.dcvc.com/news-insights/typesafe-emerges-from-stealth-with-a-new-way-of-doing-ai/` | `$40 million Series Seed`；`DCVC leads the $40 million Series Seed`；`TypeSafe cofounder and CEO Diogo Almeida`；`frontier-level intelligence at less than 100 milliseconds of latency` | **利益相关方**（领投方），降权 |
| T4 | OpenRouter 模型页（本次亲自取回 HTML 并抽正文）<br>`https://openrouter.ai/typesafe` | `TypeSafe: Jev 1.13 … by typesafe Sep 18, 2026 32K context $0.042 /M input tokens $0 /M output tokens` ／ `Jev Latest … by typesafe Sep 18, 2026 32K context` ／ `OpenRouter serves 2 Typesafe models behind one OpenAI-compatible API` | **第三方分发方的独立标价**——这是对厂商价格宣称的**独立佐证**（来源不同、口径一致） |
| T5 | kingy.ai 评测<br>`https://kingy.ai/blog/typesafe-jev-review-the-ai-model-that-doesnt-generate-text/` | 摘要原文：`Latency claim, 70–500 ms … Vendor-published; no independent p95/p99 measurement` | **第三方评测，且明确指认延迟无独立 p95/p99**——与我本次独立结论一致 |
| T6 | modemguides.com<br>`https://www.modemguides.com/blogs/ai-news/jev-typesafe-reality-check-run-locally` | 摘要原文：`Jev is a hosted, closed-weight API in early access. There is nothing to download, and TypeSafe has published no self-host or open-weight path.` | 第三方对「无自托管」的**独立同向结论** |
| T7 | apidog.com<br>`https://apidog.com/blog/openjev-open-source-jev-alternatives/` | 摘要原文：`It's closed weights, API only, served at POST https://api.typesafe.ai/v1/systemone as jev-latest.` | 同上，第二路独立同向结论 |
| T8 | kie.ai 博客 `https://kie.ai/blog/what-is-jev` | 搜索摘要（**未核原文**）：`Jev is not open source, and TypeSafe AI has not published downloadable Jev weights or an open license.`。★**本次用 WebFetch 直接取回该 URL 仍拿到「服务区域通知」而非正文**（与起点文件 §4 主代理遭遇一致），故本条**只有摘要级证据**，标「未核原文」。 | 摘要级，降权 |

### 1.3 我本次亲测（hard probe）

以下全部是我本次在这一台机器上跑出来的，附命令与原始输出。

| # | 测什么 | 命令 | 我看到的输出 |
|---|---|---|---|
| M1 | 端点是否真存在 | `curl -s -m 15 -w "\n[HTTP %{http_code}]\n" https://api.typesafe.ai/v1/systemone -X POST -H "Content-Type: application/json" -d '{"model":"jev","state":{},"questions":{}}'` | `{"detail":{"error_type":"authentication_error","message":"Must supply an API key! Check your request and try again."}}` ＋ `[HTTP 403]` |
| M2 | 方法路由是否真实现 | `curl -s https://api.typesafe.ai/v1/systemone` | `{"detail":"Method Not Allowed"}` ＋ `[HTTP 405]` |
| M3 | **对照组**：乱造路径 | `curl -s https://api.typesafe.ai/v1/definitely-not-real-xyz` | `{"detail":"Not Found"}` ＋ `[HTTP 404]` ⇒ 前面的 405/403 不是「什么都返回一样」的假站 |
| M4 | 假 key 的行为 | `curl -s -H "Authorization: Bearer sk-invalid-probe" https://api.typesafe.ai/v1/models` | `{"detail":{"error_type":"authentication_error","message":"Cannot authenticate with the server. Please check your API key and try again."}}` ＋ `[HTTP 401]` ⇒ 403/401 两级区分，是真实鉴权中间件 |
| M5 | 服务栈指纹 | `curl -s -D - -o /dev/null -X POST ... https://api.typesafe.ai/v1/systemone` | 响应头：`server: istio-envoy`、`x-typesafe-request-id: req_01a0c312045b700c9a564b37bc09bd7b`、`x-envoy-upstream-service-time: 6` |
| M6 | **没有 OpenAI 兼容层** | `curl -s -X POST ... https://api.typesafe.ai/v1/chat/completions` | `{"detail":"Not Found"}` ＋ `[HTTP 404]` ⇒ 只有 Jev 自己的 decision 端点，无 chat/completions |
| M7 | 官方 OpenAPI 契约 | `curl -s https://api.typesafe.ai/openapi.json`（14,158 字节） | `openapi: 3.1.0`、`info.title: TypeSafe`、`info.version: 0.2.0`、**`paths` 只有 `/v1/systemone` 与 `/v1/models`**、`securitySchemes: {"HTTPBearer":{"type":"http","scheme":"bearer"}}`、**无 `servers` 字段** |
| M8 | **无官方权重（HF 侧）** | `HTTPS_PROXY=http://127.0.0.1:2080 curl -s "https://huggingface.co/api/models?author=TypeSafeAI&limit=100"` | **只有 1 个模型**：`TypeSafeAI/Step-5-Preview-BF16`（`createdAt 2026-09-20`，tags 含 `stepfun`、`license:other`）——**这是 StepFun 的 Step-5 权重被放在同名 org 下，不是 Jev**。另 `huggingface.co/api/models/typesafe/jev-1.13` → `401`（不存在）。**注意命名撞车：HF 的 `TypeSafeAI` 与 TypeSafe AI 公司不可混为一谈** |
| M9 | 官方文档「权重/开源/自托管」全文检索 | `grep -rniE "open[- ]?source\|open[- ]?weight\|self[- ]?host\|huggingface\|download the weights\|license\|parameter count" md/`（24 个官方 .md 页） | **零命中**；唯一相关命中是 `models.md:44` 的 `the same weights serve every account`（另有若干 `parameters` 是讲 tool-call 参数，无关） |
| M10 | SDK 是否真实发布 | `curl -s https://pypi.org/pypi/typesafe-sdk/json` | `PyPI name: typesafe-sdk`、`version: 0.7.0`、`requires_python: >=3.10`、classifier `License :: OSI Approved :: MIT License`、`summary: Python SDK for TypeSafe AI API`、文件 `typesafe_sdk-0.7.0-py3-none-any.whl`（35KB，`2026-09-18T09:12:29`）、**首个版本 `0.0.1a0` 上传于 `2026-09-09T10:34:07`**（⇒ **SDK 比公开博客早 6 天**） |
| M11 | JS SDK | `curl -s https://registry.npmjs.org/@typesafe-ai/sdk` | `@typesafe-ai/sdk`、`latest: 0.6.0`、`license: MIT`、`engines {"node":">=20"}`、`0.0.0-bootstrap.0` 发布于 `2026-09-12T02:56:19Z`、`0.6.0` 发布于 `2026-09-15T18:17:19Z` |
| M12 | 官方 GitHub 组织存在（间接） | GitHub 搜索返回 `typesafe-ai/skills`（`Stars 1353`、`lic MIT`、`pushed 2026-09-12T05:42:06Z`、描述 `Agent skills for building with TypeSafe's System One API`） | ⚠️ **本条为搜索 API 返回、非直查**：我直查 `api.github.com/orgs/typesafe-ai` 时**匿名配额已耗尽**（`"core":{"limit":60,"remaining":0}`），所以**只登记为弱证**，README 内容本次未核 |
| M13 | 反面证据：HF 上的 `jev` 全非官方 | `HTTPS_PROXY=... curl "https://huggingface.co/api/models?search=jev&limit=40"` | 40 条结果里 2026-09 之后的全部是**社区复刻**：`com-kotobalabs/open-jev-deberta-v3-large`、`ZefanCai/Open-Jev-9B`、`ZefanCai/Open-Jev-2B`、`vagmi/jev-lite`、`Meanblock/JEV-CPU`、`mobarmg/jev-schema-scorer-deberta-v3-large`、`argos1111/modernbert-ja-310m-jev`、`NicolaiMTLassen/bonzi-1.7b-v1-jev`、`azharmo/build-jev-from-scratch`、`lewislululu/jevon`。**没有一条挂在 TypeSafe 名下** |

⚠️ **我做不到的事，如实登记**：
- **无 API key，无法跑任何一次真实推理**。`console.typesafe.ai/keys` 需注册（early access 候补名单），本次**未注册**（避免动任何账号/配置）。所以 Jev 的**实际输出质量、真实延迟、真实校准**本次**未达 V3/V4**，全部依赖别人的读数。
- WebFetch 对 `docs.typesafe.ai`、`typesafe.ai`、`gadgetpilipinas.net`、`kie.ai` 多次返回空正文；我是改用 `curl` 落地 HTML 后自写抽取脚本（`.scratch/jev-integration/_q2tmp/extract.cjs`）读的正文。
- HuggingFace **直连不通**（`[HTTP 000]`），必须走 `.scratch/jev-integration/00-起点事实与待核清单.md §7` 给的代理 `127.0.0.1:2080` 才通——这一点值得写进交接件。

---

## 2. 「Jev 到底是什么、干什么」——已核实的本体

### 2.1 身份牌

| 项 | 值 | 来源等级 |
|---|---|---|
| 公司 | **TypeSafe AI**（旧金山） | 官方站／DCVC／TechCrunch |
| 产品名 | **Jev**（取自 William Stanley Jevons） | 官方博客 FAQ |
| 模型类名 | **System One Model**（借 Kahneman《思考，快与慢》） | 官方博客 FAQ＋`concepts/system-one.md` |
| 创始人／CEO | **Diogo Almeida**；官方博客署名 `Diogo Almeida, founder, TypeSafe`；DCVC 称 `cofounder and CEO`。TechCrunch 另列 `Erik Gafni, Sasha Sheng` 为 co-founders（该三人名单**出现在 TechCrunch 图片说明**，我读到的是 `TypeSafe AI co-founders Erik Gafni, Sasha Sheng, and Diogo Almeida`） | 官方＋TechCrunch＋DCVC **三源一致（Almeida）**；另两位仅 TechCrunch |
| 融资 | **$40M Series Seed，DCVC 领投** | DCVC 新闻稿（利益相关方）；TechCrunch 正文**未**提金额 |
| 发布日 | **2026-09-15**（官方博客页头 `Sep 15, 2026`；DCVC 同日）。⚠️ 与起点文件 §4 的「2026-09-15（dev.to 摘要）」**一致，现升为★已核**。另有 **OpenRouter 列为 2026-09-18**（分发上线日，非发布日）；`explainx.ai` 说的 9-16 **与官方不符，判为错** | 官方博客＋DCVC；OpenRouter HTML |
| 现行版本 | **`jev-1.13.0`**（别名 `jev-latest` / `jev-preview` **当前都指向它**）。官方文档页名 `Jev 1.13 jaggedness`，API 示例响应的 `model` 字段是 `jev-1.13.0`。⚠️ 官方 cookbook 里还留着 `TYPESAFE_MODEL = "jev-1.12"`（旧版残留） | `models.md`、`api.md`、`model-jaggedness/jev-1.13.md`、`cookbooks/parallel_questions.md:49` |
| 当前状态 | **托管 API ＋ early access 候补名单**。官方博客：`Our first public model is Jev, available today in early access.`／`Today, we are opening early access and bringing developers off the waitlist as quickly as we can.` | 官方博客 |

### 2.2 「System One Model」的官方定义（原文）

> `System One models are a class of AI models built to make fast, structured decisions that software can use directly. A System One model evaluates a state and returns typed answers and probabilities.`
> `Like an LLM, a System One model understands natural-language input. It returns typed decisions and probabilities rather than generated text.`
> `System One models are trained for calibrated decisions: their probabilities are optimized against outcomes to reflect uncertainty. Calibration is measured across groups of predictions; it does not guarantee that an individual answer is correct.`
> `System One models do not write replies, produce code, or generate explanations of their reasoning.`

来源：`https://docs.typesafe.ai/concepts/system-one.md`（本次取回，4,061 字节）。

注意最后一句的**边界**：**不给理由、不给解释**。这一点直接决定它在本项目里只能当「判据原语」，不能当「解释器」。

### 2.3 三种原语的确切语义与返回字段（全文照抄官方契约）

来源：`https://docs.typesafe.ai/api.md`（真实 OpenAPI：`https://api.typesafe.ai/openapi.json`，我本次逐字段 dump 过 `components.schemas`）。三者皆有共同字段 `type`。

**① Noul**（念「noul」；「这是真的吗」）

| 问侧 | 答侧 |
|---|---|
| `type: "noul"`（必填，常量）<br>`instructions: string \| object \| array`（**必填**，是/否问题本身）<br>`criteria: object`（选填）▸ `true` = 「接近 1 是什么意思」的描述<br>▸ `false` = 「接近 0 是什么意思」的描述 | `type: "noul"`<br>`noul: number`（0–1，**就是「是」的概率**）<br>**没有 `confidence`**——官方明确：`Noul answers don't carry one.` |

- 语义金句（官方）：`A Noul value of 0.5 means the model gives yes and no equal probability. It does not mean the candidate has a medium skill level.`
- 答侧只有 `type` + `noul` 两个字段（`required: ["noul","type"]`）——**这是最干净、最可用作「真值锚前哨」的原语形态**。

**② Choice**（从你给的集合里选 1）

| 问侧 | 答侧 |
|---|---|
| `type: "choice"`<br>`instructions`（必填）<br>`criteria: map<string, string\|object\|array\|null>`（**必填**，option→评分标准描述；`null` 表示该项无需额外描述）<br>**上限 255 个选项** | `type: "choice"`<br>`choice: string`（概率最高那个选项名）<br>`probabilities: map<string, number>`（**每个选项一个概率，和为 1**）<br>`confidence: number`（0–1，**由概率分布形状导出**） |

**③ Score**（按有序档位打分）

| 问侧 | 答侧 |
|---|---|
| `type: "score"`<br>`instructions`（必填）<br>`criteria: array<string\|object\|array>`（**必填**，**有序**档位描述；**至少 2 档，API 上限 10 档**） | `type: "score"`<br>`score: number`（**概率加权期望值，可以落在两档之间**，官方示例 `1.05`、`1.7`）<br>`legend: map<string,string>`（档位序号→原描述，键是字符串 `"0"/"1"/"2"`）<br>`probabilities: map<string, number>`（每档一个概率，键与 legend 同）<br>`confidence: number` |

**`confidence` 的确切定义（我要单独强调，因为它是本方案的关键）**：

- 官方：`The answer's confidence property collapses that shape into a single number from 0 to 1`（`confidence.md`）
- 官方：`confidence is a statistic computed from the probability distribution the answer already gives you.`
- **官方 playground 的源码里给了近似公式**（我本次从 `confidence.md` 抽出的 JS 原文）：
  ```js
  function choiceConfidence(values) {
    const count = values.length;
    const peak = Math.max(...values) / 100;
    return Math.max(0, Math.min(1, (count * peak - 1) / (count - 1)));
  }
  ```
  且该页 `<details>` 自述：`This demo uses (3 × largest probability − 1) / 2 to approximate confidence for three options.`
- ⇒ **`confidence` 不是独立预测，是 `probabilities` 的确定性函数**（对 n 个选项，peak=1/n 时 confidence=0，peak=1 时 confidence=1）。
- ⚠️ **这对本方案是坏消息也是好消息**：坏消息＝`confidence` **不携带 `probabilities` 之外的任何新信息**，别把它当第二路独立证据入账本；好消息＝它是个免费的、单调的集中度指标，**可当阈值旋钮**。
- 官方开放态度：`you are never locked into our definition … which is exactly why we give you the full probabilities in the response.`

**并行与隔离（官方原话，直接影响能否一次问多题）**：
- `Every question in a request sees the same state, is evaluated independently, and returns a typed answer under the ID you chose.`
- `System One models evaluate every question in a request in parallel. Adding questions barely changes the response time and costs only the tokens for the extra questions, which are cheap. Asking a question you might not need is close to free.`
- **关键点**：`Questions in the same request are independent: one answer does not become context for another question.`
- **问题 ID 不进模型**：`The key is not sent to the underlying model and is not used in inference.`
- **官方实测的批处理收益**（cookbook 里带原始输出，非空口）：`one call, all 13   1   $0.000497   0.27s` ／ `13 calls, one each  13   $0.006090   2.71s` ／ `batching: 12.2x cheaper, 10.0x faster`（`https://docs.typesafe.ai/cookbooks/parallel_questions.md`）

### 2.4 端点与请求/响应格式（我按真实 OpenAPI 逐字段核过）

**只有两个端点**（`api.typesafe.ai/openapi.json`，`info.version 0.2.0`）：

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <API_KEY>
Content-Type: application/json
```
```http
GET  https://api.typesafe.ai/v1/models    # 列出账号可用的模型名/别名
```

请求体（`SystemOneRequest`，`required = ["model","questions","state"]`）：

```json
{
  "state": "string | object | array",
  "model": "jev-latest",
  "questions": {
    "<你自己起的 key>": {
      "type": "noul | choice | score",
      "instructions": "string | object | array",
      "criteria": "(noul 选填 object｜choice 必填 map｜score 必填 array)"
    }
  }
}
```

- `questions` **`minProperties: 1`**（至少 1 题）。
- `state` 支持 `string`/`object`/`array`（官方 schema：`anyOf: [string, object, array]`）。
- **点路径引用**：`instructions` 里可用反引号点出 state 的嵌套字段，如 `` "Does `ticket.messages[0].text` request a refund?" ``。

响应体（`SystemOneResponse`，`required = ["model","answers","usage"]`）：

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "<同一个 key>": { "type": "...", ... }      // 结构随题型，见 §2.3
  },
  "usage": { "input_tokens": 296, "output_tokens": 20 }
}
```
- `usage.input_tokens` 描述原文：`Number of billable input tokens used to evaluate the request.`
- `usage.output_tokens` 描述原文：`Number of output tokens used to answer the questions. **Output tokens are currently free of charge.**`

错误码（官方表＋我 M1–M4 实测一致）：

| 码 | 含义 | 本次实测 |
|---|---|---|
| `401 Unauthorized` | key 无效 | ✅ 实测命中（假 key） |
| `403` | **未提供 key**（官方表**未列此码**，但我实测到了） | ✅ 实测命中 |
| `405` | 方法不对（官方表未列） | ✅ 实测命中（GET 该路径） |
| `422 Unprocessable Entity` | 请求体校验失败 | 未实测（需 key） |
| `429 Too Many Requests` | 超限，SDK 默认指数退避 + 尊重 `retry-after` | 未实测 |
| `529 Overloaded` | 过载 | 未实测 |

**限流与容量（官方 `models.md`）**：`250,000 tokens per second / 1,200 requests per minute`；`Context length: 64k tokens per request; 32k tokens for state plus the longest question`；官方标注 `Rate limits are adjusting dynamically … can change without notice`（**限流是动态的，别拿它做硬承诺**）。
⚠️ **口径冲突提醒**：OpenRouter 把 Jev 1.13 标为 `32K context`，官方文档写 `64k tokens per request`。**两处口径不一致，我没有 key 无法实测裁决**，先并列登记。

**输入模态**：`Input: Text only. String, JSON object, or array of text values. No image, audio, or video input.`（`models.md`）——**纯文本，无图像/音频/视频**。

**语言支持（对中文项目极重要）**：`English is the primary training language and where accuracy is currently best. Other languages, including CJK scripts, are handled but not equally well; test on your own content before relying on Jev for a non-English workload`（`models.md`）⇒ **中文是官方承认的劣势区，必须自测**。

### 2.5 SDK（我核过真实包元数据，不是抄文档）

| 语言 | 包名 | 版本 | 要求 | License | 首次发布 | 最新发布 |
|---|---|---|---|---|---|---|
| Python | `typesafe-sdk` | **0.7.0** | `requires_python >=3.10` | MIT（classifier） | `0.0.1a0` @ `2026-09-09T10:34:07` | `0.7.0` @ `2026-09-18T09:12:29`（whl 35KB） |
| JavaScript | `@typesafe-ai/sdk` | **0.6.0** | `engines: node >=20` | MIT | `0.0.0-bootstrap.0` @ `2026-09-12T02:56:19Z` | `0.6.0` @ `2026-09-15T18:17:19Z` |

- 官方还提供 cURL 示例、一个 Claude Code plugin marketplace 里的 **agent skill**（`claude plugin marketplace add typesafe-ai/skills` / `npx skills add typesafe-ai/skills --skill typesafe-ai`），以及 `console.typesafe.ai` 的 playground（share link 用 LZ-string 压缩内嵌 state+questions，我在 `primitives.md` 里读到了 `buildHref` 的实现）。
- ⚠️ **仓库地址**：PyPI 元数据 `project_urls.Repository = https://github.com/typesafe-ai/typesafe-sdk-python`，但**我本次未能直查该仓库**（GitHub 匿名配额耗尽），故只登记为「PyPI 元数据声称」，**未核 GitHub 实况**。

---

## 3. ★分水岭专项：权重是否发布／能否自托管

**结论：未发布权重，无自托管方案，官方亦未公布参数量与架构。** 我用**六路独立证据**交叉验证（不是照抄 MarkTechPost 一句）：

| 路 | 证据 | 强度 |
|---|---|---|
| 1 | **官方 OpenAPI 只有 2 个 HTTP 路径，全部 `HTTPBearer` 鉴权**：`paths: ["/v1/systemone","/v1/models"]`；无 `/weights`、无 download、无 artifact 端点。本次亲测 `curl api.typesafe.ai/openapi.json` | **强（一手契约）** |
| 2 | **官方文档 24 页全文 grep 权重/开源/自托管关键词零命中**；唯一相关句是 `the same weights serve every account`（`models.md:44`）——**权重要么存在要么不存在，但官方只承认「同一套权重服务所有账号」，从不承诺下发** | **强（一手文本）** |
| 3 | **HuggingFace 无官方 Jev 权重**：`author=TypeSafeAI` 只返回 1 个模型且是 StepFun 的 Step-5（`TypeSafeAI/Step-5-Preview-BF16`，tags 含 `stepfun`）；`models/typesafe/jev-1.13` → `401`（不存在） | **强（一手 API）** |
| 4 | **MarkTechPost 明文**：`TypeSafe has not published weights, a parameter count, or a self-hosting option.`／`TypeSafe has not disclosed the architecture.` | 中（行业媒体转述） |
| 5 | **独立第三方两路同向**：modemguides（`closed-weight API … nothing to download`）；apidog（`closed weights, API only`） | 中 |
| 6 | **kie.ai 摘要同向**：`Jev is not open source, and TypeSafe AI has not published downloadable Jev weights or an open license.`（**摘要级，原文未取到**——与起点文件 §4 主代理遭遇一致） | 弱（摘要） |

**反证也查了，没有找到**：我本次**没有**找到任何官方的自托管方案、权重下载、模型卡、参数表、开源 license、HuggingFace/GitHub 权重仓库、On-Prem 部署文档。官方 `legal.md` 只列 DPA / MCA / Privacy Policy 三件法务文档，**没有开源许可**。

**⇒ 对方案的含义（一句话）**：**「把 Jev 搬进本机」这件事在 2026-09-21 是不存在的选项**。任何「本地跑 Jev」的说法，指的必然是社区复刻（HF 上那 10 个 `*-jev` 项目），**不是 TypeSafe 的 Jev**（M13 已列名）。起点文件 §6 那张 28 条的表，其标题「Open Source · Open weights and code that rebuild the System One **shape**」里的 **shape** 一词才是关键——**它们复刻的是形状，不是权重**。

**架构与参数量：目前是空白，只有传闻。** 我能找到的唯一「架构」说法来自**竞品模型卡**：`| **TypeSafe Jev** (\`typesafe/jev-1.13\`) | Proprietary MoE | 96.6% | … | ~115 ms (API) | Cloud Only ($0.042/1M tokens) |`（`https://huggingface.co/wfzyx/von-1.0` 的 README，我本次取回 19,589 字节原文）。⚠️ **这是 395M 小模型作者的对手描述，无引用、无出处，标「第三方未证实传闻」，不得当事实用**。TechCrunch 侧的口径是 `Almeida is "tight-lipped about the model's architecture"` / `outside observers suspect is built on top of an open-weight LLM`。

---

## 4. ★追源专项：`$0.042` 与 `70–500ms` 的原始出处

### 4.1 `$0.042` —— 起点文件的定性是错的，此处纠正

**原始出处＝TypeSafe 官方博客**（不是 kie.ai，kie.ai 只是把数字抄进标题）：

> `Input tokens: $0.042 / MTok ($42 per billion tokens).`
> `Output tokens: FREE (too cheap to meter).`
> —— `https://typesafe.ai/blog/introducing-system-one-models-and-jev`（我本次 curl 落地 254,126 字节 HTML，抽取后 13,853 字节文本，原文在上述行号 115/117）

**三方独立口径一致（都是每 1M 输入 token）**：

| 来源 | 原文 |
|---|---|
| 官方博客（★一手） | `$0.042 / MTok ($42 per billion tokens)`，output FREE |
| 官方文档 `models.md`（★一手） | 表格 `Price (per Btok / per Mtok) \| \$42 / \$0.042` |
| 官方 OpenAPI `Usage`（★一手） | `input_tokens`: `Number of billable input tokens`；`output_tokens`: `… currently free of charge` |
| 官方 cookbook 源码（★一手） | `PRICE = (0.042, 0.00,)  # $ per 1M tokens (input, output); TypeSafe jev-1.12 as of 2026-09` |
| OpenRouter 模型页（★第三方，独立标价） | `$0.042 /M input tokens $0 /M output tokens` |

**⇒ 正确说法是「$0.042 ／ 每 100 万输入 token」，不是「$0.042 ／ 每次决策」。**

**每次决策到底多少钱？（我用官方自己的示例做算术，非臆测）**
官方 API 文档示例响应的 `usage` 是 `{"input_tokens": 296, "output_tokens": 20}`：

```
vendor example usage input_tokens=296 ->  $0.000012432 per decision
1M tokens / 296 tok per call        = 3378 decisions per 1M tokens billed
claim check: $0.042 per DECISION would imply $141.89 per 1M tokens at 296 tok/call
```
（命令：`node -e "const cost=t=>t/1e6*0.042; console.log(cost(296))"`）

⇒ **「每次 $0.042」这个说法把单位搞错后放大了约 3 个数量级**。官方博客那句 `which ends up costing ~$7/hour`（Doom demo 每秒 10 次查询）反算也与 token 计价吻合：$7/36000 次 ≈ $0.000194/次（量级一致）。

**kie.ai 那篇的标题 `The $0.042 Decision Model` 是错的口径**——它把 `/M input tokens` 读成了 per-decision。起点文件 §4 把它列为「○仅搜索摘要」，本次进一步判定：**不仅未核，而且定性错误**。

### 4.2 `70–500ms` —— 原始出处同样是官方博客

**原始出处＝TypeSafe 官方博客**：

> `End-to-end response time is 70ms-500ms for TypeSafe. This can range from 40x-200x faster for the same levels of frontier intelligence for System One shaped queries.`

**官方自己给这条打了折扣**（同一篇博客）：
> `Speed per call: We truly are that fast, though **our published evals are generally run from our laptops on the West Coast** (this is where our service is currently based).`

**第三方读数（都落在区间内，但都是点值）**：

| 读数 | 来源 | 性质 |
|---|---|---|
| **~302 ms/case**（78 题分类长 case） | ap[e]Chat Blog `https://ayourtch-llm.github.io/apchat-blog/posts/2026-09-20-jev-clones-measured` 的 `mean ms / case` 列 | **第三方实测**（但见 §5 的口径警告） |
| **~115 ms (API)** | 竞品 Von 的模型卡 `https://huggingface.co/wfzyx/von-1.0` | 竞品方声称，无出处，降权 |
| **median 76 ms**（分位 2ms / 270ms，n=333 条自述） | OpenChamber `https://openchamber.dev/blog/jev-typesafe-ai/` | **社交媒体自述的汇总量**，非受控实测 |
| 官方 cookbook：单次 13 题 `0.27s` | `https://docs.typesafe.ai/cookbooks/parallel_questions.md`（带原始 stdout） | 官方自跑 |

**⇒ 判定**：`70–500ms` 是**厂商宣称**，**没有任何独立的 p95/p99 测量**（kingy.ai 第三方评测独立得出同一判断：`Vendor-published; no independent p95/p99 measurement`）。

### 4.3 `193.6× / 444.6×` —— 官方自认是上界，且被第三方头条复核为「宣称 vs 实测有数量级落差」

- **原始出处＝官方首页**，官方博客自认：`This is where the claims of 193.6x faster, 444.6x cheaper on our home page comes from, and **we expect that these are on the higher end of real world gains**.`
- 官方同时承认三条偏置：评测是自己笔记本跑的；LLM 基线套了自家 wrapper；LLM 成本取自 OpenRouter（`there almost certainly is bias here`）。
- **第三方复核**：OpenChamber（起点文件 §5 红灯点，但我本次真读到了正文）抽出 12,759 条推文、分开「作者自己量的」与「作者转述的」：

  | 指标 | TypeSafe 宣称 | 用户自述测量 |
  |---|---|---|
  | 加速 | `193.6×` on the homepage | `Median 7× across 215 figures, with quartiles of 2× and 20×` |
  | 降本 | `444.6×` | `Median 30× across 180 figures, with quartiles of 5× and 85×` |
  | 延迟 | `70 to 500 ms` | `Median 76 ms across 333 figures, with quartiles of 2 ms and 270 ms` |

  且该文自陈方法边界：`This is a survey of public reports, not an independent benchmark. We did not rerun the experiments.`
  ⇒ **结论：标题「193× 在转发里，7× 在实测里」这一落差本身是有据的**，但**它自己也不是独立实测，是自述汇总**。**两级降权后使用**。

---

## 5. ★专项：有没有真正的独立第三方实测？

**有一份，而且是这一批里唯一称得上「独立实测」的。** 起点文件 §4 的「未核」项在此补齐。

### 5.1 主证据：ap[e]Chat Blog（独立第三方，2026-09-20）

`https://ayourtch-llm.github.io/apchat-blog/posts/2026-09-20-jev-clones-measured`（我本次 curl 落地 12,170 字节 HTML → 7,465 字节正文，全文读完）

**方法（原话）**：
- 套件：`jabr/classifier-benchmark` — `8 tasks, 78 cases, across the three primitives Jev exposes: choice (multi-class routing), noul (a calibrated yes/no probability), and score (a position on an ordered rubric)`。
- 硬件：`Everything ran on one Mac mini, M4 Pro, 24 GB, on MPS`。
- **有对照组（这是它比同批其他来源可信的关键）**：`Before trusting any number: GLINER2 reproduced its published results exactly, on all eight tasks. That is the only reason the rest of the table means anything.` ⇒ 证明测量装置本身没在移动分数。
- **Jev 那一列有明确免责**：表格脚注 `* The Jev column comes from the suite author's run against the hosted API. We did not run it.` ⇒ **Jev 的数是「套件原作者跑的」，ap[e]Chat 只是转述**。**这一条必须标出来。**

**结果表（逐格照抄）**：

| task | Von | GLiNER2 | Laya | Bonsai 1-bit | **Jev\*** |
|---|---|---|---|---|---|
| support_department (choice) | 0.867 | 0.933 | 0.533 | 0.933 | **1.000** |
| email_intent (choice) | 1.000 | 0.900 | 0.900 | 1.000 | **1.000** |
| refund_eligible (noul) | 0.700 | 0.500 | 0.700 | 1.000 | **1.000** |
| urgency (noul) | 0.250 | 1.000 | 0.875 | 1.000 | **1.000** |
| secret_leak (noul) | 0.625 | 0.500 | 0.500 | 1.000 | **1.000** |
| frustration_level (score) | 0.889 | 1.000 | 0.667 | 0.667 | **1.000** |
| incident_severity (score) | 1.000 | 0.556 | 0.222 | 0.556 | **0.778** |
| review_sentiment (score) | 0.667 | 0.889 | 0.333 | 0.889 | **1.000** |
| **micro accuracy** | 0.769 | 0.795 | 0.590 | 0.885 | **0.974** |
| **macro accuracy** | 0.750 | 0.785 | 0.591 | 0.881 | **0.972** |
| **mean ms / case** | 47 | 66 | 30 | 1682 | **~302** |

**要点**：
- **Jev 准确率 0.974 micro / 0.972 macro，全场第一**，且领先最好的开源模型 GLiNER2（0.795）约 18 个点。作者原话：`The closest of them, GLiNER2, is 18 points behind Jev. On 78 cases that gap is far too wide to be noise.`
- **Jev 延迟 ~302 ms/case，是 Laya（30ms）的约 10 倍慢**。作者结论句：`The speed claim survives and the accuracy claim does not`（**针对复刻品的宣称**）。
- **作者自陈的边界（必须一起引）**：`78 cases is a small suite, and each task holds only 8 to 15 of them, so one or two answers swing a task's score.` 且 `Every model here answers questions phrased by the suite's author`。
- **官方「无类型错误」宣称在此得到实战佐证**：该文用 Jev 走了 **OpenRouter**，原话 `The benchmark reaches it through OpenRouter's decisions endpoint (openrouter.ai/api/alpha/decisions), which takes the same typed-question JSON, so no prompt round-tripping is involved.`（⚠️ **我本次直接 `curl` 该 decisions 端点得 `404 Not Found`**——可能需鉴权或路径已变，**此条我只记为「第三方自述」，未核成**）
- 该文还顺手抓到两个模型卡的**名实不符**（不在我范围，仅登记）：`wfzyx/von-1.0` 卡称 8192 上下文，`config.json` 写 `max_position_embeddings: 2048`；卡称温度 `1.0367`，`calibration.json` 写 `1.1692`。

**⇒ 这份证据的定性：『第三方博主转述的、由套件原作者执行的、对托管 API 的实测』。比厂商自测强，比完全独立复跑弱。⚠️ 起点文件 §6 表的第 23 条（Laya）与 §5 红灯站点 Von/Foq 的实测排名，都可以用这张表回填。**

### 5.2 次证据：Gadget Pilipinas（二手报道，但它指向 5.1）

`https://www.gadgetpilipinas.net/2026/09/typesafe-jev-system-one-model-laya/`（curl 落地 125,105 字节 → 8,280 字节正文）

原话：`An independent tester ran 78 cases from the classifier-benchmark suite on an M4 Pro Mac mini. Jev, run by the suite's author against the hosted API, scored 0.974.`／`A 27B model compressed to about one bit per weight scored 0.885, GLiNER2 0.795, Von 0.769, and Laya last at 0.590 while still being fastest at 30ms per case against roughly 302ms for Jev.` ／ `The speed claim survives and the accuracy claim does not, though 78 cases is a small sample.`

它同时是我本次找到的**关于「Laya 的作者主张」的唯一有出处记录**（与 Q3 相关的旁证，登记备查）：
- `Nandakishor Mukkunnoth, founder of ConvAI Innovations, says the concept is his. He cites a March 2025 paper on reinforcement learning for sales conversion prediction, plus open weights, an open dataset, a PyPI package and a Reddit post on r/LocalLLaMA`
- 他指控 TypeSafe：`proposed the exact same non-autoregressive decision concept as if it was a brand-new scientific breakthrough`，`launching without technical papers, without open weights, and with zero open training datasets`
- 他自报的数：`32.8ms per question on one T4 GPU and 7.2ms batched, against third-party Jev latency of 236ms to 276ms`；分数 `0.766 on the shared typed-decisions set against Jev's published 0.727`，且**明确声明** `Those Jev figures come from other benchmark runs, because his project never ran Jev itself`。
- ⚠️ **这是有利益冲突的当事人陈述（他是竞品作者），标「争议方主张」**。

### 5.3 我明确判定为「不是独立实测」的

| 来源 | 为什么不算 |
|---|---|
| `typesafe.ai` 首页／官方博客／官方 cookbook 的所有数字 | 厂商自测，官方博客自己承认笔记本＋美西＋自套 wrapper＋OpenRouter 取数 |
| OpenChamber 的 7×/30×/76ms | 它自己声明 `not an independent benchmark. We did not rerun the experiments.` ⇒ 自述汇总 |
| TechCrunch 里的 Vercel／Bryo AI 数字 | 受访者自述轶事，无套件、无样本量、无方法 |
| `jevbest.com` / `jevusers.com` / `jev-agent.com` / `jevapi.org` / `apimaster.ai` / `openchamber.dev` / `foq.fr` / `jevtypesafe.org` 等 §5 红灯站 | 未做整体否决（那是证据审计员的活），但**我本次没有把它们任何一个当作事实源**；只在追源时用于「多路同向」佐证，且逐条标了等级 |

---

## 6. 起点文件 §4 逐条核对结果

| §4 条目 | 我的核对结论 |
|---|---|
| 来源 MarkTechPost 2026-09-19，署名 Asif Razzaq | ✅ 一致 |
| 发布方 TypeSafe AI，产品 Jev，自称 System One Model，名字借 Kahneman | ✅ **升为★已核**（官方博客 FAQ 原文有名字来源，并额外确认 Jev 取自 **Jevons**） |
| 「transformer-based, but it is not a large language model. It does not generate text.」 | ✅ 前半句是 MarkTechPost 的表述；「不生成文本」是官方的（`System One models do not write replies, produce code, or generate explanations`）。⚠️ **「transformer-based」官方从未确认架构**（TechCrunch：`tight-lipped about the model's architecture`）——**这是 MarkTechPost 的说法，不是官方披露** |
| 单端点 `POST https://api.typesafe.ai/v1/systemone`，请求含 state/model/questions | ✅ **我亲测端点活着**（403/405/404 三态分明），且**逐字段核过真实 OpenAPI** |
| 三种原语 Choice/Score/Noul 及返回字段；Choice ≤255 | ✅ 全部**升为★已核**；额外取到 **Score 2–10 档上限**、`legend` 字段、**Noul 无 confidence** |
| 并行与隔离；「加问题几乎不增加响应时间」 | ✅ 官方原话确认；并取到官方 cookbook 的 `12.2x cheaper, 10.0x faster` 原始输出 |
| confidence 由概率分布形状导出；billing 0.84 vs confidence 截断 | ✅ **升为★已核**，并**找到了 playground 源码里的近似公式** `(count × peak − 1) / (count − 1)` |
| SDK `pip install typesafe-sdk`（≥3.10）、`@typesafe-ai/sdk`、cURL、Claude Code skill | ✅ **升为★已核**（PyPI 0.7.0 / npm 0.6.0 实包元数据） |
| 托管 API、early access 候补名单；Vercel AI Gateway 免候补 | ✅ early access **升为★已核**（官方博客原话）。⚠️ **Vercel AI Gateway 那句本次未取到**（`vercel.com/ai-gateway/models/jev` WebFetch 返回空）；我另取到 **OpenRouter 确有两款 Typesafe 模型在架**（★已核） |
| **「本文明确说：TypeSafe 未发布权重、未公布参数量、无自托管选项。」** | ✅ **交叉验证通过**（§3 六路）。**这句 MarkTechPost 说的是对的** |
| ○ 创始人 Diogo Almeida（前 OpenAI，参与 ChatGPT 指令跟随研究） | ✅ **升为★已核**（官方博客署名 `Diogo Almeida, founder, TypeSafe`；本人原话 `At OpenAI, I helped build the methods that made language models useful at following instructions … That work ended up as the research behind ChatGPT.`）。TechCrunch 另提 co-founders `Erik Gafni, Sasha Sheng` |
| ○ 发布日 2026-09-15 | ✅ **升为★已核**（官方博客页头 `Sep 15, 2026`；DCVC 文稿 `15 Sep 2026`）。另：**SDK 早在 09-09 就在 PyPI 上**；OpenRouter 09-18 上架 |
| ○ 定价 $0.042／决策（kie.ai 标题） | ❌ **判为错误口径**。正确＝**$0.042 / 1M input tokens**（§4.1）。→ 每次决策约 **$0.0000124** |
| ○ 延迟 70–500ms | ✅ 数字对，但**出处是 TypeSafe 官方博客**，非第三方（§4.2） |
| ○ 193.6× 更快 / 444.6× 更便宜 | ✅ 数字对，出处＝官方首页；**官方自认是上界**；第三方汇总自述中位数只有 **7× / 30×**（§4.3） |
| ○ 训练含 RLCD 与 parallel sampling；官方论点＝RLHF overconfidence / mode dropping | ✅ **升为★已核**（官方博客 `a new model architecture, parallel sampler for maximum efficiency, and training method we call Reinforcement Learning for Calibrated Decisions (RLCD)`；首页 `RLHF creates inherent issues such as mode dropping, overconfidence, and lack of reliability`） |
| ○ 相关红灯站点清单 | 未整体判定（属证据审计员）；我本次**逐个 URL 都在正文里标了等级**，且 `kie.ai` 原文**本次仍未取到**（服务区域通知） |

---

## 7. 对 Q4 方案最相关的五条硬边界（给合议主编）

1. **不能自托管、不能本地跑、不能审计权重**（§3，六路交叉验证）。任何「引入 Jev」的方案＝**引入一个第三方 SaaS 决策依赖**：出网、传 state、按 token 计费、限流动态、模型版本会漂（`jev-latest` 别名会移动，官方建议**要锁版本就 pin `jev-1.13.0`**，原话 `If you have tuned confidence thresholds against a specific version, pin that version's ID instead of the alias`）。
2. **它原生输出概率**（`noul`/`probabilities`），这与本项目铁律 ④（「LLM 仅四角色不出概率」）的关系**必须由合规侦察员定性**——但事实层面已明确：**这是模型自身的输出，不是 LLM 被要求编一个概率**；且 `confidence` 是 `probabilities` 的确定性函数，**不构成第二路独立证据**（§2.3）。
3. **中文是官方承认的弱项**（`including CJK scripts, are handled but not equally well`），本项目是中文项目，**必须先自测再谈**。
4. **纯文本、无图像音频视频；64k/32k 上下文；Choice≤255、Score 2–10 档**（§2.3/2.4）。
5. **官方自曝的 9 类失败模式**（`model-jaggedness/jev-1.13.md`，2026-09-17 复核）＝不识字面外含义／不算数／不计数／日期比较不可靠／长 state 掉分／对抗内容／criteria 自相矛盾／常识不变量／不会生成。**这是官方自己给的「不该用它做什么」清单，价值极高，建议原文照录进方案的风险节。**

---

## 8. 本次一手证据的落盘位置（可复核）

全部中间件在 `.scratch/jev-integration/_q2tmp/`（scratch，非生产）：

| 文件 | 是什么 |
|---|---|
| `md/*.md`（24 个） | docs.typesafe.ai 官方文档原文（`llms.txt` 索引下的 `.md` 版） |
| `llms.txt` | 官方文档索引（16,369 字节） |
| `oapi.json`（14,158 字节） | `https://api.typesafe.ai/openapi.json` 真实 OpenAPI |
| `blog.txt`（13,853 字节） | TypeSafe 官方发布博客正文抽取 |
| `indep.txt`（7,465 字节） | ap[e]Chat Blog 独立实测全文 |
| `gadget.txt`（8,280 字节） | Gadget Pilipinas 报道正文 |
| `von_card.md`（19,589 字节） | 竞品 Von 模型卡原文（含对 Jev 的「Proprietary MoE」说法） |
| `x_fdf91864.txt` / `x_8b219a53.txt` | OpenChamber 宣称 vs 自述汇总 / TrueFoundry 分析 |
| `extract.cjs` | 我写的 HTML→文本抽取器（区分三类来源时靠它读原文） |
| `pypi.json` / `npm.json` | 两个 SDK 的真实包元数据 |

**未做（如实登记）**：任何一次真实 Jev 推理调用（无 key，未注册账号）；`docs.typesafe.ai` 之外的官方页面（`console.typesafe.ai` 需登录）；GitHub 直查（匿名配额耗尽）；`kie.ai` 博客原文（区域拦截）；Vercel AI Gateway 页面（WebFetch 空返回）。

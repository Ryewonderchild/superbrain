# 超级大脑架构

## 系统分层

超级大脑由三条边界清晰的链组成：

```text
Obsidian 笔记层 -> Neo4j 知识关系层 -> LLM 检索生成层
```

- 笔记层负责 Markdown 原文、`[[双链]]`、标签、标题层级、反向链接和增量分块。
- Neo4j 负责知识空间、笔记、实体、事实、公理、证据和图路径。
- LLM 层只负责摘要、实体/语义关系抽取、重排、复杂问答和多文档综合。
- PostgreSQL 负责 Token 账户、预占、结算和不可变消费流水。
- Redis 负责短期预占标记、任务协调、限流与缓存，不是额度真相源。

## 核心数据模型

```text
(User)-[:OWNS]->(Workspace)
(Workspace)-[:CONTAINS]->(Note:SourceDocument)
(Note)-[:HAS_CHUNK]->(Chunk:TextChunk)
(Note)-[:LINKS_TO]->(Note)
(Note)-[:MENTIONS]->(Entity:KnowledgeItem)
(Note)-[:BELONGS_TO]->(Topic)
(Entity)-[:RELATED_TO]->(Entity)

(Chunk)<-[:FROM_CHUNK]-(Fact)-[:ABOUT]->(Entity)
(Fact)-[:PUBLISHED_AS]->(PublicFact)
(Hypothesis)-[:BASED_ON]->(PublicFact)
(Hypothesis)-[:CHALLENGED_BY]->(PublicFact)
(Hypothesis)-[:PROMOTED_TO]->(Axiom)
(Axiom)-[:SUPPORTED_BY]->(PublicFact)
```

双标签用于兼容旧版 SourceDocument/TextChunk 检索和事实证据链。新代码应优先使用 Note/Chunk 语义。

### 关系来源

| 关系 | 生成方 | 默认可信度 | 必要元数据 |
| --- | --- | ---: | --- |
| `LINKS_TO` | 用户 Markdown `[[双链]]` | 1.0 | `source=user` |
| `MENTIONS` | LLM 抽取 | 0.75 | `model`、`evidenceChunkId` |
| `RELATED_TO` | LLM 或算法 | 0.65 或更低 | `source`、`confidence`、`model`、`evidenceChunkId` |

Public 推理严格分层：

```text
PublicFact（可核验事实）
  -> Hypothesis（解释、归因、待验证结论）
  -> Axiom（经过公共治理的稳定命题）
```

Hypothesis 必须保存前提事实、结构化解释、替代解释、可证伪条件、置信度和状态。系统不保存或展示模型隐藏思维链。

人工关系和 AI 关系不得通过缺失字段来猜测来源。旧 KnowledgeItem 手工关系暂时保留 `RELATED_TO` 类型，但明确写入 `source=user, confidence=1.0`。

## 笔记编译

保存 Markdown 时先规范换行并计算 SHA-256 `contentHash`：

1. Hash 未变化：不重新分块、不重新 Embedding、不重新抽取。
2. 只改标题或摘要：只更新元数据，保留 Chunk 和 Embedding。
3. 正文变化：重新解析标题、标签和双链，再重建 Chunk。
4. 无法解析的 `[[目标]]` 写入 `unresolvedLinks`，目标创建后可再次编译解析。

Chunk 默认目标 450 Token，范围 300–600 Token，重叠 75 Token；保存字符位置、Token 数、当前标题和完整标题路径。

## Knowledge Compiler Agent

LLM 抽取结果不能直接写入 Neo4j。所有文字、文件和图片摄取必须经过 [Knowledge Compiler Agent](./KNOWLEDGE_COMPILER_AGENT.md) 状态机：实体归一化、属性归属、关系建模、命题分层和证据定位。未通过的草稿返回 `review_required` 和稳定错误码；通过后也只写入 Private，Public 必须由用户显式发布。

文件、文字和图片摄取最终也写成 `Note:SourceDocument`。相同 Workspace 内相同内容 Hash 不重复抽取和入图。

摄取任务状态：

```text
queued
 -> processing
 -> completed
 -> review_required
 -> failed
```

`review_required` 表示模型调用成功，但知识结构未通过规则，不属于系统故障。任务保存 `draftJson`、`workflowJson` 和规范化来源文本，前端展示实体、事实、关系和逐条中文问题。用户可以：

- 重新抽取：再次调用模型并产生新的 Token 用量。
- 剔除问题项并写入：只运行确定性规则，删除问题节点、问题属性及其悬空关系，不调用模型、不消耗模型 Token。

实体标题必须是可复用名词对象。包含“高于、低于、应该、需要、能够、属于、包含、导致”等完整判断的短语属于 Fact；编译器使用 `PROPOSITION_AS_ENTITY` 明确标记，不能只报告后续证据错误。单个草稿问题不得再把整个任务标记为 `failed`。

## 检索与生成

互联网检索是平台公共能力，不属于某个模型 Provider。API 通过内部 SearXNG
搜索服务统一获取网页结果，完成 URL 安全过滤、去重、摘要裁剪和 `[Wn]`
证据编号后，再将相同的网页上下文交给用户选择的 DeepSeek、Kimi、
Anthropic、Google 或 OpenAI 兼容模型。模型只负责基于证据生成答案，
不会自行决定搜索实现。

网页结果只作为当前问答证据。用户主动执行“构建基础知识”后，内容才进入
该用户的 private 摄取和知识编译流程；通过规则校验与人工审核后，才能分享
为 public 事实或公理。互联网搜索不能直接写入 public 图谱。

```text
问题
 -> 当前笔记和意图
 -> 最多 20 个 Note 摘要候选
 -> 选 5 篇 Note
 -> 全文 + 向量 Chunk 召回
 -> 1 至 2 跳图扩展（每层最多 10 个）
 -> RRF / 可选 LLM Rerank
 -> 最多 12 个完整 Chunk
 -> Token 预算筛选
 -> 带 [S1] / [G1] / [W1] 引用生成
```

主交互以持久化 `Conversation` 和 `Message` 为入口。每轮问答保存用户消息、助手回答和引用来源；后续问题最多从最近 24 条消息中按 Prompt 的 15% 预算选择完整消息。文件摄取、资料库、手动实体和关系工具位于同一知识交互工作台，图、Fact 和 Axiom 页面只展示编译后的结果。

主输入框使用确定性的 Agent 路由。带文件或图片、超过长度阈值的粘贴资料、
以及明确包含“摄取、抽取、加入知识库”等动作的请求进入摄取工作流；普通
问题进入 GraphRAG 问答。用户可以把路由固定为“仅问答”或“摄取知识”，
避免自动判断覆盖明确意图。

界面只显示系统实际执行的工具动作，例如读取文件、查询知识库、搜索网页、
调用模型、规则校验和写入 Private。操作记录随 Message 或 IngestJob
持久化，不展示模型隐藏推理过程，也不会声称执行了未发生的文件编辑。

模型 Profile 保存 `contextWindow`、`promptBudgetTokens` 和 `maxOutputTokens`。模型声明的上下文窗口只代表能力上限，业务请求还要经过更小的成本预算：

```text
promptLimit = min(promptBudgetTokens, contextWindow - maxOutputTokens - safetyTokens)
```

超预算时删除完整的低相关 Chunk，不从字符串末尾截断。图候选和来源均设硬上限，避免高连接节点扩散。

### DeepSeek V4 Pro

DeepSeek 预设使用 `deepseek-v4-pro`，记录 1M 上下文能力，但默认只给单次请求 32K Prompt 硬预算和 4K 输出预算。知识问答可启用 `high` 思考；结构化抽取与 Rerank 固定关闭思考，避免为机械任务消耗推理 Token。

请求使用内部用户 ID 生成 DeepSeek `user_id`，隔离不同用户的 KV Cache 和调度状态。提示词按“稳定系统约束 -> 稳定召回证据 -> 意图与问题”排列，提升重复资料问答时的精确前缀缓存命中率。

### GPT-5.6 Sol

官方 OpenAI 配置使用 `gpt-5.6-sol` 和 Responses API。自动适配默认记录 1.05M 上下文能力、128K Prompt 硬预算、16K 最大输出和 8K 安全余量；问答支持 `none` 至 `max` 推理等级、`standard` / `pro` 模式和回答详细度。结构化知识抽取固定使用低推理、低详细度和严格 JSON Schema。

输入超过 272K Token 时进入长上下文加价区间，因此自动配置不会主动跨过该阈值。每个用户独立保存并加密自己的 API Key，请求使用内部用户 ID 生成 `safety_identifier`。

## Token 账户

PostgreSQL 表：

- `token_accounts`：月额度、已结算、已预占、重置时间。
- `token_reservations`：请求级预占，状态为 reserved/settled/released。
- `token_usage_events`：实际输入、输出、缓存命中、缓存未命中、推理 Token 和成本；数据库触发器禁止更新或删除。

调用流程：

```text
估算输入 + 最大输出
 -> 事务锁定账户
 -> 检查余额并预占
 -> 调用 Provider
 -> 读取实际 usage
 -> 事务结算
 -> 返还未使用预占
```

OpenAI-compatible、Anthropic 和 Google usage 字段统一为 `inputTokens`、`outputTokens`、`cachedTokens`、`cacheMissTokens`、`reasoningTokens`。DeepSeek V4 Pro 根据缓存命中输入、缓存未命中输入和输出分别计算实际美元成本。Provider 不返回 usage 时使用本地保守估算。失败请求释放预占；过期预占由后台任务回收。

## 权限与公开知识

- 私有 Workspace、Note、Chunk、Entity、Fact 通过 `ownerId` 隔离。
- Public 图以 `PublicEntity` 和实体之间的有向语义关系为骨架；`PublicFact` 通过 `ABOUT` 指向实体，并为关系提供来源和证据。
- Hypothesis 是可证伪的待验证命题，Axiom 是可被认可、反对和观察的公共规范命题；二者不能代替实体节点。
- Public API 只读取 PublicEntity、PublicFact、Hypothesis、Axiom、Observation 和它们之间的公共关系，不遍历回私有原文。
- Axiom 必须由 Fact 支持，可投票、观察、修订和替代。
- 认证密码使用 PBKDF2 和独立 salt；用户 Provider Key 使用 AES-256-GCM 加密。

## 运行组件

- Caddy：HTTPS 和反向代理，只暴露 80/443。
- Web：React、Vite、Three.js 3D 图、事实和公理 Wiki。
- API：Express，认证、笔记编译、图谱、RAG、账本。
- Neo4j：知识关系与检索索引。
- PostgreSQL：额度和审计流水。
- Redis：短期协调和缓存。

Neo4j、PostgreSQL、Redis 与 API 均不暴露公网端口。

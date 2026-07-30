# 超级大脑 GraphRAG 优化方案

## 结论

超级大脑的目标不是单独的图数据库，也不是传统的向量知识库，而是一个会持续积累、可追溯、可讨论的 GraphRAG 系统：

- 图谱保存实体、关系、命题、公理及其演化。
- RAG 保存原始资料、文本块和向量，用于找回证据。
- LLM 负责抽取、合并、发现矛盾、生成回答和建议回写。
- 用户负责资料授权、公理发布和争议判断。

现阶段保留 Neo4j。问题不在数据库选型，而在当前系统还没有建立文档层、向量层、检索层和公理工作流。仓促迁移到其他图数据库只会增加数据迁移成本，不能补齐这些能力。

## 参考项目中应吸收的部分

### CC Switch

借鉴 Provider Profile，而不是把每种模型写死在业务代码里：

- Provider 模板：名称、协议、默认 Base URL、能力。
- 用户凭证：用户自己的 API Key，单独加密保存。
- 模型配置：模型 ID、上下文长度、用途和参数。
- 自动发现：对 OpenAI-compatible Provider 调用 `/v1/models`。
- 任务路由：抽取、问答、Embedding、Rerank 可以使用不同模型。

第一版协议适配器：

- `openai-compatible`：OpenAI、DeepSeek、Kimi、OpenRouter 等。
- `anthropic`
- `google`
- `ollama`

`dsv4`、`kimi-k3` 通常应当是模型配置。只有 Provider 明确提供的协议能力（例如 DSV4 Pro 的思考开关、用户级 KV Cache 隔离和缓存计费字段）才进入小型能力策略层，业务抽取和检索流程不复制分支。

### LLM Wiki

借鉴“持续编译的知识库”：

- 原始资料不可变，是最终证据来源。
- Wiki/知识页是 LLM 持续维护的综合结果。
- 新资料进入后更新已有概念，而不是每次问答重新拼接全部知识。
- 矛盾、过时内容、孤立节点和缺失引用需要周期性检查。
- 有价值的问答可以由用户确认后回写为新知识。

### LightRAG / GraphRAG

借鉴实体关系抽取和混合检索，但不直接使用它们的 Web UI：

- 文档分块及 Embedding。
- 实体、关系、关键词抽取。
- local、global、hybrid/mix 检索。
- 向量候选与图邻域扩展。
- Rerank 后生成带证据引用的回答。

建议增加独立的 Python `rag` 服务，以 LightRAG 为起点进行封装。现有 Node API 继续负责用户、权限、公共图谱和业务工作流。

## 目标数据分层

### 1. 原始资料层

`SourceDocument`

- `id`
- `ownerId`
- `spaceId`
- `title`
- `mimeType`
- `contentHash`
- `storagePath`
- `sourceUrl`
- `status`
- `createdAt`

`TextChunk`

- `id`
- `documentId`
- `ownerId`
- `spaceId`
- `text`
- `position`
- `embedding`
- `embeddingModel`

原始资料只追加新版本，不由 LLM 覆盖。

### 2. 推导知识层

`Entity`、`Concept`、`Claim` 和它们的关系由抽取流程生成。每项推导知识必须关联：

- 来源文档和文本块。
- 原文证据片段。
- 抽取模型及 Provider。
- 提取时间和置信度。
- 当前版本和被替代关系。

这层允许重新索引和重新生成，不作为公共公理的唯一事实来源。

### 3. 公理协作层

`Axiom` 是用户主动发布的可讨论命题，不等同于自动抽取的 `Claim`。

- private 中的 Claim/Entity 可以组合成 Axiom 草稿。
- 发布到 public 后保留贡献者和 private 来源的脱敏快照。
- 支持认可、不认可、观察、证据、反例和替代命题。
- 状态由明确规则或管理员裁决变化，不能仅由赞成票直接覆盖。

建议状态：

- `draft`
- `pending`
- `observed`
- `accepted`
- `disputed`
- `rejected`
- `deprecated`
- `superseded`

### 4. 展示层

3D 图谱是查询和探索界面，不是数据库本身。

- 使用 `react-force-graph-3d` + Three.js/WebGL。
- private、public、查询结果使用不同图层或过滤器。
- 节点颜色表达类型，外圈/光晕表达公理状态。
- 点击节点显示来源、证据和演化时间线。
- 默认只加载相关子图，避免把全部节点一次性送到浏览器。

## 检索流程

1. 判断用户查询意图和可访问空间。
2. 使用全文与向量检索召回相关 TextChunk。
3. 从命中的 Chunk 定位 Entity、Claim、Axiom。
4. 在 Neo4j 中按关系类型和深度扩展相关子图。
5. 合并向量、全文、图路径和公理状态分数。
6. Rerank 候选证据。
7. LLM 基于证据生成回答，并返回逐条引用。
8. 用户可将回答保存为 private 综合页，或整理为 public Axiom 草稿。

任何回答都应区分：

- 原文直接支持的内容。
- 图关系推导的内容。
- 模型作出的推测。
- public 中仍有争议的公理。

## 存储选择

### 第一阶段

- Neo4j：业务图、推导图、全文索引、向量索引。
- 本地持久卷：原始文件。
- 现有 Node API：认证和业务 API。
- 新增 Python RAG 服务：摄取、索引、检索、Rerank。

对当前几人使用的规模，这个组合部署简单，数据一致性最好。

### 扩容条件

只有满足以下任一条件时再增加 Qdrant、Milvus 或 PostgreSQL：

- 向量数量达到百万级且 Neo4j 检索成为实测瓶颈。
- 需要独立扩缩容向量检索。
- 文档任务队列、审计数据明显超过图业务负载。
- 压测证明拆分后的收益高于运维成本。

FalkorDB、Memgraph 和 PostgreSQL AGE 可以作为后续基准测试对象，但当前没有足够理由迁移。LightRAG 官方文档也指出 Neo4j 的生产性能优于 AGE。

## 多租户与权限

- 所有 Document、Chunk、Entity、Claim 和关系都必须带 `spaceId`。
- private space 的成员只有所有者。
- public space 对登录用户可读，发布和互动需要身份。
- RAG 检索必须在数据库查询阶段过滤空间，不能检索后再过滤。
- 分享到 public 时复制允许公开的证据快照，不能让 public Axiom 反向泄露 private 文档。
- Provider Key 只在服务端解密，日志、错误和前端响应不得包含明文。

## 实施顺序

### Phase 1：产品骨架

- 3D 图谱替换当前二维 SVG。（已完成第一版）
- Provider/Profile/Credential 数据模型和管理界面。（已完成第一版）
- SourceDocument、TextChunk、Evidence 数据模型。（已完成第一版）
- 文件上传、索引状态和失败重试。

### Phase 2：GraphRAG

- 引入独立 RAG 服务。
- 文档分块、Embedding、实体关系抽取。
- 全文 + 向量 + 图遍历混合检索。（全文 + 图遍历已完成，向量待完成）
- 带引用的图谱问答和结果子图。（已完成第一版）

### Phase 3：公共公理

- private Claim 组合和发布。（单节点发布已完成）
- public Axiom、投票、观察、反例、证据。（已完成第一版）
- 状态机、演化时间线和通知。（状态机已完成，时间线和通知待完成）
- private 证据脱敏与公开快照。（已完成第一版）

### Phase 4：知识维护

- LLM Wiki 风格的综合知识页。
- 增量更新、矛盾检测、重复实体合并。
- 孤立节点、过时知识和缺失来源检查。
- 高价值回答回写和人工审核。

## 验收标准

- 用户上传文档后无需手工建节点。
- 每个自动节点和关系都能跳回原文证据。
- 查询同时返回答案、引用和对应的 3D 子图。
- 同一问题可明确区分 private 资料和 public 公理。
- DeepSeek、Kimi、OpenAI-compatible Provider 可通过配置接入。
- 更换问答模型不要求重新索引；更换 Embedding 模型会创建新索引版本。
- private 内容不会通过图遍历、向量检索或公理分享意外泄露。

# 产品路线图

## 产品方向

超级大脑不是普通知识库。目标是一个多人协作的三维 GraphRAG 知识系统：

- 每个人维护自己的 private graph。
- 原始资料通过 RAG 自动生成带证据的实体、关系和命题。
- 用户可以把 private graph 中的知识分享到 public graph。
- public graph 中的知识以“公理/命题”形式存在。
- 公理可以被认可、不认可、质疑、观察和替代。
- AI 抽取负责把文本、文档、网页、对话转成候选节点和关系。

## 下一阶段核心改造

### 1. 三维图谱

把当前二维 SVG 图谱替换为 3D 主视图。

优先评估：

- `react-force-graph`
- `react-force-graph-3d`
- `three-forcegraph`
- Neo4j + 3D force graph 示例

目标能力：

- 3D 拖拽、旋转、缩放
- 节点聚类
- 节点搜索定位
- 关系高亮
- private/public 空间切换
- 状态颜色编码

### 2. Public / Private 双图谱

新增图谱空间：

- `private`：用户个人图谱
- `public`：公共公理图谱

private 到 public 的流程：

1. 用户从 private graph 选择节点/关系。
2. 整理成一个可讨论的命题或公理。
3. 分享到 public graph。
4. 其他用户认可、不认可、补证据、给反例。
5. 系统根据状态和观察记录展示公理演化。

### 3. 公理状态机

建议状态：

- `shared_pending`
- `observed`
- `accepted`
- `disputed`
- `rejected`
- `deprecated`
- `superseded`

每条公理需要保存：

- 命题
- 贡献者
- 来源 private 节点/关系
- 证据
- 当前状态
- 认可数
- 不认可数
- 观察记录
- 反例
- 替代公理

### 4. 多模型 Provider

当前只有 OpenAI Key。后续应改为多 Provider 凭证。

建议支持：

- OpenAI
- DeepSeek，例如 dsv4
- Kimi，例如 kimi-k3
- OpenRouter
- Anthropic
- Gemini
- 自定义 OpenAI-compatible endpoint

用户凭证模型：

- `provider`
- `label`
- `baseUrl`
- `model`
- `encryptedApiKey`
- `isDefault`

抽取时用户选择 Provider + model。

### 5. 证据溯源

抽取不应该只生成节点和关系，还要保存证据。

需要增加：

- 原文片段
- 来源文档
- 段落位置
- 抽取时间
- 使用模型
- 置信度

关系详情页必须能看到“为什么系统认为 A 和 B 有关系”。

## 优先级建议

1. 3D 图谱主视图（已完成第一版）
2. 多 Provider Profile 和用户凭证（已完成第一版）
3. 文档分块和证据溯源（文本抽取已完成，文件解析待完成）
4. 全文 + 图遍历的 GraphRAG 检索（已完成第一版，向量待完成）
5. 带引用的图谱问答（已完成第一版）
6. public/private 双图谱（已完成第一版）
7. 公理状态、投票、观察和反例（已完成第一版）
8. 图 / 公理 / 事实三工作区与独立设置页（已完成第一版）
9. Raw Source -> TextChunk -> Fact -> Axiom（已完成第一版）
10. GPT 式文字、文档和图片摄取入口（已完成第一版）
11. 持久化摄取队列、失败重试和原始附件存储（已完成第一版）
12. Embedding + 全文 + 图扩展的混合检索、独立模型 Rerank、历史向量重建（已完成第一版）
13. 公理版本、替代关系、通知和审计（已完成第一版）
14. LLM Wiki 风格的持续综合与知识维护
15. Workspace -> Note -> Chunk、Markdown 双链和内容 Hash 增量编译（已完成第一版）
16. PostgreSQL Token 预占、实际 usage 结算和不可变流水（已完成第一版）
17. 摘要级预筛、Chunk 级召回和请求硬预算（已完成第一版）
18. Redis 分布式限流、语义缓存和异步摘要刷新

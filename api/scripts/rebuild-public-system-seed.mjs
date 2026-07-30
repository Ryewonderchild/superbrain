import { closeDriver, read, write } from "../src/db.js";

const adminId = process.env.ADMIN_USER_ID || "admin";
const timestamp = new Date().toISOString();
const sourceTitle = "超级大脑代码库";

const entities = [
  {
    key: "superbrain",
    name: "超级大脑",
    entityType: "System",
    description: "一个将笔记、知识关系、证据检索和模型生成组合起来的多人知识管理系统。"
  },
  {
    key: "note-layer",
    name: "笔记层",
    entityType: "ArchitectureLayer",
    description: "保存用户可编辑原文、Markdown 双链、标题层级和内容哈希的知识输入层。"
  },
  {
    key: "knowledge-layer",
    name: "知识关系层",
    entityType: "ArchitectureLayer",
    description: "使用 Neo4j 保存实体、关系、事实及其可遍历结构的知识组织层。"
  },
  {
    key: "llm-layer",
    name: "检索生成层",
    entityType: "ArchitectureLayer",
    description: "负责混合检索、上下文预算、模型抽取和带来源回答的模型服务层。"
  },
  {
    key: "neo4j",
    name: "Neo4j",
    entityType: "Technology",
    description: "超级大脑当前用于保存节点、属性和有向关系的属性图数据库。"
  },
  {
    key: "rag-pipeline",
    name: "GraphRAG 问答流程",
    entityType: "Component",
    description: "从问题出发召回摘要、完整分块和有限图邻域，再生成带引用回答的流程。"
  },
  {
    key: "token-ledger",
    name: "Token 账本",
    entityType: "Component",
    description: "负责模型调用额度预占、实际用量结算、缓存用量和成本审计的事务组件。"
  },
  {
    key: "private-space",
    name: "Private 知识空间",
    entityType: "KnowledgeSpace",
    description: "按用户隔离的笔记、原始资料、实体、关系和候选事实空间。"
  },
  {
    key: "public-space",
    name: "Public 知识空间",
    entityType: "KnowledgeSpace",
    description: "只包含明确公开的实体、关系、事实、假设、公理和观察结果的共享空间。"
  },
  {
    key: "note",
    name: "Note",
    entityType: "DataObject",
    description: "具有标题、摘要、正文、内容哈希和 Token 统计的可编辑笔记对象。"
  },
  {
    key: "chunk",
    name: "Chunk",
    entityType: "DataObject",
    description: "从原始资料或笔记生成并保留标题路径、原文位置和 Token 数的完整文本分块。"
  },
  {
    key: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    entityType: "Model",
    description: "超级大脑模型配置中支持的 DeepSeek 推理模型，可按任务切换思考模式。"
  }
];

const facts = [
  {
    key: "fact-three-layers",
    title: "系统实现划分为三个知识层",
    statement: "超级大脑的实现将笔记、Neo4j 知识关系和 LLM 检索生成划分为三个职责不同的层。",
    evidence: "ARCHITECTURE.md 分别定义了笔记编译、GraphRAG 检索和模型调用边界。",
    source: "docs/ARCHITECTURE.md",
    confidence: 0.99,
    entityKeys: ["superbrain", "note-layer", "knowledge-layer", "llm-layer"]
  },
  {
    key: "fact-neo4j-runtime",
    title: "当前图数据库运行 Neo4j 5.23 Community",
    statement: "超级大脑生产编排使用 neo4j:5.23-community 镜像保存图数据。",
    evidence: "docker-compose.yml: image: neo4j:5.23-community",
    source: "docker-compose.yml",
    confidence: 1,
    entityKeys: ["superbrain", "knowledge-layer", "neo4j"]
  },
  {
    key: "fact-note-chunks",
    title: "Note 内容被编译为保留位置的 Chunk",
    statement: "Note 保存内容哈希，分块保存标题路径、字符位置和 Token 数。",
    evidence: "notes.js 在保存笔记时编译 Markdown，并为每个 Chunk 写入 headingPath、start、end 和 tokenCount。",
    source: "api/src/notes.js",
    confidence: 0.99,
    entityKeys: ["note-layer", "note", "chunk"]
  },
  {
    key: "fact-rag-bound",
    title: "RAG 上下文具有硬性候选上限",
    statement: "问答检索最多选择 12 个完整来源分块，并在模型 Profile 的 Prompt 预算内筛选。",
    evidence: "server.js 调用 selectWithinTokenBudget(..., { maxItems: 12 })，并以 promptBudgetTokens 限制有效上下文。",
    source: "api/src/server.js",
    confidence: 1,
    entityKeys: ["rag-pipeline", "chunk", "llm-layer"]
  },
  {
    key: "fact-token-settlement",
    title: "模型调用执行 Token 预占和实际结算",
    statement: "模型调用前预占预计输入与最大输出额度，完成后根据 Provider usage 结算并返还差额。",
    evidence: "metered-model.js 依次调用 reserveTokens、执行 Provider、settleTokens；失败时调用 releaseTokens。",
    source: "api/src/metered-model.js",
    confidence: 1,
    entityKeys: ["token-ledger", "llm-layer"]
  },
  {
    key: "fact-public-boundary",
    title: "Public API 只返回公共语义节点",
    statement: "Public 图接口只收集 PublicEntity、PublicFact、Hypothesis、Axiom 和 Observation，不读取私有 Note 或 Chunk。",
    evidence: "GET /api/public/graph 的 Cypher 查询显式限定公共节点标签。",
    source: "api/src/server.js",
    confidence: 1,
    entityKeys: ["private-space", "public-space", "superbrain"]
  },
  {
    key: "fact-dsv4-profile",
    title: "系统提供 DeepSeek V4 Pro 优化配置",
    statement: "DeepSeek V4 Pro 预设记录 1M 模型窗口，同时默认限制 32K Prompt、4K 输出，并对抽取与重排关闭思考。",
    evidence: "main.jsx 定义 deepseek-v4-pro Profile；providers.js 根据任务设置 thinking 并上报缓存 usage。",
    source: "web/src/main.jsx; api/src/providers.js",
    confidence: 1,
    entityKeys: ["deepseek-v4-pro", "llm-layer", "token-ledger"]
  },
  {
    key: "fact-provenance-fields",
    title: "AI 抽取结果保存模型和证据定位",
    statement: "系统生成的事实和证据记录包含模型标识、来源文档、分块标识及原文位置。",
    evidence: "Fact、Evidence 和 TextChunk 数据结构保存 model、documentId、chunkId、start、end 与 quote。",
    source: "api/src/server.js; api/src/extract.js",
    confidence: 0.98,
    entityKeys: ["knowledge-layer", "chunk", "llm-layer"]
  }
];

const relationships = [
  ["superbrain", "HAS_LAYER", "note-layer", "超级大脑包含笔记层。", "fact-three-layers"],
  ["superbrain", "HAS_LAYER", "knowledge-layer", "超级大脑包含知识关系层。", "fact-three-layers"],
  ["superbrain", "HAS_LAYER", "llm-layer", "超级大脑包含检索生成层。", "fact-three-layers"],
  ["knowledge-layer", "USES_TECHNOLOGY", "neo4j", "知识关系层使用 Neo4j 保存属性图。", "fact-neo4j-runtime"],
  ["note-layer", "PRODUCES", "note", "笔记层创建和维护 Note。", "fact-note-chunks"],
  ["note", "HAS_PART", "chunk", "Note 被编译为完整 Chunk。", "fact-note-chunks"],
  ["llm-layer", "EXECUTES", "rag-pipeline", "检索生成层执行 GraphRAG 问答流程。", "fact-rag-bound"],
  ["rag-pipeline", "RETRIEVES", "chunk", "GraphRAG 流程按预算召回 Chunk。", "fact-rag-bound"],
  ["superbrain", "HAS_COMPONENT", "token-ledger", "超级大脑使用 Token 账本管理模型资源。", "fact-token-settlement"],
  ["token-ledger", "GOVERNS", "llm-layer", "Token 账本约束检索生成层的模型调用。", "fact-token-settlement"],
  ["superbrain", "HAS_SPACE", "private-space", "超级大脑提供用户隔离的 Private 空间。", "fact-public-boundary"],
  ["superbrain", "HAS_SPACE", "public-space", "超级大脑提供共享 Public 空间。", "fact-public-boundary"],
  ["private-space", "PUBLISHES_TO", "public-space", "只有明确发布的知识快照进入 Public。", "fact-public-boundary"],
  ["llm-layer", "SUPPORTS_MODEL", "deepseek-v4-pro", "检索生成层支持 DSV4 Pro Profile。", "fact-dsv4-profile"]
];

const hypotheses = [
  {
    key: "hypothesis-bounded-retrieval",
    title: "有界检索可能提高回答中的证据密度",
    claim: "在相同问题集上，摘要预筛、完整 Chunk 选择和两跳以内图扩展，可能比全图输入产生更高的有效引用比例。",
    rationale: "有限预算减少无关上下文，但效果仍需通过固定问题集评测。",
    alternativeExplanation: "小型知识库中，全量输入可能得到相同或更好的结果。",
    falsificationCriteria: "如果全量输入在引用正确率和单位成本上持续优于有界检索，则否决该假设。",
    confidence: 0.65,
    factKeys: ["fact-three-layers", "fact-rag-bound"]
  },
  {
    key: "hypothesis-token-reservation",
    title: "事务预占可能阻止并发额度透支",
    claim: "在并发模型请求中，事务预占预计最大 Token 可以阻止账户可用额度变为负数。",
    rationale: "每个请求在调用 Provider 前锁定额度，后续请求只能读取扣除预占后的余额。",
    alternativeExplanation: "串行队列也能阻止透支，但吞吐量不同。",
    falsificationCriteria: "若并发压力测试产生负余额或重复结算，则否决该假设。",
    confidence: 0.8,
    factKeys: ["fact-token-settlement"]
  }
];

const axioms = [
  {
    key: "axiom-evidence-required",
    title: "AI 知识必须可追溯",
    statement: "任何进入公共知识空间的 AI 生成事实或关系，都必须绑定可检查的来源与证据定位。",
    factKeys: ["fact-provenance-fields", "fact-public-boundary"]
  },
  {
    key: "axiom-explicit-publication",
    title: "私有知识不得隐式公开",
    statement: "Private 内容只有经过用户明确发布并生成公共快照后，才能进入 Public 知识空间。",
    factKeys: ["fact-public-boundary"]
  }
];

await write("MATCH (n) WHERE n.seedKey IS NOT NULL DETACH DELETE n");

for (const entity of entities) {
  await write(
    `
    CREATE (:PublicEntity {
      id: randomUUID(), seedKey: $key, canonicalKey: $key,
      name: $name, entityType: $entityType, description: $description,
      sourceTitle: $sourceTitle, authorId: $adminId,
      createdAt: $timestamp, updatedAt: $timestamp
    })
    `,
    { ...entity, sourceTitle, adminId, timestamp }
  );
}

for (const fact of facts) {
  await write(
    `
    CREATE (f:PublicFact {
      id: randomUUID(), seedKey: $key, title: $title,
      statement: $statement, evidence: $evidence, confidence: $confidence,
      status: "published", sourceTitle: $source, authorId: $adminId,
      authorName: "System", createdAt: $timestamp, updatedAt: $timestamp
    })
    WITH f
    MATCH (e:PublicEntity) WHERE e.seedKey IN $entityKeys
    CREATE (f)-[:ABOUT {createdAt: $timestamp}]->(e)
    `,
    { ...fact, adminId, timestamp }
  );
}

for (const [sourceKey, type, targetKey, description, evidenceFactKey] of relationships) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(type)) throw new Error(`Invalid relationship type: ${type}`);
  await write(
    `
    MATCH (source:PublicEntity {seedKey: $sourceKey})
    MATCH (target:PublicEntity {seedKey: $targetKey})
    MATCH (fact:PublicFact {seedKey: $evidenceFactKey})
    CREATE (source)-[:${type} {
      id: randomUUID(), description: $description,
      evidenceFactId: fact.id, confidence: fact.confidence,
      provenance: "system-seed", createdAt: $timestamp
    }]->(target)
    `,
    { sourceKey, targetKey, description, evidenceFactKey, timestamp }
  );
}

for (const hypothesis of hypotheses) {
  await write(
    `
    CREATE (h:Hypothesis {
      id: randomUUID(), seedKey: $key, title: $title, claim: $claim,
      rationale: $rationale, alternativeExplanation: $alternativeExplanation,
      falsificationCriteria: $falsificationCriteria, confidence: $confidence,
      status: "testing", authorId: $adminId, authorName: "System",
      createdAt: $timestamp, updatedAt: $timestamp
    })
    WITH h
    MATCH (f:PublicFact) WHERE f.seedKey IN $factKeys
    CREATE (h)-[:BASED_ON {createdAt: $timestamp}]->(f)
    `,
    { ...hypothesis, adminId, timestamp }
  );
}

for (const axiom of axioms) {
  await write(
    `
    CREATE (a:Axiom {
      id: randomUUID(), seedKey: $key, title: $title, statement: $statement,
      status: "pending", authorId: $adminId, authorName: "System",
      sourceTitle: $sourceTitle, sourceSummary: $statement,
      evidenceSnapshot: "", factCount: size($factKeys),
      supportCount: 0, opposeCount: 0, version: 1,
      previousAxiomId: "", supersededById: "",
      createdAt: $timestamp, updatedAt: $timestamp
    })
    WITH a
    MATCH (f:PublicFact) WHERE f.seedKey IN $factKeys
    CREATE (a)-[:SUPPORTED_BY {createdAt: $timestamp}]->(f)
    `,
    { ...axiom, sourceTitle, adminId, timestamp }
  );
}

const result = await read(
  `
  MATCH (e:PublicEntity) WHERE e.seedKey IS NOT NULL
  WITH count(e) AS entities
  MATCH (f:PublicFact) WHERE f.seedKey IS NOT NULL
  WITH entities, count(f) AS facts
  MATCH (h:Hypothesis) WHERE h.seedKey IS NOT NULL
  WITH entities, facts, count(h) AS hypotheses
  MATCH (a:Axiom) WHERE a.seedKey IS NOT NULL
  RETURN entities, facts, hypotheses, count(a) AS axioms
  `
);

console.log(JSON.stringify({
  entities: result[0].get("entities").toNumber(),
  facts: result[0].get("facts").toNumber(),
  hypotheses: result[0].get("hypotheses").toNumber(),
  axioms: result[0].get("axioms").toNumber(),
  entityRelationships: relationships.length
}));

await closeDriver();


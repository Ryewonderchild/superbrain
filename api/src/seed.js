import { closeDriver, write } from "./db.js";

const timestamp = new Date().toISOString();

const items = [
  {
    id: "server-silicon-valley",
    title: "硅谷服务器",
    kind: "Infrastructure",
    summary: "部署知识管理系统的公网服务器，适合作为 Neo4j、API 和 Web 管理台的生产环境。",
    tags: ["server", "deployment", "silicon-valley"],
    source: "user"
  },
  {
    id: "neo4j-graph-db",
    title: "Neo4j 图数据库",
    kind: "Technology",
    summary: "用于保存知识实体、关系、标签、来源和后续推理链路。",
    tags: ["graph-database", "neo4j"],
    source: "architecture"
  },
  {
    id: "knowledge-item",
    title: "知识节点",
    kind: "Model",
    summary: "系统中的基本实体，可以代表概念、人物、项目、文档、服务器、代码模块或决策。",
    tags: ["entity", "model"],
    source: "architecture"
  },
  {
    id: "relationship",
    title: "关联关系",
    kind: "Model",
    summary: "知识节点之间的可命名连接，例如 DEPENDS_ON、MENTIONS、CAUSES、IMPLEMENTS。",
    tags: ["edge", "relationship"],
    source: "architecture"
  },
  {
    id: "rag-extension",
    title: "RAG 扩展",
    kind: "Roadmap",
    summary: "后续把文档切片、向量检索和知识图谱结合，用于问答、溯源和自动补关系。",
    tags: ["rag", "llm", "roadmap"],
    source: "roadmap"
  }
];

const links = [
  ["server-silicon-valley", "neo4j-graph-db", "HOSTS", "服务器托管图数据库"],
  ["neo4j-graph-db", "knowledge-item", "STORES", "图数据库保存知识节点"],
  ["neo4j-graph-db", "relationship", "STORES", "图数据库保存关系"],
  ["rag-extension", "knowledge-item", "ENRICHES", "RAG 能从文档中抽取节点"],
  ["rag-extension", "relationship", "SUGGESTS", "RAG 能推荐候选关系"]
];

async function seed() {
  await write("CREATE CONSTRAINT knowledge_item_id IF NOT EXISTS FOR (n:KnowledgeItem) REQUIRE n.id IS UNIQUE");

  for (const item of items) {
    await write(
      `
      MERGE (n:KnowledgeItem {id: $id})
      SET n.title = $title,
          n.kind = $kind,
          n.summary = $summary,
          n.tags = $tags,
          n.source = $source,
          n.createdAt = coalesce(n.createdAt, $timestamp),
          n.updatedAt = $timestamp
      `,
      { ...item, timestamp }
    );
  }

  for (const [sourceId, targetId, type, note] of links) {
    await write(
      `
      MATCH (source:KnowledgeItem {id: $sourceId})
      MATCH (target:KnowledgeItem {id: $targetId})
      MERGE (source)-[r:RELATED_TO {type: $type}]->(target)
      SET r.id = coalesce(r.id, randomUUID()),
          r.note = $note,
          r.createdAt = coalesce(r.createdAt, $timestamp)
      `,
      { sourceId, targetId, type, note, timestamp }
    );
  }
}

seed()
  .then(async () => {
    console.log("Seed data written");
    await closeDriver();
  })
  .catch(async (error) => {
    console.error(error);
    await closeDriver();
    process.exit(1);
  });

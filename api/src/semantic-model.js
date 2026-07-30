import { read, write } from "./db.js";

const definitions = [
  {
    key: "Note",
    category: "node",
    layer: "knowledge",
    description: "用户可编辑的 Markdown 原始知识页面。",
    trustPolicy: "用户原文是最高优先级来源，正文变化由 contentHash 判断。"
  },
  {
    key: "Entity",
    category: "node",
    layer: "knowledge",
    description: "人物、组织、产品、技术、地点或概念等稳定对象。",
    trustPolicy: "先判定对象身份再建节点；同义名称归并为一个实体，描述保存在字段中，方法、过程与结果不得错误等同。LLM 抽取必须附带来源分块和置信度。"
  },
  {
    key: "Attribute",
    category: "property",
    layer: "knowledge",
    description: "归属于某个实体或关系的键值特征，本身没有独立身份。",
    trustPolicy: "键名不能覆盖系统字段，值必须附带可定位证据。"
  },
  {
    key: "Description",
    category: "property",
    layer: "knowledge",
    description: "面向人类阅读、用于解释实体或关系含义的自然语言文本。",
    trustPolicy: "描述不是实体；其中的可验证命题必须另行抽取为 Fact。"
  },
  {
    key: "Relationship",
    category: "relationship",
    layer: "knowledge",
    description: "连接两个已定义实体的有向语义边，包含类型和自然语言说明。",
    trustPolicy: "端点必须存在；LLM 关系必须保存证据、模型和置信度。"
  },
  {
    key: "Fact",
    category: "node",
    layer: "private",
    description: "私有资料中可由原文直接核验的原子命题。",
    trustPolicy: "只能表达一个命题，必须有逐字证据，不允许包含推测。"
  },
  {
    key: "PublicFact",
    category: "node",
    layer: "public",
    description: "用户明确发布到公共空间的事实快照。",
    trustPolicy: "只包含公开快照，不允许反向暴露私有 Note、Chunk 或附件。"
  },
  {
    key: "Hypothesis",
    category: "node",
    layer: "public",
    description: "基于一个或多个公共事实提出的解释、归因或待验证结论。",
    trustPolicy: "必须列出前提、置信度、验证状态和可能反例；不能伪装成事实。"
  },
  {
    key: "Axiom",
    category: "node",
    layer: "public",
    description: "经过公共观察、证据支持和版本治理的稳定命题。",
    trustPolicy: "必须由 PublicFact 支持；从 Hypothesis 提升时保留完整来源关系。"
  },
  {
    key: "LINKS_TO",
    category: "relationship",
    layer: "knowledge",
    description: "用户在 Markdown 中通过双链明确建立的笔记关系。",
    trustPolicy: "source=user，confidence=1.0。"
  },
  {
    key: "MENTIONS",
    category: "relationship",
    layer: "knowledge",
    description: "笔记正文中由模型识别出的实体提及。",
    trustPolicy: "必须保存 model、confidence 和 evidenceChunkId。"
  },
  {
    key: "RELATED_TO",
    category: "relationship",
    layer: "knowledge",
    description: "由模型或算法提出的语义关联。",
    trustPolicy: "可信度低于人工双链，必须明确来源。"
  }
];

export async function ensureSemanticModel() {
  const timestamp = new Date().toISOString();
  await write(
    `
    UNWIND $definitions AS definition
    MERGE (type:SemanticType {key: definition.key})
    ON CREATE SET type.id = randomUUID(), type.createdAt = $timestamp
    SET type.category = definition.category,
        type.layer = definition.layer,
        type.description = definition.description,
        type.trustPolicy = definition.trustPolicy,
        type.version = 1,
        type.updatedAt = $timestamp
    `,
    { definitions, timestamp }
  );
}

export async function listSemanticTypes() {
  const records = await read(
    `
    MATCH (type:SemanticType)
    RETURN type
    ORDER BY type.layer, type.category, type.key
    `
  );
  return records.map((record) => record.get("type").properties);
}

export async function semanticContextText() {
  const types = await listSemanticTypes();
  return types.map((type) => (
    `${type.key} [${type.category}/${type.layer}]: ${type.description} 约束：${type.trustPolicy}`
  )).join("\n");
}

export function classifyRetrievalIntent(question) {
  const text = String(question || "").toLowerCase();
  if (/(为什么|原因|归因|导致|可能|假设|推断|why|cause)/i.test(text)) return "hypothesis";
  if (/(关系|关联|路径|连接|影响|relationship|path)/i.test(text)) return "relationship";
  if (/(总结|综合|比较|趋势|概览|summary|compare)/i.test(text)) return "synthesis";
  return "fact_lookup";
}

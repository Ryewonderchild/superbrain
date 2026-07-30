import { z } from "zod";
import { itemSchema } from "./schema.js";
import { graphJsonSchema, parseJsonObject } from "./providers.js";

export const extractSchema = z.object({
  text: z.string().trim().min(20).max(60000),
  source: z.string().trim().max(300).optional().default("extract"),
  profileId: z.string().trim().max(80).optional().default(""),
  model: z.string().trim().min(1).max(80).optional().default("gpt-5")
});

const extractionNodeSchema = itemSchema.extend({
    evidence: z.string().trim().max(2000).optional().default(""),
    attributes: z.array(z.object({
      key: z.string().trim().min(1).max(64),
      value: z.string().trim().min(1).max(1000),
      evidence: z.string().trim().max(2000).optional().default("")
    })).max(12).optional().default([])
  });

const extractionFactSchema = z.object({
    statement: z.string().trim().min(3).max(3000),
    evidence: z.string().trim().min(1).max(2000),
    confidence: z.number().min(0).max(1).optional().default(0.7),
    entityTitles: z.array(z.string().trim().min(1).max(160)).max(12).optional().default([])
  });

const extractionLinkSchema = z.object({
    sourceTitle: z.string().trim().min(1).max(160),
    targetTitle: z.string().trim().min(1).max(160),
    type: z.string().trim().min(1).max(64),
    note: z.string().trim().max(1000).optional().default(""),
    evidence: z.string().trim().max(2000).optional().default("")
  });

export const extractionGraphSchema = z.object({
  nodes: z.array(extractionNodeSchema).max(40),
  facts: z.array(extractionFactSchema).max(80).optional().default([]),
  links: z.array(extractionLinkSchema).max(80)
});

function strings(value, limit) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim()).slice(0, limit)
    : [];
}

function optionalText(value) {
  return value == null ? "" : value;
}

function normalizeNode(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const attributes = Array.isArray(value.attributes) ? value.attributes : [];
  return {
    ...value,
    kind: value.kind == null ? "Concept" : value.kind,
    summary: optionalText(value.summary),
    content: optionalText(value.content),
    tags: strings(value.tags, 20),
    source: optionalText(value.source),
    evidence: optionalText(value.evidence),
    attributes: attributes.slice(0, 12).map((attribute) => (
      attribute && typeof attribute === "object" && !Array.isArray(attribute)
        ? { ...attribute, evidence: optionalText(attribute.evidence) }
        : attribute
    ))
  };
}

function normalizeFact(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const numericConfidence = Number(value.confidence);
  return {
    ...value,
    confidence: value.confidence == null || !Number.isFinite(numericConfidence)
      ? 0.7
      : numericConfidence,
    entityTitles: strings(value.entityTitles, 12)
  };
}

function normalizeLink(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return {
    ...value,
    note: optionalText(value.note),
    evidence: optionalText(value.evidence)
  };
}

const REIFIED_DESCRIPTION_SUFFIX = /^(.*?)(?:的)?(?:描述|定义|说明|简介|概述|含义)$/u;

function ontologyKey(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function mergeUniqueText(...values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].join("\n");
}

function foldReifiedDescriptions(graph) {
  const byTitle = new Map(graph.nodes.map((node) => [ontologyKey(node.title), node]));
  const aliases = new Map();

  for (const node of graph.nodes) {
    const baseTitle = node.title.match(REIFIED_DESCRIPTION_SUFFIX)?.[1]?.trim();
    const base = baseTitle ? byTitle.get(ontologyKey(baseTitle)) : null;
    if (!base || base === node) continue;

    aliases.set(ontologyKey(node.title), base.title);
    base.summary = mergeUniqueText(base.summary, node.summary, node.content).slice(0, 2000);
    base.content = mergeUniqueText(base.content, node.content).slice(0, 60000);
    base.tags = [...new Set([...(base.tags || []), ...(node.tags || [])])].slice(0, 20);
    base.evidence ||= node.evidence;
    const attributeKeys = new Set((base.attributes || []).map((attribute) => ontologyKey(attribute.key)));
    for (const attribute of node.attributes || []) {
      if (!attributeKeys.has(ontologyKey(attribute.key))) {
        base.attributes.push(attribute);
        attributeKeys.add(ontologyKey(attribute.key));
      }
    }
  }

  if (!aliases.size) return graph;
  const canonicalTitle = (title) => aliases.get(ontologyKey(title)) || title;
  return {
    nodes: graph.nodes.filter((node) => !aliases.has(ontologyKey(node.title))),
    facts: graph.facts.map((fact) => ({
      ...fact,
      entityTitles: [...new Set(fact.entityTitles.map(canonicalTitle))]
    })),
    links: graph.links
      .map((link) => ({
        ...link,
        sourceTitle: canonicalTitle(link.sourceTitle),
        targetTitle: canonicalTitle(link.targetTitle)
      }))
      .filter((link) => ontologyKey(link.sourceTitle) !== ontologyKey(link.targetTitle))
  };
}

function normalizeItems(rawItems, {
  key,
  maxItems,
  schema,
  normalize,
  code,
  label
}) {
  const issues = [];
  if (rawItems != null && !Array.isArray(rawItems)) {
    issues.push({
      code,
      path: `modelOutput.${key}`,
      message: `模型返回的${label}不是数组，已隔离该字段。`,
      severity: "error"
    });
  }
  const values = Array.isArray(rawItems) ? rawItems.slice(0, maxItems) : [];
  const items = [];
  values.forEach((value, index) => {
    const result = schema.safeParse(normalize(value));
    if (result.success) {
      items.push(result.data);
      return;
    }
    const reason = result.error.issues
      .slice(0, 2)
      .map((entry) => entry.path.join(".") || entry.message)
      .join("、");
    issues.push({
      code,
      path: `modelOutput.${key}[${index}]`,
      message: `模型返回的第 ${index + 1} 条${label}字段不完整，已隔离且不会写入${reason ? `（${reason}）` : ""}。`,
      severity: "error"
    });
  });
  if (Array.isArray(rawItems) && rawItems.length > maxItems) {
    issues.push({
      code: "MODEL_OUTPUT_LIMIT_APPLIED",
      path: `modelOutput.${key}`,
      message: `${label}超过协议上限，已保留前 ${maxItems} 条。`,
      severity: "error"
    });
  }
  return { items, issues };
}

export function normalizeExtractionGraph(rawGraph) {
  const input = rawGraph && typeof rawGraph === "object" && !Array.isArray(rawGraph) ? rawGraph : {};
  const nodes = normalizeItems(input.nodes, {
    key: "nodes",
    maxItems: 40,
    schema: extractionNodeSchema,
    normalize: normalizeNode,
    code: "MALFORMED_MODEL_ENTITY_DROPPED",
    label: "实体"
  });
  const facts = normalizeItems(input.facts, {
    key: "facts",
    maxItems: 80,
    schema: extractionFactSchema,
    normalize: normalizeFact,
    code: "MALFORMED_MODEL_FACT_DROPPED",
    label: "事实"
  });
  const links = normalizeItems(input.links, {
    key: "links",
    maxItems: 80,
    schema: extractionLinkSchema,
    normalize: normalizeLink,
    code: "MALFORMED_MODEL_RELATION_DROPPED",
    label: "关系"
  });
  const graph = extractionGraphSchema.parse({
      nodes: nodes.items,
      facts: facts.items,
      links: links.items
    });
  return {
    graph: foldReifiedDescriptions(graph),
    issues: [...nodes.issues, ...facts.issues, ...links.issues]
  };
}

export async function extractGraphFromText({ apiKey, text, source, model }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: "你是 Knowledge Compiler Agent。依次完成实体归一化、属性归属、关系建模、命题分层和证据定位。实体必须是人物、组织、产品、技术、地点、制度或主题等可复用名词对象。包含“高于、低于、应该、需要、能够、支持、包含、属于、导致、影响”等完整判断的短语必须进入 facts，不能作为实体标题。例如“风险防范高于追求回报”是 Fact，不是 Entity。描述、属性、关系、Fact、Hypothesis、Axiom 都不能作为实体。每个实体、属性、关系和 Fact 必须有原文逐字证据；推测不能写成 Fact。关系必须连接两个已定义实体，包含自然语言说明，type 使用英文大写蛇形命名。"
        },
        {
          role: "user",
          content: `来源：${source}\n\n请从以下内容抽取知识图谱节点、关系和原子事实：\n\n${text}`
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "knowledge_graph_extraction",
          strict: true,
          schema: graphJsonSchema
        }
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || "模型抽取失败");
  }

  const outputText = payload.output_text || payload.output?.flatMap((item) => item.content || [])
    .find((content) => content.type === "output_text")?.text;
  if (!outputText) throw new Error("模型没有返回可解析的抽取结果");
  return parseJsonObject(outputText);
}

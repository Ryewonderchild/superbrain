const PROPOSITION_KINDS = new Set([
  "fact",
  "publicfact",
  "hypothesis",
  "axiom",
  "observation",
  "description",
  "attribute",
  "relationship"
]);

const RESERVED_PROPERTIES = new Set([
  "id",
  "ownerId",
  "title",
  "kind",
  "summary",
  "content",
  "tags",
  "source",
  "createdAt",
  "updatedAt",
  "attributesJson"
]);
const ATTRIBUTE_KEY_PATTERN = /^[\p{L}_][\p{L}\p{N}_]{0,63}$/u;

function normalizedText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function evidenceExists(sourceText, evidence) {
  const source = normalizedText(sourceText);
  const segments = String(evidence || "")
    .replace(/\[(?:W|S)\d+\]/gi, "\n")
    .split(/\n+|(?:\.{3,}|…+)/u)
    .map(normalizedText)
    .filter((segment) => segment.length >= 6);
  return Boolean(source && segments.length && segments.every((segment) => source.includes(segment)));
}

function looksSpeculative(statement) {
  return /(?:可能|也许|或许|推测|猜测|大概|建议|应该|有望|may|might|could|probably|possibly|suggests?)/i
    .test(String(statement || ""));
}

function looksLikePropositionEntity(title) {
  return /(?:高于|低于|等于|优于|劣于|应当|应该|必须|需要|能够|可以|导致|属于|包含|提升了|降低了)/u
    .test(String(title || ""));
}

function looksLikeReifiedDescription(node, allTitles) {
  if (/^(?:Document|Note)$/i.test(String(node.kind || ""))) return false;
  const title = String(node.title || "");
  if (/的(?:描述|定义|说明|简介|概述|含义)$/u.test(title)) return true;
  const baseTitle = title.match(/^(.*?)(?:描述|定义|说明|简介|概述|含义)$/u)?.[1]?.trim();
  return Boolean(baseTitle && allTitles.has(normalizedText(baseTitle)));
}

function issue(code, path, message, severity = "error") {
  return { code, path, message, severity };
}

export function attributesToProperties(attributes = []) {
  return Object.fromEntries(attributes
    .filter((attribute) => (
      ATTRIBUTE_KEY_PATTERN.test(attribute.key)
      && !RESERVED_PROPERTIES.has(attribute.key)
    ))
    .map((attribute) => [attribute.key, attribute.value]));
}

export function compileKnowledgeDraft({
  graph,
  sourceText = "",
  allowVisualEvidence = false
}) {
  const issues = [];
  const titleIndex = new Map();
  const allTitles = new Set(graph.nodes.map((node) => normalizedText(node.title)));

  graph.nodes.forEach((node, index) => {
    const path = `nodes[${index}]`;
    const canonicalTitle = normalizedText(node.title);
    if (titleIndex.has(canonicalTitle)) {
      issues.push(issue("DUPLICATE_ENTITY", `${path}.title`, `实体“${node.title}”重复，应先归一化为一个实体。`));
    } else {
      titleIndex.set(canonicalTitle, node.title);
    }
    if (PROPOSITION_KINDS.has(String(node.kind || "").toLowerCase())) {
      issues.push(issue("INVALID_ENTITY_KIND", `${path}.kind`, `“${node.kind}”是命题或字段类型，不能作为实体类型。`));
    }
    if (looksLikePropositionEntity(node.title)) {
      issues.push(issue(
        "PROPOSITION_AS_ENTITY",
        `${path}.title`,
        `“${node.title}”表达了一个完整判断，应当作为 Fact，而不是 Entity。`
      ));
    }
    if (looksLikeReifiedDescription(node, allTitles)) {
      issues.push(issue(
        "REIFIED_DESCRIPTION_ENTITY",
        `${path}.title`,
        `“${node.title}”是实体的描述字段，不是独立实体；应合并到被描述对象。`
      ));
    }
    if (!String(node.summary || "").trim()) {
      issues.push(issue("MISSING_ENTITY_DESCRIPTION", `${path}.summary`, `实体“${node.title}”缺少明确描述。`));
    }
    if (!String(node.evidence || "").trim()) {
      issues.push(issue("MISSING_ENTITY_EVIDENCE", `${path}.evidence`, `实体“${node.title}”缺少来源证据。`));
    } else if (!allowVisualEvidence && !evidenceExists(sourceText, node.evidence)) {
      issues.push(issue("ENTITY_EVIDENCE_NOT_IN_SOURCE", `${path}.evidence`, `实体“${node.title}”的证据无法在原文中定位。`));
    }

    const attributeKeys = new Set();
    (node.attributes || []).forEach((attribute, attributeIndex) => {
      const attributePath = `${path}.attributes[${attributeIndex}]`;
      if (!ATTRIBUTE_KEY_PATTERN.test(attribute.key) || RESERVED_PROPERTIES.has(attribute.key)) {
        issues.push(issue("INVALID_ATTRIBUTE_KEY", `${attributePath}.key`, `属性键“${attribute.key}”无效或与系统字段冲突。`));
      }
      if (attributeKeys.has(attribute.key)) {
        issues.push(issue("DUPLICATE_ATTRIBUTE", `${attributePath}.key`, `实体“${node.title}”的属性“${attribute.key}”重复。`));
      }
      attributeKeys.add(attribute.key);
      if (!attribute.evidence) {
        issues.push(issue("MISSING_ATTRIBUTE_EVIDENCE", `${attributePath}.evidence`, `属性“${attribute.key}”缺少证据。`));
      } else if (!allowVisualEvidence && !evidenceExists(sourceText, attribute.evidence)) {
        issues.push(issue("ATTRIBUTE_EVIDENCE_NOT_IN_SOURCE", `${attributePath}.evidence`, `属性“${attribute.key}”的证据无法在原文中定位。`));
      }
    });
  });

  graph.links.forEach((link, index) => {
    const path = `links[${index}]`;
    if (!titleIndex.has(normalizedText(link.sourceTitle))) {
      issues.push(issue("UNKNOWN_RELATION_SOURCE", `${path}.sourceTitle`, `关系起点“${link.sourceTitle}”不是已定义实体。`));
    }
    if (!titleIndex.has(normalizedText(link.targetTitle))) {
      issues.push(issue("UNKNOWN_RELATION_TARGET", `${path}.targetTitle`, `关系终点“${link.targetTitle}”不是已定义实体。`));
    }
    if (normalizedText(link.sourceTitle) === normalizedText(link.targetTitle)) {
      issues.push(issue("SELF_RELATION", path, "关系起点和终点不能是同一个实体。"));
    }
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(link.type)) {
      issues.push(issue("INVALID_RELATION_TYPE", `${path}.type`, `关系类型“${link.type}”必须使用英文大写蛇形命名。`));
    }
    if (!String(link.note || "").trim()) {
      issues.push(issue("MISSING_RELATION_DESCRIPTION", `${path}.note`, `关系 ${link.sourceTitle} → ${link.targetTitle} 缺少语义描述。`));
    }
    if (!String(link.evidence || "").trim()) {
      issues.push(issue("MISSING_RELATION_EVIDENCE", `${path}.evidence`, `关系 ${link.sourceTitle} → ${link.targetTitle} 缺少证据。`));
    } else if (!allowVisualEvidence && !evidenceExists(sourceText, link.evidence)) {
      issues.push(issue("RELATION_EVIDENCE_NOT_IN_SOURCE", `${path}.evidence`, `关系 ${link.sourceTitle} → ${link.targetTitle} 的证据无法在原文中定位。`));
    }
  });

  graph.facts.forEach((fact, index) => {
    const path = `facts[${index}]`;
    if (looksSpeculative(fact.statement)) {
      issues.push(issue("FACT_LOOKS_LIKE_HYPOTHESIS", `${path}.statement`, "该命题包含推测或建议语气，应进入 Hypothesis，而不是 Fact。"));
    }
    if (!fact.entityTitles.length) {
      issues.push(issue("FACT_WITHOUT_ENTITY", `${path}.entityTitles`, "Fact 必须至少指向一个已定义实体。"));
    }
    fact.entityTitles.forEach((title, entityIndex) => {
      if (!titleIndex.has(normalizedText(title))) {
        issues.push(issue("UNKNOWN_FACT_ENTITY", `${path}.entityTitles[${entityIndex}]`, `Fact 指向的实体“${title}”不存在。`));
      }
    });
    if (!String(fact.evidence || "").trim()) {
      issues.push(issue("MISSING_FACT_EVIDENCE", `${path}.evidence`, "Fact 缺少逐字证据。"));
    } else if (!allowVisualEvidence && !evidenceExists(sourceText, fact.evidence)) {
      issues.push(issue("FACT_EVIDENCE_NOT_IN_SOURCE", `${path}.evidence`, "Fact 的证据无法在原文中定位。"));
    }
  });

  const errors = issues.filter((entry) => entry.severity === "error");
  const workflow = {
    agent: "Knowledge Compiler Agent",
    protocolVersion: 1,
    status: errors.length ? "review_required" : "ready",
    phases: [
      { id: "source", label: "来源标准化", status: "completed" },
      { id: "entities", label: "实体识别与归一化", status: issues.some((entry) => entry.path.startsWith("nodes")) ? "review_required" : "completed" },
      { id: "attributes", label: "属性归属", status: issues.some((entry) => entry.code.includes("ATTRIBUTE")) ? "review_required" : "completed" },
      { id: "relationships", label: "关系建模", status: issues.some((entry) => entry.path.startsWith("links")) ? "review_required" : "completed" },
      { id: "propositions", label: "Fact 与 Hypothesis 分层", status: issues.some((entry) => entry.path.startsWith("facts")) ? "review_required" : "completed" },
      { id: "evidence", label: "证据定位", status: issues.some((entry) => entry.code.includes("EVIDENCE")) ? "review_required" : "completed" },
      { id: "commit", label: "写入 Private", status: errors.length ? "blocked" : "ready" }
    ],
    issues,
    stats: {
      entities: graph.nodes.length,
      attributes: graph.nodes.reduce((total, node) => total + (node.attributes?.length || 0), 0),
      relationships: graph.links.length,
      facts: graph.facts.length,
      errors: errors.length
    }
  };

  return { graph, workflow };
}

export function discardInvalidKnowledgeParts({ graph, workflow }) {
  const invalidNodes = new Set();
  const invalidLinks = new Set();
  const invalidFacts = new Set();
  const invalidAttributes = new Map();

  for (const entry of workflow.issues || []) {
    const nodeMatch = entry.path.match(/^nodes\[(\d+)\](?:\.attributes\[(\d+)\])?/);
    if (nodeMatch) {
      const nodeIndex = Number(nodeMatch[1]);
      if (nodeMatch[2] == null) {
        invalidNodes.add(nodeIndex);
      } else {
        const indexes = invalidAttributes.get(nodeIndex) || new Set();
        indexes.add(Number(nodeMatch[2]));
        invalidAttributes.set(nodeIndex, indexes);
      }
      continue;
    }
    const linkMatch = entry.path.match(/^links\[(\d+)\]/);
    if (linkMatch) {
      invalidLinks.add(Number(linkMatch[1]));
      continue;
    }
    const factMatch = entry.path.match(/^facts\[(\d+)\]/);
    if (factMatch) invalidFacts.add(Number(factMatch[1]));
  }

  const nodes = graph.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ index }) => !invalidNodes.has(index))
    .map(({ node, index }) => ({
      ...node,
      attributes: (node.attributes || []).filter(
        (_, attributeIndex) => !invalidAttributes.get(index)?.has(attributeIndex)
      )
    }));
  const validTitles = new Set(nodes.map((node) => normalizedText(node.title)));
  const links = graph.links.filter((link, index) => (
    !invalidLinks.has(index)
    && validTitles.has(normalizedText(link.sourceTitle))
    && validTitles.has(normalizedText(link.targetTitle))
  ));
  const facts = graph.facts
    .filter((_, index) => !invalidFacts.has(index))
    .map((fact) => ({
      ...fact,
      entityTitles: fact.entityTitles.filter((title) => validTitles.has(normalizedText(title)))
    }))
    .filter((fact) => fact.entityTitles.length > 0);

  return {
    graph: { ...graph, nodes, links, facts },
    discarded: {
      nodes: graph.nodes.length - nodes.length,
      attributes: graph.nodes.reduce((total, node) => total + (node.attributes?.length || 0), 0)
        - nodes.reduce((total, node) => total + (node.attributes?.length || 0), 0),
      links: graph.links.length - links.length,
      facts: graph.facts.length - facts.length
    }
  };
}

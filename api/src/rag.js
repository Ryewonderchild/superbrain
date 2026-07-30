import { nodeToItem, read, relationshipToLink, toNativeNumber } from "./db.js";

function safeFullTextQuery(question) {
  return String(question || "")
    .replace(/["\\:+\-!(){}[\]^~*?/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function retrieveChunks(ownerId, question) {
  const fullTextQuery = safeFullTextQuery(question);
  if (!fullTextQuery) return [];
  try {
    return await read(
      `
      CALL db.index.fulltext.queryNodes("text_chunk_fulltext", $fullTextQuery, {limit: 30})
      YIELD node, score
      WHERE node.ownerId = $ownerId
      MATCH (d:SourceDocument {ownerId: $ownerId})-[:HAS_CHUNK]->(node)
      RETURN node, d, score
      ORDER BY score DESC
      LIMIT 20
      `,
      { ownerId, fullTextQuery }
    );
  } catch {
    return read(
      `
      MATCH (d:SourceDocument {ownerId: $ownerId})-[:HAS_CHUNK]->(node:TextChunk {ownerId: $ownerId})
      WHERE toLower(node.text) CONTAINS toLower($question)
      RETURN node, d, 1.0 AS score
      ORDER BY d.createdAt DESC
      LIMIT 20
      `,
      { ownerId, question: question.slice(0, 200) }
    );
  }
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) return -1;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  return leftNorm && rightNorm ? dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)) : -1;
}

async function retrieveVectorChunks(ownerId, queryEmbedding, embeddingModel) {
  if (!queryEmbedding?.length || !embeddingModel) return [];
  const records = await read(
    `
    MATCH (d:SourceDocument {ownerId: $ownerId})-[:HAS_CHUNK]->(node:TextChunk {ownerId: $ownerId})
    WHERE node.embedding IS NOT NULL AND node.embeddingModel = $embeddingModel
    RETURN node, d
    ORDER BY d.createdAt DESC
    LIMIT 600
    `,
    { ownerId, embeddingModel }
  );
  return records
    .map((record) => ({
      record,
      score: cosineSimilarity(record.get("node").properties.embedding, queryEmbedding)
    }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 20);
}

async function retrieveNoteAbstracts(ownerId, question, workspaceId = "", currentNoteId = "") {
  const fullTextQuery = safeFullTextQuery(question);
  if (!fullTextQuery) return [];
  try {
    return await read(
      `
      CALL db.index.fulltext.queryNodes("note_fulltext", $fullTextQuery, {limit: 40})
      YIELD node, score
      WHERE node.ownerId = $ownerId
        AND ($workspaceId = "" OR node.workspaceId = $workspaceId)
      WITH node, score +
        CASE WHEN node.id = $currentNoteId THEN 10 ELSE 0 END +
        CASE WHEN EXISTS {
          MATCH (:Note {id: $currentNoteId, ownerId: $ownerId})-[:LINKS_TO]-(node)
        } THEN 3 ELSE 0 END AS adjustedScore
      RETURN node, adjustedScore AS score
      ORDER BY score DESC
      LIMIT 20
      `,
      { ownerId, workspaceId, currentNoteId, fullTextQuery }
    );
  } catch {
    return read(
      `
      MATCH (node:Note {ownerId: $ownerId})
      WHERE ($workspaceId = "" OR node.workspaceId = $workspaceId)
        AND (toLower(node.title) CONTAINS toLower($question)
          OR toLower(node.abstract) CONTAINS toLower($question))
      RETURN node, CASE WHEN node.id = $currentNoteId THEN 10.0 ELSE 1.0 END AS score
      ORDER BY score DESC, node.updatedAt DESC
      LIMIT 20
      `,
      { ownerId, workspaceId, currentNoteId, question: question.slice(0, 200) }
    );
  }
}

async function retrieveNoteGraph(ownerId, noteIds) {
  if (!noteIds.length) return { nodes: [], links: [] };
  const records = await read(
    `
    MATCH (seed:Note {ownerId: $ownerId})
    WHERE seed.id IN $noteIds
    OPTIONAL MATCH (seed)-[:LINKS_TO]-(first:Note {ownerId: $ownerId})
    WITH collect(DISTINCT seed) AS seeds, collect(DISTINCT first)[..10] AS firstLayer
    UNWIND CASE WHEN firstLayer = [] THEN [null] ELSE firstLayer END AS first
    OPTIONAL MATCH (first)-[:LINKS_TO]-(second:Note {ownerId: $ownerId})
    WITH seeds, firstLayer, collect(DISTINCT second)[..10] AS secondLayer
    WITH seeds + firstLayer + secondLayer AS allNodes
    UNWIND allNodes AS node
    WITH collect(DISTINCT node) AS nodes
    UNWIND nodes AS source
    OPTIONAL MATCH (source)-[rel:LINKS_TO]->(target:Note)
    WHERE target IN nodes
    RETURN nodes, collect(DISTINCT {
      id: rel.id, sourceId: source.id, targetId: target.id, type: "LINKS_TO",
      source: rel.source, confidence: rel.confidence, createdAt: rel.createdAt
    }) AS links
    `,
    { ownerId, noteIds }
  );
  if (!records.length) return { nodes: [], links: [] };
  return {
    nodes: records[0].get("nodes").filter(Boolean).map((node) => ({
      id: node.properties.id,
      title: node.properties.title,
      kind: "Note",
      summary: node.properties.abstract || "",
      tags: node.properties.tags || []
    })),
    links: records[0].get("links").filter((link) => link.id)
  };
}

async function retrieveItems(ownerId, question) {
  const fullTextQuery = safeFullTextQuery(question);
  if (!fullTextQuery) return [];
  try {
    return await read(
      `
      CALL db.index.fulltext.queryNodes("knowledge_item_fulltext", $fullTextQuery, {limit: 30})
      YIELD node, score
      WHERE node.ownerId = $ownerId
      RETURN node, score
      ORDER BY score DESC
      LIMIT 12
      `,
      { ownerId, fullTextQuery }
    );
  } catch {
    return read(
      `
      MATCH (node:KnowledgeItem {ownerId: $ownerId})
      WHERE toLower(node.title) CONTAINS toLower($question)
         OR toLower(node.summary) CONTAINS toLower($question)
         OR toLower(node.content) CONTAINS toLower($question)
      RETURN node, 1.0 AS score
      ORDER BY node.updatedAt DESC
      LIMIT 12
      `,
      { ownerId, question: question.slice(0, 200) }
    );
  }
}

export async function retrieveGraphRagContext({
  ownerId,
  question,
  queryEmbedding = null,
  embeddingModel = "",
  workspaceId = "",
  currentNoteId = ""
}) {
  const [rawChunkRecords, rawVectorRecords, itemRecords, noteRecords] = await Promise.all([
    retrieveChunks(ownerId, question),
    retrieveVectorChunks(ownerId, queryEmbedding, embeddingModel),
    retrieveItems(ownerId, question),
    retrieveNoteAbstracts(ownerId, question, workspaceId, currentNoteId)
  ]);
  const noteCandidates = noteRecords.map((record) => {
    const props = record.get("node").properties;
    return {
      id: props.id,
      title: props.title,
      abstract: props.abstract || "",
      score: Number(record.get("score"))
    };
  });
  const selectedNoteIds = new Set(noteCandidates.slice(0, 5).map((note) => note.id));
  const belongsToSelectedNote = (record) => {
    if (!selectedNoteIds.size) return true;
    const props = record.get("d").properties;
    return !props.workspaceId || selectedNoteIds.has(props.id);
  };
  const chunkRecords = rawChunkRecords.filter(belongsToSelectedNote);
  const vectorRecords = rawVectorRecords.filter((entry) => belongsToSelectedNote(entry.record));

  const sourceFromRecord = (record) => {
    const chunk = record.get("node").properties;
    const document = record.get("d").properties;
    return {
      documentId: document.id,
      documentTitle: document.title,
      chunkId: chunk.id,
      chunkIndex: toNativeNumber(chunk.index),
      text: chunk.text
    };
  };
  const fused = new Map();
  chunkRecords.forEach((record, index) => {
    const source = sourceFromRecord(record);
    fused.set(source.chunkId, {
      ...source,
      lexicalScore: Number(record.get("score")),
      vectorScore: null,
      fusionScore: 1 / (60 + index + 1),
      retrieval: ["fulltext"]
    });
  });
  vectorRecords.forEach((entry, index) => {
    const source = sourceFromRecord(entry.record);
    const current = fused.get(source.chunkId) || {
      ...source,
      lexicalScore: null,
      vectorScore: null,
      fusionScore: 0,
      retrieval: []
    };
    current.vectorScore = entry.score;
    current.fusionScore += 1 / (60 + index + 1);
    current.retrieval.push("vector");
    fused.set(source.chunkId, current);
  });
  const sources = [...fused.values()]
    .sort((left, right) => right.fusionScore - left.fusionScore)
    .slice(0, 12)
    .map((source, index) => ({
      ...source,
      ref: `S${index + 1}`,
      score: source.vectorScore ?? source.lexicalScore ?? source.fusionScore
    }));

  const itemIds = new Set(itemRecords.map((record) => record.get("node").properties.id));
  if (sources.length) {
    const evidenceRecords = await read(
      `
      MATCH (e:Evidence {ownerId: $ownerId, targetType: "item"})-[:FROM_CHUNK]->(c:TextChunk)
      WHERE c.id IN $chunkIds
      RETURN DISTINCT e.targetId AS targetId
      `,
      { ownerId, chunkIds: sources.map((source) => source.chunkId) }
    );
    evidenceRecords.forEach((record) => itemIds.add(record.get("targetId")));
  }

  const noteGraph = await retrieveNoteGraph(ownerId, [...selectedNoteIds]);
  if (!itemIds.size) return {
    sources,
    noteCandidates,
    nodes: noteGraph.nodes,
    links: noteGraph.links,
    retrievalMode: vectorRecords.length ? "hybrid" : "fulltext"
  };
  const graphRecords = await read(
    `
    MATCH (seed:KnowledgeItem {ownerId: $ownerId})
    WHERE seed.id IN $itemIds
    OPTIONAL MATCH (seed)-[r:RELATED_TO]-(neighbor:KnowledgeItem {ownerId: $ownerId})
    WHERE r.ownerId = $ownerId
    RETURN collect(DISTINCT seed) + collect(DISTINCT neighbor) AS nodes,
           collect(DISTINCT {rel: r, source: startNode(r).id, target: endNode(r).id}) AS links
    `,
    { ownerId, itemIds: [...itemIds] }
  );
  const record = graphRecords[0];
  const nodes = [...noteGraph.nodes, ...record.get("nodes").filter(Boolean).map(nodeToItem)];
  const uniqueNodes = [...new Map(nodes.map((node) => [node.id, node])).values()];
  const nodeIds = new Set(uniqueNodes.map((node) => node.id));
  const links = [...noteGraph.links, ...record.get("links")
    .filter((entry) => entry.rel && nodeIds.has(entry.source) && nodeIds.has(entry.target))
    .map((entry) => ({
      ...relationshipToLink(entry.rel),
      sourceId: entry.source,
      targetId: entry.target
    }))];
  return {
    sources,
    noteCandidates,
    nodes: uniqueNodes.slice(0, 40),
    links: [...new Map(links.map((link) => [link.id, link])).values()].slice(0, 80),
    retrievalMode: vectorRecords.length ? "hybrid" : "fulltext"
  };
}

export function formatRagContext(context) {
  const sourceText = context.sources.length
    ? context.sources.map((source) => `[${source.ref}] ${source.documentTitle} / 分块 ${source.chunkIndex + 1}\n${source.text}`).join("\n\n")
    : "没有召回原始资料分块。";
  const graphText = context.links.length
    ? context.links.map((link, index) => {
      const source = context.nodes.find((node) => node.id === link.sourceId);
      const target = context.nodes.find((node) => node.id === link.targetId);
      return `[G${index + 1}] ${source?.title || link.sourceId} -${link.type}-> ${target?.title || link.targetId}${link.note ? `：${link.note}` : ""}`;
    }).join("\n")
    : context.nodes.map((node, index) => `[G${index + 1}] ${node.title}：${node.summary}`).join("\n") || "没有召回知识图谱节点。";
  return `原始资料：\n${sourceText}\n\n知识图谱：\n${graphText}`;
}

import crypto from "node:crypto";
import { read, toNativeNumber, write } from "./db.js";
import { chunkMarkdown, contentHash, parseMarkdown } from "./markdown.js";
import { estimateTokens } from "./token-budget.js";

function noteFromProps(props, extras = {}) {
  return {
    id: props.id,
    workspaceId: props.workspaceId,
    title: props.title,
    abstract: props.abstract || "",
    content: props.content || "",
    contentHash: props.contentHash,
    totalTokens: toNativeNumber(props.totalTokens || 0),
    tags: props.tags || [],
    unresolvedLinks: props.unresolvedLinks || [],
    createdAt: props.createdAt,
    updatedAt: props.updatedAt,
    ...extras
  };
}

export async function ensureDefaultWorkspace(ownerId) {
  const timestamp = new Date().toISOString();
  const records = await write(
    `
    MATCH (u:User {id: $ownerId})
    MERGE (u)-[:OWNS]->(w:Workspace {ownerId: $ownerId, isDefault: true})
    ON CREATE SET w.id = $id,
                  w.name = "My Knowledge",
                  w.visibility = "private",
                  w.createdAt = $timestamp
    SET w.updatedAt = coalesce(w.updatedAt, $timestamp)
    RETURN w
    `,
    { ownerId, id: crypto.randomUUID(), timestamp }
  );
  return records[0]?.get("w")?.properties || null;
}

export async function listWorkspaces(ownerId) {
  await ensureDefaultWorkspace(ownerId);
  const records = await read(
    `
    MATCH (:User {id: $ownerId})-[:OWNS]->(w:Workspace)
    OPTIONAL MATCH (w)-[:CONTAINS]->(n:Note)
    RETURN w, count(n) AS noteCount
    ORDER BY w.isDefault DESC, w.updatedAt DESC
    `,
    { ownerId }
  );
  return records.map((record) => ({
    ...record.get("w").properties,
    noteCount: toNativeNumber(record.get("noteCount"))
  }));
}

export async function createWorkspace(ownerId, { name, visibility = "private" }) {
  const timestamp = new Date().toISOString();
  const records = await write(
    `
    MATCH (u:User {id: $ownerId})
    CREATE (u)-[:OWNS]->(w:Workspace {
      id: $id,
      ownerId: $ownerId,
      name: $name,
      visibility: $visibility,
      isDefault: false,
      createdAt: $timestamp,
      updatedAt: $timestamp
    })
    RETURN w
    `,
    { ownerId, id: crypto.randomUUID(), name, visibility, timestamp }
  );
  return records[0]?.get("w")?.properties || null;
}

export async function listNotes(ownerId, workspaceId, query = "") {
  const records = await read(
    `
    MATCH (w:Workspace {id: $workspaceId, ownerId: $ownerId})-[:CONTAINS]->(n:Note)
    WHERE $query = ""
       OR toLower(n.title) CONTAINS toLower($query)
       OR toLower(n.abstract) CONTAINS toLower($query)
    OPTIONAL MATCH (n)-[:HAS_CHUNK]->(c:Chunk)
    OPTIONAL MATCH (n)-[:LINKS_TO]->(outbound:Note)
    OPTIONAL MATCH (inbound:Note)-[:LINKS_TO]->(n)
    RETURN n, count(DISTINCT c) AS chunkCount,
           count(DISTINCT outbound) AS outboundCount,
           count(DISTINCT inbound) AS backlinkCount
    ORDER BY n.updatedAt DESC
    LIMIT 200
    `,
    { ownerId, workspaceId, query }
  );
  return records.map((record) => noteFromProps(record.get("n").properties, {
    content: undefined,
    chunkCount: toNativeNumber(record.get("chunkCount")),
    outboundCount: toNativeNumber(record.get("outboundCount")),
    backlinkCount: toNativeNumber(record.get("backlinkCount"))
  }));
}

export async function getNote(ownerId, id) {
  const records = await read(
    `
    MATCH (n:Note {id: $id, ownerId: $ownerId})
    OPTIONAL MATCH (n)-[:HAS_CHUNK]->(c:Chunk)
    OPTIONAL MATCH (n)-[link:LINKS_TO]->(target:Note)
    OPTIONAL MATCH (source:Note)-[backlink:LINKS_TO]->(n)
    RETURN n,
           collect(DISTINCT c {
             .id, .index, .start, .end, .text, .tokenCount, .heading, .headingPath
           }) AS chunks,
           collect(DISTINCT target { .id, .title, alias: link.alias }) AS links,
           collect(DISTINCT source { .id, .title }) AS backlinks
    `,
    { ownerId, id }
  );
  if (!records.length) return null;
  const record = records[0];
  return noteFromProps(record.get("n").properties, {
    chunks: record.get("chunks")
      .filter((chunk) => chunk.id)
      .map((chunk) => ({
        ...chunk,
        index: toNativeNumber(chunk.index),
        start: toNativeNumber(chunk.start),
        end: toNativeNumber(chunk.end),
        tokenCount: toNativeNumber(chunk.tokenCount)
      }))
      .sort((left, right) => left.index - right.index),
    links: record.get("links").filter((link) => link.id),
    backlinks: record.get("backlinks").filter((link) => link.id)
  });
}

function deterministicAbstract(content, maxTokens = 180) {
  const paragraphs = String(content || "")
    .replace(/^#{1,6}\s+.+$/gm, "")
    .split(/\n\s*\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  let result = "";
  for (const paragraph of paragraphs) {
    if (estimateTokens(`${result}\n${paragraph}`) > maxTokens) break;
    result = result ? `${result}\n${paragraph}` : paragraph;
  }
  return result || String(content || "").slice(0, 600);
}

export async function saveNote(ownerId, input) {
  const workspace = input.workspaceId
    ? { id: input.workspaceId }
    : await ensureDefaultWorkspace(ownerId);
  const workspaceId = workspace?.id;
  if (!workspaceId) throw new Error("Workspace not found");
  const normalizedContent = String(input.content || "").replace(/\r\n/g, "\n");
  const hash = contentHash(normalizedContent);
  if (input.id) {
    const existing = await read(
      "MATCH (n:Note {id: $id, ownerId: $ownerId}) RETURN n",
      { id: input.id, ownerId }
    );
    if (!existing.length) return null;
    const props = existing[0].get("n").properties;
    if (props.contentHash === hash) {
      const title = input.title ?? props.title;
      const abstract = input.abstract ?? props.abstract ?? "";
      const metadataChanged = title !== props.title || abstract !== (props.abstract || "");
      if (metadataChanged) {
        await write(
          `
          MATCH (n:Note {id: $id, ownerId: $ownerId})
          SET n.title = $title, n.abstract = $abstract, n.updatedAt = $timestamp
          `,
          { id: input.id, ownerId, title, abstract, timestamp: new Date().toISOString() }
        );
      }
      return {
        note: await getNote(ownerId, input.id),
        changed: metadataChanged,
        contentChanged: false
      };
    }
  }

  const id = input.id || crypto.randomUUID();
  const parsed = parseMarkdown(normalizedContent);
  const chunks = chunkMarkdown(normalizedContent);
  const abstract = input.abstract || deterministicAbstract(normalizedContent);
  const timestamp = new Date().toISOString();
  const linkTargets = [...new Map(parsed.links.map((link) => [
    link.target.toLocaleLowerCase(),
    { title: link.target, alias: link.alias }
  ])).values()];

  const records = await write(
    `
    MATCH (w:Workspace {id: $workspaceId, ownerId: $ownerId})
    MERGE (n:Note:SourceDocument {id: $id, ownerId: $ownerId})
    ON CREATE SET n.createdAt = $timestamp
    SET n.workspaceId = $workspaceId,
        n.title = $title,
        n.abstract = $abstract,
        n.content = $content,
        n.contentHash = $contentHash,
        n.totalTokens = $totalTokens,
        n.tags = $tags,
        n.sourceType = "markdown",
        n.abstractSource = CASE WHEN $abstractProvided THEN "user" ELSE "deterministic" END,
        n.updatedAt = $timestamp
    MERGE (w)-[:CONTAINS]->(n)
    WITH n
    OPTIONAL MATCH (n)-[:HAS_CHUNK]->(oldChunk:Chunk)
    DETACH DELETE oldChunk
    WITH DISTINCT n
    OPTIONAL MATCH (n)-[oldLink:LINKS_TO]->()
    DELETE oldLink
    WITH DISTINCT n
    OPTIONAL MATCH (n)-[oldTopic:BELONGS_TO]->()
    DELETE oldTopic
    WITH DISTINCT n
    CALL (n) {
      UNWIND $chunks AS chunk
      CREATE (n)-[:HAS_CHUNK]->(:Chunk:TextChunk {
        id: chunk.id,
        ownerId: $ownerId,
        workspaceId: $workspaceId,
        documentId: $id,
        noteId: $id,
        index: chunk.index,
        start: chunk.start,
        end: chunk.end,
        text: chunk.text,
        tokenCount: chunk.tokenCount,
        heading: chunk.heading,
        headingPath: chunk.headingPath,
        createdAt: $timestamp
      })
    }
    CALL (n) {
      UNWIND $tags AS tagName
      MERGE (topic:Topic {ownerId: $ownerId, workspaceId: $workspaceId, name: tagName})
      ON CREATE SET topic.id = randomUUID(), topic.createdAt = $timestamp
      MERGE (n)-[:BELONGS_TO {source: "user", confidence: 1.0, createdAt: $timestamp}]->(topic)
    }
    CALL (n) {
      UNWIND $linkTargets AS linkTarget
      OPTIONAL MATCH (target:Note {ownerId: $ownerId, workspaceId: $workspaceId})
      WHERE toLower(target.title) = toLower(linkTarget.title) AND target.id <> n.id
      WITH n, linkTarget, target
      WHERE target IS NOT NULL
      MERGE (n)-[r:LINKS_TO]->(target)
      SET r.id = coalesce(r.id, randomUUID()),
          r.alias = linkTarget.alias,
          r.source = "user",
          r.confidence = 1.0,
          r.createdAt = coalesce(r.createdAt, $timestamp)
    }
    WITH n
    OPTIONAL MATCH (n)-[:LINKS_TO]->(resolved:Note)
    WITH n, collect(toLower(resolved.title)) AS resolvedTitles
    SET n.unresolvedLinks = [link IN $linkTargets WHERE NOT toLower(link.title) IN resolvedTitles | link.title]
    RETURN n
    `,
    {
      id,
      ownerId,
      workspaceId,
      title: input.title || "Untitled",
      abstract,
      abstractProvided: Boolean(input.abstract),
      content: normalizedContent,
      contentHash: hash,
      totalTokens: estimateTokens(normalizedContent),
      tags: parsed.tags,
      linkTargets,
      chunks: chunks.map((chunk) => ({ ...chunk, id: crypto.randomUUID() })),
      timestamp
    }
  );
  if (!records.length) return null;
  return { note: await getNote(ownerId, id), changed: true, contentChanged: true };
}

export async function deleteNote(ownerId, id) {
  const records = await write(
    `
    MATCH (n:Note {id: $id, ownerId: $ownerId})
    OPTIONAL MATCH (n)-[:HAS_CHUNK]->(c:Chunk)
    DETACH DELETE c, n
    RETURN count(*) AS deleted
    `,
    { ownerId, id }
  );
  return toNativeNumber(records[0]?.get("deleted") || 0);
}

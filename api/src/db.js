import neo4j from "neo4j-driver";
import dotenv from "dotenv";

dotenv.config();

const uri = process.env.NEO4J_URI || "bolt://localhost:7687";
const username = process.env.NEO4J_USERNAME || "neo4j";
const password = process.env.NEO4J_PASSWORD || "change-me-strong-password";
const database = process.env.NEO4J_DATABASE || "neo4j";

export const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));

export async function read(cypher, params = {}) {
  const session = driver.session({ database, defaultAccessMode: neo4j.session.READ });
  try {
    const result = await session.run(cypher, params);
    return result.records;
  } finally {
    await session.close();
  }
}

export async function write(cypher, params = {}) {
  const session = driver.session({ database, defaultAccessMode: neo4j.session.WRITE });
  try {
    const result = await session.run(cypher, params);
    return result.records;
  } finally {
    await session.close();
  }
}

export function nodeToItem(node) {
  const props = node.properties;
  return {
    id: props.id,
    title: props.title,
    kind: props.kind,
    summary: props.summary || "",
    content: props.content || "",
    tags: props.tags || [],
    source: props.source || "",
    createdAt: props.createdAt,
    updatedAt: props.updatedAt
  };
}

export function relationshipToLink(rel) {
  const props = rel.properties;
  return {
    id: props.id,
    type: props.type,
    note: props.note || "",
    source: props.source || "",
    confidence: props.confidence == null ? null : Number(props.confidence),
    model: props.model || "",
    evidenceChunkId: props.evidenceChunkId || "",
    createdAt: props.createdAt
  };
}

export function toNativeNumber(value) {
  return typeof value?.toNumber === "function" ? value.toNumber() : Number(value);
}

export async function closeDriver() {
  await driver.close();
}

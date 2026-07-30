import crypto from "node:crypto";
import http from "node:http";
import { closeDriver, write } from "../src/db.js";
import { createSessionToken, encryptSecret, hashPassword } from "../src/auth.js";

const apiBase = `http://127.0.0.1:${process.env.API_PORT || 4000}`;
const marker = `SB_VERIFY_${crypto.randomUUID()}`;
const profileId = crypto.randomUUID();
const testUser = {
  id: crypto.randomUUID(),
  email: `verify-${crypto.randomUUID()}@example.com`,
  displayName: "Production Verifier",
  avatarUrl: "",
  role: "member"
};
const documentIds = [];
const sourceTitles = [`${marker}_relevant`, `${marker}_other`];
let jobId = "";

function json(res, payload) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

const mockProvider = http.createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  if (req.url.endsWith("/embeddings")) {
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    return json(res, {
      data: inputs.map((text, index) => ({
        index,
        embedding: String(text).includes("semantic-target") || String(text).includes("语义目标")
          ? [1, 0, 0]
          : [0, 1, 0]
      }))
    });
  }
  if (req.url.endsWith("/chat/completions")) {
    const prompt = String(body.messages?.at(-1)?.content || "");
    const candidates = JSON.parse(prompt.split("候选：\n").at(-1));
    const ranking = candidates
      .map((candidate) => ({
        index: candidate.index,
        score: candidate.text.includes("semantic-target") ? 0.99 : 0.1
      }))
      .sort((left, right) => right.score - left.score);
    return json(res, { choices: [{ message: { content: JSON.stringify({ ranking }) } }] });
  }
  res.writeHead(404);
  res.end();
});

await new Promise((resolve) => mockProvider.listen(4999, "127.0.0.1", resolve));

let token = "";
try {
  const timestamp = new Date().toISOString();
  await write(
    `
    CREATE (:User {
      id: $id,
      email: $email,
      displayName: $displayName,
      avatarUrl: "",
      role: "member",
      passwordHash: $passwordHash,
      createdAt: $timestamp,
      updatedAt: $timestamp
    })
    `,
    { ...testUser, passwordHash: hashPassword("production-verifier-password"), timestamp }
  );
  token = createSessionToken(testUser);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  await write(
    `
    MATCH (u:User {id: $ownerId})
    CREATE (u)-[:OWNS_MODEL_PROFILE]->(p:ModelProfile {
      id: $id,
      ownerId: $ownerId,
      label: $label,
      protocol: "openai-compatible",
      baseUrl: "http://127.0.0.1:4999",
      model: "mock-chat",
      embeddingModel: "mock-embedding",
      rerankModel: "mock-rerank",
      apiKeyCipher: $apiKeyCipher,
      isDefault: false,
      createdAt: $timestamp,
      updatedAt: $timestamp
    })
    `,
    {
      id: profileId,
      ownerId: testUser.id,
      label: marker,
      apiKeyCipher: encryptSecret("mock-api-key-123456"),
      timestamp: new Date().toISOString()
    }
  );

  const documents = [
    {
      source: sourceTitles[0],
      text: `semantic-target 是本次生产验收的语义目标。该来源应当被向量检索和重排共同置顶。`
    },
    {
      source: sourceTitles[1],
      text: "苹果和梨是常见水果。这段资料与语义目标没有关联，只用于形成负候选。"
    }
  ];
  for (const document of documents) {
    const response = await fetch(`${apiBase}/api/extract/commit`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: document.source,
        text: document.text,
        profileId: "",
        graph: {
          nodes: [{
            title: document.source,
            kind: "Concept",
            summary: document.text,
            content: "",
            tags: ["production-verification"],
            source: document.source,
            evidence: document.text
          }],
          facts: [{
            statement: document.text.split("。")[0],
            evidence: document.text.split("。")[0],
            confidence: 0.99,
            entityTitles: [document.source]
          }],
          links: []
        }
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`写入测试来源失败：${JSON.stringify(payload)}`);
    documentIds.push(payload.documentId);
  }

  const jobResponse = await fetch(`${apiBase}/api/embedding-jobs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ profileId })
  });
  const jobPayload = await jobResponse.json();
  if (!jobResponse.ok) throw new Error(`创建向量任务失败：${JSON.stringify(jobPayload)}`);
  jobId = jobPayload.job.id;

  let job;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const response = await fetch(`${apiBase}/api/embedding-jobs/${jobId}`, { headers });
    job = (await response.json()).job;
    if (job.status === "completed" || job.status === "failed") break;
  }
  if (job?.status !== "completed") throw new Error(`向量任务未完成：${JSON.stringify(job)}`);

  const retrievalResponse = await fetch(
    `${apiBase}/api/rag/retrieve?q=${encodeURIComponent("语义目标")}&profileId=${profileId}`,
    { headers }
  );
  const retrieval = await retrievalResponse.json();
  if (!retrievalResponse.ok) throw new Error(`检索失败：${JSON.stringify(retrieval)}`);
  const result = {
    embeddingJob: job.status,
    processed: job.processed,
    retrievalMode: retrieval.retrievalMode,
    rerankApplied: retrieval.rerankApplied,
    topDocument: retrieval.sources[0]?.documentTitle,
    expectedTopDocument: sourceTitles[0]
  };
  if (
    result.embeddingJob !== "completed"
    || result.retrievalMode !== "hybrid+rerank"
    || !result.rerankApplied
    || result.topDocument !== result.expectedTopDocument
  ) {
    throw new Error(`验收断言失败：${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result));
} finally {
  if (documentIds.length) {
    await write("MATCH (e:Evidence) WHERE e.documentId IN $ids DETACH DELETE e", { ids: documentIds });
    await write("MATCH (f:Fact) WHERE f.documentId IN $ids DETACH DELETE f", { ids: documentIds });
    await write(
      "MATCH (d:SourceDocument) WHERE d.id IN $ids OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:TextChunk) DETACH DELETE c, d",
      { ids: documentIds }
    );
  }
  await write("MATCH (n:KnowledgeItem) WHERE n.source IN $sources DETACH DELETE n", { sources: sourceTitles });
  await write("MATCH (j:EmbeddingJob {id: $id}) DELETE j", { id: jobId });
  await write("MATCH (p:ModelProfile {id: $id}) DETACH DELETE p", { id: profileId });
  await write("MATCH (u:User {id: $id}) DETACH DELETE u", { id: testUser.id });
  await new Promise((resolve) => mockProvider.close(resolve));
  await closeDriver();
}

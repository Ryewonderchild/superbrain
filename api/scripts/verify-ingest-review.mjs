import crypto from "node:crypto";
import http from "node:http";
import { closeDriver, read, write } from "../src/db.js";
import { createSessionToken, encryptSecret, hashPassword } from "../src/auth.js";

const apiBase = `http://127.0.0.1:${process.env.API_PORT || 4000}`;
const marker = `SB_REVIEW_VERIFY_${crypto.randomUUID()}`;
const profileId = crypto.randomUUID();
const user = {
  id: crypto.randomUUID(),
  email: `review-verify-${crypto.randomUUID()}@example.com`,
  displayName: "Review Verifier",
  avatarUrl: "",
  role: "member"
};
const sourceText = "风险管理用于控制投资损失。风险防范高于追求回报。";
let jobId = "";
let documentId = "";

const extraction = {
  nodes: [
    {
      title: "风险管理",
      kind: "Topic",
      summary: "控制投资损失的管理主题。",
      tags: ["投资"],
      evidence: "风险管理用于控制投资损失。",
      attributes: []
    },
    {
      title: "风险防范高于追求回报",
      kind: "Concept",
      summary: "一条被错误建模为实体的完整判断。",
      tags: [],
      evidence: "风险防范高于追求回报。",
      attributes: []
    }
  ],
  facts: [
    {
      statement: "风险管理用于控制投资损失。",
      evidence: "风险管理用于控制投资损失。",
      confidence: 0.99,
      entityTitles: ["风险管理"]
    },
    {
      statement: "风险防范高于追求回报。",
      evidence: "风险防范高于追求回报。",
      confidence: 0.98,
      entityTitles: ["风险管理"]
    }
  ],
  links: []
};

const provider = http.createServer(async (req, res) => {
  for await (const _chunk of req) {
    // Drain the request.
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(extraction) } }],
    usage: { prompt_tokens: 20, completion_tokens: 10 }
  }));
});

await new Promise((resolve) => provider.listen(4996, "127.0.0.1", resolve));

try {
  const timestamp = new Date().toISOString();
  await write(
    `
    CREATE (:User {
      id: $id, email: $email, displayName: $displayName, avatarUrl: "",
      role: "member", passwordHash: $passwordHash,
      createdAt: $timestamp, updatedAt: $timestamp
    })
    `,
    { ...user, passwordHash: hashPassword("review-verifier-password"), timestamp }
  );
  await write(
    `
    MATCH (u:User {id: $ownerId})
    CREATE (u)-[:OWNS_MODEL_PROFILE]->(:ModelProfile {
      id: $id, ownerId: $ownerId, label: $label,
      protocol: "openai-compatible", baseUrl: "http://127.0.0.1:4996",
      model: "review-mock", embeddingModel: "", rerankModel: "",
      apiKeyCipher: $apiKeyCipher, isDefault: true,
      createdAt: $timestamp, updatedAt: $timestamp
    })
    `,
    {
      id: profileId,
      ownerId: user.id,
      label: marker,
      apiKeyCipher: encryptSecret("review-mock-key-123456"),
      timestamp
    }
  );

  const headers = {
    Authorization: `Bearer ${createSessionToken(user)}`,
    "Content-Type": "application/json"
  };
  const createResponse = await fetch(`${apiBase}/api/ingest/jobs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ profileId, source: marker, text: sourceText })
  });
  const created = await createResponse.json();
  if (!createResponse.ok) throw new Error(`创建审核任务失败：${JSON.stringify(created)}`);
  jobId = created.job.id;

  let reviewJob;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const response = await fetch(`${apiBase}/api/ingest/jobs/${jobId}`, { headers });
    reviewJob = (await response.json()).job;
    if (["review_required", "failed", "completed"].includes(reviewJob.status)) break;
  }
  if (reviewJob?.status !== "review_required") {
    throw new Error(`任务没有进入待审核：${JSON.stringify(reviewJob)}`);
  }
  if (!reviewJob.workflow?.issues?.some((entry) => entry.code === "PROPOSITION_AS_ENTITY")) {
    throw new Error(`没有识别命题实体问题：${JSON.stringify(reviewJob.workflow)}`);
  }

  const commitResponse = await fetch(`${apiBase}/api/ingest/jobs/${jobId}/discard-invalid`, {
    method: "POST",
    headers
  });
  const committed = await commitResponse.json();
  if (!commitResponse.ok) throw new Error(`剔除问题项失败：${JSON.stringify(committed)}`);
  documentId = committed.job.documentId || "";

  const result = {
    initialStatus: reviewJob.status,
    issueCode: reviewJob.workflow.issues[0].code,
    finalStatus: committed.job.status,
    discardedNodes: committed.discarded.nodes,
    factsWritten: committed.job.result?.facts || 0,
    reviewAction: committed.job.reviewAction
  };
  if (
    result.initialStatus !== "review_required"
    || result.issueCode !== "PROPOSITION_AS_ENTITY"
    || result.finalStatus !== "completed"
    || result.discardedNodes !== 1
    || result.factsWritten !== 2
    || result.reviewAction !== "discard_invalid"
  ) {
    throw new Error(`审核流程断言失败：${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result));
} finally {
  const documentRecords = await read(
    "MATCH (d:SourceDocument {source: $source}) RETURN d.id AS id",
    { source: marker }
  );
  for (const record of documentRecords) {
    const id = record.get("id");
    await write("MATCH (e:Evidence {documentId: $id}) DETACH DELETE e", { id });
    await write("MATCH (f:Fact {documentId: $id}) DETACH DELETE f", { id });
    await write(
      "MATCH (d:SourceDocument {id: $id}) OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:TextChunk) DETACH DELETE c, d",
      { id }
    );
  }
  await write("MATCH (n:KnowledgeItem {source: $source}) DETACH DELETE n", { source: marker });
  if (jobId) await write("MATCH (j:IngestJob {id: $id}) DELETE j", { id: jobId });
  await write("MATCH (p:ModelProfile {id: $id}) DETACH DELETE p", { id: profileId });
  await write("MATCH (u:User {id: $id}) DETACH DELETE u", { id: user.id });
  await new Promise((resolve) => provider.close(resolve));
  await closeDriver();
}

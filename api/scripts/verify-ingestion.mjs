import crypto from "node:crypto";
import http from "node:http";
import { unlink } from "node:fs/promises";
import { closeDriver, read, write } from "../src/db.js";
import { createSessionToken, encryptSecret, hashPassword } from "../src/auth.js";

const apiBase = `http://127.0.0.1:${process.env.API_PORT || 4000}`;
const marker = `SB_INGEST_VERIFY_${crypto.randomUUID()}`;
const profileId = crypto.randomUUID();
const testUser = {
  id: crypto.randomUUID(),
  email: `ingest-verify-${crypto.randomUUID()}@example.com`,
  displayName: "Ingestion Verifier",
  avatarUrl: "",
  role: "member"
};
let jobId = "";
let documentId = "";

function simplePdf(text) {
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

function respond(res, payload) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

const extraction = {
  nodes: [{
    title: marker,
    kind: "Document",
    summary: "生产摄取验收来源",
    tags: ["production-verification"],
    evidence: "mock visual evidence"
  }],
  facts: [{
    statement: "生产摄取管线成功处理混合来源",
    evidence: "mock visual evidence",
    confidence: 0.99,
    entityTitles: [marker]
  }],
  links: []
};

const mockProvider = http.createServer(async (req, res) => {
  for await (const _chunk of req) {
    // Drain the request body so the provider call completes normally.
  }
  if (req.url.endsWith("/chat/completions")) {
    return respond(res, { choices: [{ message: { content: JSON.stringify(extraction) } }] });
  }
  res.writeHead(404);
  res.end();
});

await new Promise((resolve) => mockProvider.listen(4998, "127.0.0.1", resolve));

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
    { ...testUser, passwordHash: hashPassword("ingestion-verifier-password"), timestamp }
  );
  await write(
    `
    MATCH (u:User {id: $ownerId})
    CREATE (u)-[:OWNS_MODEL_PROFILE]->(:ModelProfile {
      id: $id,
      ownerId: $ownerId,
      label: $label,
      protocol: "openai-compatible",
      baseUrl: "http://127.0.0.1:4998",
      model: "mock-vision",
      embeddingModel: "",
      rerankModel: "",
      apiKeyCipher: $apiKeyCipher,
      isDefault: true,
      createdAt: $timestamp,
      updatedAt: $timestamp
    })
    `,
    {
      id: profileId,
      ownerId: testUser.id,
      label: marker,
      apiKeyCipher: encryptSecret("mock-api-key-123456"),
      timestamp
    }
  );
  const token = createSessionToken(testUser);
  const form = new FormData();
  form.append("profileId", profileId);
  form.append("source", marker);
  form.append("text", "这是直接输入的生产摄取验证文字，长度足够用于创建来源文档。");
  form.append("files", new Blob(["# Markdown\n队列应解析 Markdown 正文。"], { type: "text/markdown" }), "verify.md");
  form.append("files", new Blob([simplePdf("Production PDF ingestion")], { type: "application/pdf" }), "verify.pdf");
  form.append(
    "files",
    new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")], { type: "image/png" }),
    "verify.png"
  );
  const createResponse = await fetch(`${apiBase}/api/ingest/jobs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  const created = await createResponse.json();
  if (!createResponse.ok) throw new Error(`创建摄取任务失败：${JSON.stringify(created)}`);
  jobId = created.job.id;
  const headers = { Authorization: `Bearer ${token}` };
  let job;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const response = await fetch(`${apiBase}/api/ingest/jobs/${jobId}`, { headers });
    job = (await response.json()).job;
    if (job.status === "completed" || job.status === "failed") break;
  }
  if (job?.status !== "completed") throw new Error(`摄取任务未完成：${JSON.stringify(job)}`);

  const documents = await (await fetch(`${apiBase}/api/documents`, { headers })).json();
  const document = documents.documents.find((item) => item.title === marker);
  if (!document) throw new Error("摄取完成后未找到 SourceDocument");
  documentId = document.id;
  const detail = await (await fetch(`${apiBase}/api/documents/${documentId}`, { headers })).json();
  const assetSizes = [];
  for (const asset of detail.document.assets) {
    const response = await fetch(`${apiBase}/api/assets/${asset.id}`, { headers });
    assetSizes.push((await response.arrayBuffer()).byteLength);
  }
  const result = {
    status: job.status,
    facts: job.result?.facts,
    assets: detail.document.assets.length,
    assetSizes,
    chunks: detail.document.chunks.length,
    sourceType: detail.document.sourceType
  };
  if (
    result.status !== "completed"
    || result.facts !== 1
    || result.assets !== 3
    || result.assetSizes.some((size) => size <= 0)
    || result.chunks < 1
    || result.sourceType !== "mixed"
  ) {
    throw new Error(`验收断言失败：${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result));
} finally {
  const assetRecords = documentId
    ? await read("MATCH (:SourceDocument {id: $id})-[:HAS_ASSET]->(a:SourceAsset) RETURN a.storagePath AS path", { id: documentId })
    : [];
  if (documentId) {
    await write("MATCH (:SourceDocument {id: $id})-[:HAS_ASSET]->(a:SourceAsset) DETACH DELETE a", { id: documentId });
    await write("MATCH (e:Evidence {documentId: $id}) DETACH DELETE e", { id: documentId });
    await write("MATCH (f:Fact {documentId: $id}) DETACH DELETE f", { id: documentId });
    await write(
      "MATCH (d:SourceDocument {id: $id}) OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:TextChunk) DETACH DELETE c, d",
      { id: documentId }
    );
  }
  await write("MATCH (n:KnowledgeItem {source: $source}) DETACH DELETE n", { source: marker });
  await write("MATCH (j:IngestJob {id: $id}) DELETE j", { id: jobId });
  await write("MATCH (p:ModelProfile {id: $id}) DETACH DELETE p", { id: profileId });
  await write("MATCH (u:User {id: $id}) DETACH DELETE u", { id: testUser.id });
  for (const record of assetRecords) {
    await unlink(record.get("path")).catch(() => {});
  }
  await new Promise((resolve) => mockProvider.close(resolve));
  await closeDriver();
}

import crypto from "node:crypto";
import http from "node:http";
import { closeDriver, write } from "../src/db.js";
import { createSessionToken, encryptSecret, hashPassword } from "../src/auth.js";

const apiBase = `http://127.0.0.1:${process.env.API_PORT || 4000}`;
const user = {
  id: crypto.randomUUID(),
  email: `conversation-${crypto.randomUUID()}@example.com`,
  displayName: "Conversation Verifier",
  role: "member"
};
const profileId = crypto.randomUUID();
let conversationId = "";
let providerSawHistory = false;

const provider = http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const payload = JSON.parse(body || "{}");
  const prompt = payload.messages?.map((message) => message.content).join("\n") || "";
  if (prompt.includes("第二轮问题") && prompt.includes("第一轮问题")) providerSawHistory = true;
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    choices: [{ message: { content: prompt.includes("第二轮问题") ? "第二轮回答" : "第一轮回答" } }],
    usage: { prompt_tokens: 20, completion_tokens: 5 }
  }));
});

await new Promise((resolve) => provider.listen(4997, "127.0.0.1", resolve));

try {
  const timestamp = new Date().toISOString();
  await write(
    `
    CREATE (:User {
      id: $id, email: $email, displayName: $displayName, avatarUrl: "",
      role: $role, passwordHash: $passwordHash,
      createdAt: $timestamp, updatedAt: $timestamp
    })
    `,
    { ...user, passwordHash: hashPassword("conversation-verifier-password"), timestamp }
  );
  await write(
    `
    MATCH (u:User {id: $ownerId})
    CREATE (u)-[:OWNS_MODEL_PROFILE]->(:ModelProfile {
      id: $id, ownerId: $ownerId, label: "Conversation Mock",
      protocol: "openai-compatible", baseUrl: "http://127.0.0.1:4997",
      model: "conversation-mock", embeddingModel: "", rerankModel: "",
      contextWindow: 32000, promptBudgetTokens: 24000, maxOutputTokens: 300,
      apiKeyCipher: $apiKeyCipher, isDefault: true,
      createdAt: $timestamp, updatedAt: $timestamp
    })
    `,
    {
      id: profileId,
      ownerId: user.id,
      apiKeyCipher: encryptSecret("conversation-mock-key"),
      timestamp
    }
  );
  const headers = {
    Authorization: `Bearer ${createSessionToken(user)}`,
    "Content-Type": "application/json"
  };
  const firstResponse = await fetch(`${apiBase}/api/rag/ask`, {
    method: "POST",
    headers,
    body: JSON.stringify({ question: "第一轮问题", profileId })
  });
  const first = await firstResponse.json();
  if (!firstResponse.ok) throw new Error(`第一轮失败：${JSON.stringify(first)}`);
  conversationId = first.conversationId;

  const secondResponse = await fetch(`${apiBase}/api/rag/ask`, {
    method: "POST",
    headers,
    body: JSON.stringify({ question: "第二轮问题", profileId, conversationId })
  });
  const second = await secondResponse.json();
  if (!secondResponse.ok) throw new Error(`第二轮失败：${JSON.stringify(second)}`);

  const detailResponse = await fetch(`${apiBase}/api/conversations/${conversationId}`, { headers });
  const detail = await detailResponse.json();
  const result = {
    conversationIdStable: second.conversationId === conversationId,
    messageCount: detail.conversation?.messages?.length || 0,
    providerSawHistory
  };
  if (!result.conversationIdStable || result.messageCount !== 4 || !result.providerSawHistory) {
    throw new Error(`对话验收失败：${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result));
} finally {
  if (conversationId) {
    await write(
      "MATCH (c:Conversation {id: $id}) OPTIONAL MATCH (c)-[:HAS_MESSAGE]->(m:Message) DETACH DELETE m, c",
      { id: conversationId }
    );
  }
  await write("MATCH (p:ModelProfile {id: $id}) DETACH DELETE p", { id: profileId });
  await write("MATCH (u:User {id: $id}) DETACH DELETE u", { id: user.id });
  await new Promise((resolve) => provider.close(resolve));
  await closeDriver();
}


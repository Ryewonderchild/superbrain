import crypto from "node:crypto";
import pg from "pg";
import { closeDriver, write } from "../src/db.js";
import { createSessionToken, hashPassword } from "../src/auth.js";
import {
  closeTokenLedger,
  ensureTokenAccount,
  getTokenAccount,
  initializeTokenLedger,
  listTokenUsage,
  reserveTokens,
  settleTokens
} from "../src/token-ledger.js";

const apiBase = `http://127.0.0.1:${process.env.API_PORT || 4000}`;
const user = {
  id: crypto.randomUUID(),
  email: `architecture-${crypto.randomUUID()}@example.com`,
  displayName: "Architecture Verifier",
  avatarUrl: "",
  role: "member"
};
const headers = {
  Authorization: `Bearer ${createSessionToken(user)}`,
  "Content-Type": "application/json"
};

async function api(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, { ...options, headers: { ...headers, ...options.headers } });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(payload)}`);
  return payload;
}

let workspaceId = "";
let alphaId = "";
let betaId = "";
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
    { ...user, passwordHash: hashPassword("architecture-verifier-password"), timestamp }
  );

  await initializeTokenLedger();
  await ensureTokenAccount(user.id, 10000);
  const workspacePayload = await api("/api/workspaces");
  workspaceId = workspacePayload.workspaces[0].id;

  const beta = await api("/api/notes", {
    method: "POST",
    body: JSON.stringify({
      workspaceId,
      title: "Beta",
      content: "# Beta\nBeta is evidence. #verification"
    })
  });
  betaId = beta.note.id;
  const alpha = await api("/api/notes", {
    method: "POST",
    body: JSON.stringify({
      workspaceId,
      title: "Alpha",
      content: "# Alpha\nThis note links to [[Beta|the evidence]]. #verification"
    })
  });
  alphaId = alpha.note.id;
  const firstChunkIds = alpha.note.chunks.map((chunk) => chunk.id);
  const unchanged = await api(`/api/notes/${alphaId}`, {
    method: "PATCH",
    body: JSON.stringify({ title: "Alpha", content: "# Alpha\nThis note links to [[Beta|the evidence]]. #verification" })
  });
  const betaDetail = await api(`/api/notes/${betaId}`);

  const reservation = await reserveTokens({
    userId: user.id,
    workspaceId,
    operation: "chat",
    model: "verification-model",
    tokens: 100
  });
  const settlement = await settleTokens(reservation.id, {
    inputTokens: 12,
    outputTokens: 8,
    cachedTokens: 2,
    cacheMissTokens: 10,
    reasoningTokens: 1
  });
  const account = await getTokenAccount(user.id);
  const events = await listTokenUsage(user.id, 1);

  const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL });
  let immutable = false;
  try {
    await pool.query("UPDATE token_usage_events SET input_tokens = 0 WHERE id = $1", [events[0].id]);
  } catch (error) {
    immutable = String(error.message).includes("append-only");
  } finally {
    await pool.end();
  }

  const result = {
    wikiLink: alpha.note.links[0]?.title === "Beta",
    backlink: betaDetail.note.backlinks[0]?.title === "Alpha",
    incremental: unchanged.contentChanged === false
      && JSON.stringify(unchanged.note.chunks.map((chunk) => chunk.id)) === JSON.stringify(firstChunkIds),
    tokenActual: settlement.actualTokens,
    tokenReturned: settlement.returnedTokens,
    tokenConsumed: account.consumed_tokens,
    cacheMissTokens: Number(events[0].cache_miss_tokens),
    immutableLedger: immutable
  };
  if (
    !result.wikiLink
    || !result.backlink
    || !result.incremental
    || result.tokenActual !== 20
    || result.tokenReturned !== 80
    || result.tokenConsumed !== 20
    || result.cacheMissTokens !== 10
    || !result.immutableLedger
  ) {
    throw new Error(`Architecture verification failed: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result));
} finally {
  if (workspaceId) {
    await write(
      `
      MATCH (w:Workspace {id: $workspaceId})
      OPTIONAL MATCH (w)-[:CONTAINS]->(n:Note)
      OPTIONAL MATCH (n)-[:HAS_CHUNK]->(c:Chunk)
      DETACH DELETE c, n, w
      `,
      { workspaceId }
    );
  }
  await write("MATCH (u:User {id: $id}) DETACH DELETE u", { id: user.id });
  await Promise.all([closeDriver(), closeTokenLedger()]);
}

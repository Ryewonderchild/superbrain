import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import multer from "multer";
import { z } from "zod";
import { closeDriver, driver, nodeToItem, read, relationshipToLink, toNativeNumber, write } from "./db.js";
import { itemSchema, itemUpdateSchema, linkSchema, linkUpdateSchema } from "./schema.js";
import {
  createSessionToken,
  decryptSecret,
  encryptSecret,
  ensureAdminUser,
  getUserByEmail,
  hashPassword,
  requireAdmin,
  requireAuth,
  userFromNode,
  verifyPassword
} from "./auth.js";
import {
  extractGraphFromText,
  extractSchema,
  extractionGraphSchema,
  normalizeExtractionGraph
} from "./extract.js";
import { completeWithProfile, discoverProfileModels, embedWithProfile, extractWithProfile, rerankWithProfile } from "./providers.js";
import { findEvidenceChunk } from "./documents.js";
import { chunkMarkdown, contentHash } from "./markdown.js";
import { textFromUpload } from "./file-parser.js";
import { formatRagContext, retrieveGraphRagContext } from "./rag.js";
import {
  checkTokenLedger,
  closeTokenLedger,
  ensureTokenAccount,
  getTokenAccount,
  initializeTokenLedger,
  listTokenUsage,
  QuotaExceededError,
  releaseExpiredReservations
} from "./token-ledger.js";
import { runMeteredModelCall } from "./metered-model.js";
import { resolveModelCapabilities, resolveRuntimeModelProfile } from "./model-policy.js";
import { sendVerificationEmail } from "./email.js";
import {
  createWorkspace,
  deleteNote,
  ensureDefaultWorkspace,
  getNote,
  listNotes,
  listWorkspaces,
  saveNote
} from "./notes.js";
import { createTokenBudget, estimateTokens, selectWithinTokenBudget } from "./token-budget.js";
import { enrichWebSources, formatWebSearchContext, searchWeb } from "./web-search.js";
import {
  attributesToProperties,
  compileKnowledgeDraft,
  discardInvalidKnowledgeParts
} from "./knowledge-compiler.js";
import {
  classifyRetrievalIntent,
  ensureSemanticModel,
  listSemanticTypes,
  semanticContextText
} from "./semantic-model.js";

const app = express();
const port = Number(process.env.API_PORT || 4000);
const uploadRoot = path.resolve(process.env.UPLOAD_DIR || "/data/uploads");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 6, fileSize: 12 * 1024 * 1024, fieldSize: 2 * 1024 * 1024 }
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));

function now() {
  return new Date().toISOString();
}

function attachModelOutputIssues(compiled, issues) {
  if (!issues.length) return compiled;
  const errors = issues.filter((entry) => entry.severity === "error").length;
  return {
    ...compiled,
    workflow: {
      ...compiled.workflow,
      status: "review_required",
      phases: [
        {
          id: "model_output",
          label: "模型输出标准化",
          status: "review_required"
        },
        ...compiled.workflow.phases.map((phase) => (
          phase.id === "commit" ? { ...phase, status: "blocked" } : phase
        ))
      ],
      issues: [...issues, ...compiled.workflow.issues],
      stats: {
        ...compiled.workflow.stats,
        errors: compiled.workflow.stats.errors + errors,
        isolatedModelItems: issues.length
      }
    }
  };
}

function asyncRoute(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
}

async function ensureSchema() {
  await write("CREATE CONSTRAINT knowledge_item_id IF NOT EXISTS FOR (n:KnowledgeItem) REQUIRE n.id IS UNIQUE");
  await write("CREATE INDEX knowledge_item_title IF NOT EXISTS FOR (n:KnowledgeItem) ON (n.title)");
  await write("CREATE INDEX knowledge_item_kind IF NOT EXISTS FOR (n:KnowledgeItem) ON (n.kind)");
  await write("CREATE INDEX knowledge_item_owner IF NOT EXISTS FOR (n:KnowledgeItem) ON (n.ownerId)");
  await write("CREATE CONSTRAINT model_profile_id IF NOT EXISTS FOR (p:ModelProfile) REQUIRE p.id IS UNIQUE");
  await write("CREATE INDEX model_profile_owner IF NOT EXISTS FOR (p:ModelProfile) ON (p.ownerId)");
  await write("CREATE CONSTRAINT source_document_id IF NOT EXISTS FOR (d:SourceDocument) REQUIRE d.id IS UNIQUE");
  await write("CREATE INDEX source_document_owner IF NOT EXISTS FOR (d:SourceDocument) ON (d.ownerId)");
  await write("CREATE CONSTRAINT source_asset_id IF NOT EXISTS FOR (a:SourceAsset) REQUIRE a.id IS UNIQUE");
  await write("CREATE INDEX source_asset_owner IF NOT EXISTS FOR (a:SourceAsset) ON (a.ownerId)");
  await write("CREATE CONSTRAINT ingest_job_id IF NOT EXISTS FOR (j:IngestJob) REQUIRE j.id IS UNIQUE");
  await write("CREATE INDEX ingest_job_owner IF NOT EXISTS FOR (j:IngestJob) ON (j.ownerId)");
  await write("CREATE INDEX ingest_job_status IF NOT EXISTS FOR (j:IngestJob) ON (j.status)");
  await write("CREATE CONSTRAINT embedding_job_id IF NOT EXISTS FOR (j:EmbeddingJob) REQUIRE j.id IS UNIQUE");
  await write("CREATE INDEX embedding_job_owner IF NOT EXISTS FOR (j:EmbeddingJob) ON (j.ownerId)");
  await write("CREATE INDEX embedding_job_status IF NOT EXISTS FOR (j:EmbeddingJob) ON (j.status)");
  await write("CREATE CONSTRAINT text_chunk_id IF NOT EXISTS FOR (c:TextChunk) REQUIRE c.id IS UNIQUE");
  await write("CREATE INDEX text_chunk_owner IF NOT EXISTS FOR (c:TextChunk) ON (c.ownerId)");
  await write("CREATE CONSTRAINT evidence_id IF NOT EXISTS FOR (e:Evidence) REQUIRE e.id IS UNIQUE");
  await write("CREATE INDEX evidence_target IF NOT EXISTS FOR (e:Evidence) ON (e.targetId)");
  await write("CREATE CONSTRAINT fact_id IF NOT EXISTS FOR (f:Fact) REQUIRE f.id IS UNIQUE");
  await write("CREATE INDEX fact_owner IF NOT EXISTS FOR (f:Fact) ON (f.ownerId)");
  await write("CREATE INDEX fact_status IF NOT EXISTS FOR (f:Fact) ON (f.status)");
  await write("CREATE FULLTEXT INDEX fact_fulltext IF NOT EXISTS FOR (f:Fact) ON EACH [f.statement, f.quote]");
  await write("CREATE CONSTRAINT public_fact_id IF NOT EXISTS FOR (f:PublicFact) REQUIRE f.id IS UNIQUE");
  await write("CREATE INDEX public_fact_status IF NOT EXISTS FOR (f:PublicFact) ON (f.status)");
  await write("CREATE FULLTEXT INDEX public_fact_fulltext IF NOT EXISTS FOR (f:PublicFact) ON EACH [f.title, f.statement, f.evidence]");
  await write("CREATE CONSTRAINT public_entity_id IF NOT EXISTS FOR (e:PublicEntity) REQUIRE e.id IS UNIQUE");
  await write("CREATE CONSTRAINT public_entity_canonical_key IF NOT EXISTS FOR (e:PublicEntity) REQUIRE e.canonicalKey IS UNIQUE");
  await write("CREATE INDEX public_entity_type IF NOT EXISTS FOR (e:PublicEntity) ON (e.entityType)");
  await write("CREATE FULLTEXT INDEX public_entity_fulltext IF NOT EXISTS FOR (e:PublicEntity) ON EACH [e.name, e.description]");
  await write("CREATE CONSTRAINT hypothesis_id IF NOT EXISTS FOR (h:Hypothesis) REQUIRE h.id IS UNIQUE");
  await write("CREATE INDEX hypothesis_status IF NOT EXISTS FOR (h:Hypothesis) ON (h.status)");
  await write("CREATE FULLTEXT INDEX hypothesis_fulltext IF NOT EXISTS FOR (h:Hypothesis) ON EACH [h.title, h.claim, h.rationale]");
  await write("CREATE CONSTRAINT semantic_type_key IF NOT EXISTS FOR (t:SemanticType) REQUIRE t.key IS UNIQUE");
  await write("CREATE FULLTEXT INDEX text_chunk_fulltext IF NOT EXISTS FOR (n:TextChunk) ON EACH [n.text]");
  await write("CREATE FULLTEXT INDEX knowledge_item_fulltext IF NOT EXISTS FOR (n:KnowledgeItem) ON EACH [n.title, n.summary, n.content]");
  await write("CREATE CONSTRAINT workspace_id IF NOT EXISTS FOR (w:Workspace) REQUIRE w.id IS UNIQUE");
  await write("CREATE INDEX workspace_owner IF NOT EXISTS FOR (w:Workspace) ON (w.ownerId)");
  await write("CREATE CONSTRAINT note_id IF NOT EXISTS FOR (n:Note) REQUIRE n.id IS UNIQUE");
  await write("CREATE INDEX note_owner IF NOT EXISTS FOR (n:Note) ON (n.ownerId)");
  await write("CREATE INDEX note_workspace IF NOT EXISTS FOR (n:Note) ON (n.workspaceId)");
  await write("CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.id IS UNIQUE");
  await write("CREATE INDEX chunk_workspace IF NOT EXISTS FOR (c:Chunk) ON (c.workspaceId)");
  await write("CREATE FULLTEXT INDEX note_fulltext IF NOT EXISTS FOR (n:Note) ON EACH [n.title, n.abstract, n.content]");
  await write("CREATE CONSTRAINT conversation_id IF NOT EXISTS FOR (c:Conversation) REQUIRE c.id IS UNIQUE");
  await write("CREATE INDEX conversation_owner IF NOT EXISTS FOR (c:Conversation) ON (c.ownerId)");
  await write("CREATE CONSTRAINT message_id IF NOT EXISTS FOR (m:Message) REQUIRE m.id IS UNIQUE");
  await write("CREATE INDEX message_conversation IF NOT EXISTS FOR (m:Message) ON (m.conversationId)");
  await write("CREATE CONSTRAINT axiom_id IF NOT EXISTS FOR (a:Axiom) REQUIRE a.id IS UNIQUE");
  await write("CREATE INDEX axiom_status IF NOT EXISTS FOR (a:Axiom) ON (a.status)");
  await write("CREATE CONSTRAINT observation_id IF NOT EXISTS FOR (o:Observation) REQUIRE o.id IS UNIQUE");
  await write("CREATE CONSTRAINT notification_id IF NOT EXISTS FOR (n:Notification) REQUIRE n.id IS UNIQUE");
  await write("CREATE INDEX notification_recipient IF NOT EXISTS FOR (n:Notification) ON (n.recipientId)");
  await write("CREATE CONSTRAINT audit_event_id IF NOT EXISTS FOR (e:AuditEvent) REQUIRE e.id IS UNIQUE");
  await write("CREATE INDEX audit_event_entity IF NOT EXISTS FOR (e:AuditEvent) ON (e.entityId)");
  await ensureAdminUser();
  await write("MATCH (u:User) WHERE u.emailVerified IS NULL SET u.emailVerified = true");
  await write(
    `
    MATCH (j:IngestJob {status: "failed"})
    WHERE j.errorCode IN ["", "ingest_failed"]
      AND (
        j.error CONTAINS "Expected ',' or ']' after array element"
        OR j.error CONTAINS "Unexpected token"
        OR j.error CONTAINS "JSON Parse error"
      )
    SET j.errorCode = "invalid_model_output",
        j.errorTitle = "模型返回格式不符合抽取协议",
        j.errorSuggestion = "系统没有写入异常数据。请直接重试；若持续失败，请缩小单次摄取内容或改用支持结构化输出的模型。"
    `
  );
  await ensureSemanticModel();
  await ensureDefaultWorkspace(process.env.ADMIN_USER_ID || "admin");
  await ensureTokenAccount(process.env.ADMIN_USER_ID || "admin");
  const legacyUsers = await read(
    `
    MATCH (u:User)
    WHERE u.openAiKeyCipher IS NOT NULL
      AND NOT EXISTS { MATCH (u)-[:OWNS_MODEL_PROFILE]->(:ModelProfile) }
    RETURN u.id AS userId, u.openAiKeyCipher AS cipher
    `
  );
  for (const record of legacyUsers) {
    const userId = record.get("userId");
    const timestamp = now();
    await write(
      `
      MATCH (u:User {id: $userId})
      CREATE (u)-[:OWNS_MODEL_PROFILE]->(p:ModelProfile {
        id: $id,
        ownerId: $userId,
        label: "OpenAI",
        protocol: "openai-compatible",
        baseUrl: "https://api.openai.com",
        model: "gpt-5",
        apiKeyCipher: $cipher,
        isDefault: true,
        createdAt: $timestamp,
        updatedAt: $timestamp
      })
      `,
      { userId, id: crypto.randomUUID(), cipher: record.get("cipher"), timestamp }
    );
  }
}

app.get("/health", asyncRoute(async (_req, res) => {
  await driver.verifyConnectivity();
  const ledger = await checkTokenLedger();
  res.json({ ok: true, databases: { neo4j: "ok", ...ledger } });
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const input = z.object({
    email: z.string().trim().email().transform((email) => email.toLowerCase()),
    password: z.string().min(1)
  }).parse(req.body);
  const userNode = await getUserByEmail(input.email);
  if (!userNode || !verifyPassword(input.password, userNode.properties.passwordHash)) {
    return res.status(401).json({ error: "邮箱或密码错误" });
  }
  if (userNode.properties.emailVerified === false) {
    return res.status(403).json({
      error: "请先验证邮箱后再登录",
      code: "email_not_verified",
      email: input.email
    });
  }
  const user = userFromNode(userNode);
  res.json({ token: createSessionToken(user), user });
}));

app.post("/api/auth/register", asyncRoute(async (req, res) => {
  const input = z.object({
    email: z.string().trim().email().transform((email) => email.toLowerCase()),
    password: z.string().min(10).max(200),
    displayName: z.string().trim().min(1).max(80).optional().or(z.literal("")),
    avatarUrl: z.string().trim().url().max(1000).optional().or(z.literal(""))
  }).parse(req.body);
  const timestamp = now();
  const verificationToken = crypto.randomBytes(32).toString("base64url");
  const verificationTokenHash = crypto.createHash("sha256").update(verificationToken).digest("hex");
  const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const records = await write(
    `
    CREATE (u:User {
      id: $id,
      email: $email,
      displayName: $displayName,
      avatarUrl: $avatarUrl,
      passwordHash: $passwordHash,
      role: "member",
      emailVerified: false,
      verificationTokenHash: $verificationTokenHash,
      verificationExpiresAt: $verificationExpiresAt,
      createdVia: "registration",
      createdAt: $timestamp,
      updatedAt: $timestamp
    })
    RETURN u
    `,
    {
      id: crypto.randomUUID(),
      email: input.email,
      displayName: input.displayName || input.email.split("@")[0],
      avatarUrl: input.avatarUrl || "",
      passwordHash: hashPassword(input.password),
      verificationTokenHash,
      verificationExpiresAt,
      timestamp
    }
  );
  const user = userFromNode(records[0].get("u"));
  try {
    await sendVerificationEmail({
      email: user.email,
      displayName: user.displayName,
      token: verificationToken
    });
  } catch (error) {
    await write("MATCH (u:User {id: $id}) DETACH DELETE u", { id: user.id });
    throw error;
  }
  await ensureDefaultWorkspace(user.id);
  await ensureTokenAccount(user.id);
  res.status(201).json({
    verificationRequired: true,
    email: user.email,
    message: "验证邮件已发送，请在 24 小时内完成验证"
  });
}));

app.post("/api/auth/verify-email", asyncRoute(async (req, res) => {
  const input = z.object({ token: z.string().min(20).max(500) }).parse(req.body);
  const tokenHash = crypto.createHash("sha256").update(input.token).digest("hex");
  const records = await write(
    `
    MATCH (u:User {verificationTokenHash: $tokenHash})
    WHERE u.emailVerified = false AND u.verificationExpiresAt > $timestamp
    SET u.emailVerified = true,
        u.updatedAt = $timestamp
    REMOVE u.verificationTokenHash, u.verificationExpiresAt
    RETURN u
    `,
    { tokenHash, timestamp: now() }
  );
  if (!records.length) return res.status(400).json({ error: "验证链接无效或已过期" });
  const user = userFromNode(records[0].get("u"));
  res.json({ token: createSessionToken(user), user });
}));

app.post("/api/auth/resend-verification", asyncRoute(async (req, res) => {
  const input = z.object({
    email: z.string().trim().email().transform((email) => email.toLowerCase())
  }).parse(req.body);
  const userNode = await getUserByEmail(input.email);
  if (userNode?.properties.emailVerified === false) {
    const verificationToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(verificationToken).digest("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await write(
      `
      MATCH (u:User {id: $id})
      SET u.verificationTokenHash = $tokenHash,
          u.verificationExpiresAt = $expiresAt,
          u.updatedAt = $timestamp
      `,
      { id: userNode.properties.id, tokenHash, expiresAt, timestamp: now() }
    );
    await sendVerificationEmail({
      email: userNode.properties.email,
      displayName: userNode.properties.displayName,
      token: verificationToken
    });
  }
  res.json({ message: "如果该邮箱存在未验证账户，新的验证邮件已发送" });
}));

app.get("/api/auth/me", requireAuth, asyncRoute(async (req, res) => {
  res.json({ user: req.user });
}));

app.post("/api/auth/token", requireAuth, asyncRoute(async (req, res) => {
  const input = z.object({
    apiKey: z.string().trim().min(20)
  }).parse(req.body);
  await write(
    `
    MATCH (u:User {id: $userId})
    SET u.openAiKeyCipher = $cipher,
        u.updatedAt = $timestamp
    `,
    { userId: req.user.id, cipher: encryptSecret(input.apiKey), timestamp: now() }
  );
  res.json({ ok: true });
}));

app.delete("/api/auth/token", requireAuth, asyncRoute(async (req, res) => {
  await write("MATCH (u:User {id: $userId}) REMOVE u.openAiKeyCipher SET u.updatedAt = $timestamp", {
    userId: req.user.id,
    timestamp: now()
  });
  res.json({ ok: true });
}));

app.get("/api/auth/users", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const systemAdminId = process.env.ADMIN_USER_ID || "admin";
  const records = await read(
    `
    MATCH (u:User)
    OPTIONAL MATCH (item:KnowledgeItem)
    WHERE item.ownerId = u.id
    RETURN u, count(DISTINCT item) AS knowledgeItemCount
    ORDER BY u.role ASC, toLower(coalesce(u.displayName, u.email)) ASC
    `
  );
  res.json({
    users: records.map((record) => ({
      ...userFromNode(record.get("u")),
      knowledgeItemCount: toNativeNumber(record.get("knowledgeItemCount")),
      canDelete: record.get("u").properties.id !== req.user.id
        && record.get("u").properties.id !== systemAdminId
    }))
  });
}));

app.post("/api/auth/users", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const input = z.object({
    email: z.string().trim().email().transform((email) => email.toLowerCase()),
    password: z.string().min(10).max(200),
    displayName: z.string().trim().min(1).max(80).optional().or(z.literal("")),
    avatarUrl: z.string().trim().url().max(1000).optional().or(z.literal("")),
    role: z.enum(["admin", "member"]).optional().default("member")
  }).parse(req.body);
  const timestamp = now();
  const records = await write(
    `
    CREATE (u:User {
      id: $id,
      email: $email,
      displayName: $displayName,
      avatarUrl: $avatarUrl,
      passwordHash: $passwordHash,
      role: $role,
      emailVerified: true,
      createdVia: "admin",
      createdById: $createdById,
      createdAt: $timestamp,
      updatedAt: $timestamp
    })
    RETURN u
    `,
    {
      ...input,
      id: crypto.randomUUID(),
      displayName: input.displayName || input.email.split("@")[0],
      avatarUrl: input.avatarUrl || "",
      passwordHash: hashPassword(input.password),
      createdById: req.user.id,
      timestamp
    }
  );
  const user = userFromNode(records[0].get("u"));
  await ensureDefaultWorkspace(user.id);
  await ensureTokenAccount(user.id);
  res.status(201).json({ user });
}));

app.delete("/api/auth/users/:id", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const targetId = z.string().min(1).max(200).parse(req.params.id);
  const systemAdminId = process.env.ADMIN_USER_ID || "admin";
  if (targetId === req.user.id) return res.status(400).json({ error: "不能删除当前登录账户" });
  if (targetId === systemAdminId) return res.status(400).json({ error: "不能删除系统初始管理员" });

  const targetRecords = await read("MATCH (u:User {id: $targetId}) RETURN u", { targetId });
  if (!targetRecords.length) return res.status(404).json({ error: "用户不存在" });

  const timestamp = now();
  await write(
    `
    MATCH (c:Conversation {ownerId: $targetId})
    OPTIONAL MATCH (c)-[:HAS_MESSAGE]->(m:Message)
    DETACH DELETE m, c
    `,
    { targetId }
  );
  await write(
    `
    MATCH (n)
    WHERE n.ownerId = $targetId OR n.recipientId = $targetId
    DETACH DELETE n
    `,
    { targetId }
  );
  await write(
    `
    MATCH (n)
    WHERE n.authorId = $targetId
    SET n.authorId = "",
        n.authorName = "已删除用户",
        n.updatedAt = $timestamp
    `,
    { targetId, timestamp }
  );
  await write("MATCH (u:User {id: $targetId}) DETACH DELETE u", { targetId });
  res.json({ ok: true, retainedTokenAudit: true });
}));

app.patch("/api/auth/profile", requireAuth, asyncRoute(async (req, res) => {
  const input = z.object({
    displayName: z.string().trim().min(1).max(80),
    avatarUrl: z.string().trim().url().max(1000).optional().or(z.literal(""))
  }).parse(req.body);
  const records = await write(
    `
    MATCH (u:User {id: $userId})
    SET u.displayName = $displayName,
        u.avatarUrl = $avatarUrl,
        u.updatedAt = $timestamp
    RETURN u
    `,
    { userId: req.user.id, displayName: input.displayName, avatarUrl: input.avatarUrl || "", timestamp: now() }
  );
  const user = userFromNode(records[0].get("u"));
  res.json({ token: createSessionToken(user), user });
}));

app.post("/api/auth/password", requireAuth, asyncRoute(async (req, res) => {
  const input = z.object({
    currentPassword: z.string().min(1),
    nextPassword: z.string().min(10).max(200)
  }).parse(req.body);
  const userNode = await getUserByEmail(req.user.email);
  if (!verifyPassword(input.currentPassword, userNode.properties.passwordHash)) {
    return res.status(400).json({ error: "当前密码错误" });
  }
  await write(
    "MATCH (u:User {id: $userId}) SET u.passwordHash = $passwordHash, u.updatedAt = $timestamp",
    { userId: req.user.id, passwordHash: hashPassword(input.nextPassword), timestamp: now() }
  );
  res.json({ ok: true });
}));

app.use("/api", requireAuth);

const workspaceInput = z.object({
  name: z.string().trim().min(1).max(100),
  visibility: z.enum(["private", "public"]).optional().default("private")
});
const noteInput = z.object({
  workspaceId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  content: z.string().max(1000000).optional().default(""),
  abstract: z.string().trim().max(4000).optional().default("")
});
const noteUpdateInput = noteInput.partial().omit({ workspaceId: true });

app.get("/api/workspaces", asyncRoute(async (req, res) => {
  res.json({ workspaces: await listWorkspaces(req.user.id) });
}));

app.post("/api/workspaces", asyncRoute(async (req, res) => {
  const workspace = await createWorkspace(req.user.id, workspaceInput.parse(req.body));
  res.status(201).json({ workspace });
}));

app.get("/api/notes", asyncRoute(async (req, res) => {
  const workspaceId = z.string().uuid().parse(req.query.workspaceId);
  const query = z.string().trim().max(200).optional().default("").parse(req.query.q);
  res.json({ notes: await listNotes(req.user.id, workspaceId, query) });
}));

app.get("/api/notes/:id", asyncRoute(async (req, res) => {
  const note = await getNote(req.user.id, req.params.id);
  if (!note) return res.status(404).json({ error: "笔记不存在" });
  res.json({ note });
}));

app.post("/api/notes", asyncRoute(async (req, res) => {
  const result = await saveNote(req.user.id, noteInput.parse(req.body));
  if (!result) return res.status(404).json({ error: "知识空间不存在" });
  res.status(201).json(result);
}));

app.patch("/api/notes/:id", asyncRoute(async (req, res) => {
  const input = noteUpdateInput.parse(req.body);
  const existing = await getNote(req.user.id, req.params.id);
  if (!existing) return res.status(404).json({ error: "笔记不存在" });
  const result = await saveNote(req.user.id, {
    id: req.params.id,
    workspaceId: existing.workspaceId,
    title: input.title ?? existing.title,
    content: input.content ?? existing.content,
    abstract: input.abstract ?? existing.abstract
  });
  res.json(result);
}));

app.delete("/api/notes/:id", asyncRoute(async (req, res) => {
  const deleted = await deleteNote(req.user.id, req.params.id);
  if (!deleted) return res.status(404).json({ error: "笔记不存在" });
  res.json({ deleted });
}));

app.get("/api/token/account", asyncRoute(async (req, res) => {
  res.json({ account: await getTokenAccount(req.user.id) });
}));

app.get("/api/token/usage", asyncRoute(async (req, res) => {
  const limit = z.coerce.number().int().min(1).max(500).optional().default(100).parse(req.query.limit);
  res.json({ events: await listTokenUsage(req.user.id, limit) });
}));

app.get("/api/conversations", asyncRoute(async (req, res) => {
  const records = await read(
    `
    MATCH (c:Conversation {ownerId: $ownerId})
    OPTIONAL MATCH (c)-[:HAS_MESSAGE]->(m:Message)
    RETURN c, count(m) AS messageCount
    ORDER BY c.updatedAt DESC
    LIMIT 100
    `,
    { ownerId: req.user.id }
  );
  res.json({
    conversations: records.map((record) => {
      const props = record.get("c").properties;
      return {
        id: props.id,
        title: props.title,
        messageCount: toNativeNumber(record.get("messageCount")),
        createdAt: props.createdAt,
        updatedAt: props.updatedAt
      };
    })
  });
}));

app.get("/api/conversations/:id", asyncRoute(async (req, res) => {
  const records = await read(
    `
    MATCH (c:Conversation {id: $id, ownerId: $ownerId})
    OPTIONAL MATCH (c)-[:HAS_MESSAGE]->(m:Message)
    RETURN c, collect(m) AS messages
    `,
    { id: req.params.id, ownerId: req.user.id }
  );
  if (!records.length) return res.status(404).json({ error: "对话不存在" });
  const conversation = records[0].get("c").properties;
  const messages = records[0].get("messages")
    .filter(Boolean)
    .map((node) => {
      const props = node.properties;
      return {
        id: props.id,
        role: props.role,
        content: props.content,
        sources: JSON.parse(props.sourcesJson || "[]"),
        modelProfileId: props.modelProfileId || "",
        webSearch: Boolean(props.webSearch),
        searchQueries: JSON.parse(props.searchQueriesJson || "[]"),
        agentTrace: JSON.parse(props.agentTraceJson || "null"),
        createdAt: props.createdAt
      };
    })
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  res.json({
    conversation: {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages
    }
  });
}));

app.get("/api/semantic-model", asyncRoute(async (_req, res) => {
  res.json({ types: await listSemanticTypes() });
}));

const modelProfileInput = z.object({
  label: z.string().trim().min(1).max(80),
  protocol: z.enum(["openai-compatible", "anthropic", "google"]),
  baseUrl: z.string().trim().url().max(500).refine((value) => value.startsWith("https://"), "Base URL must use HTTPS"),
  model: z.string().trim().min(1).max(120),
  embeddingModel: z.string().trim().max(160).optional().default(""),
  rerankModel: z.string().trim().max(160).optional().default(""),
  contextWindow: z.number().int().min(4096).max(2000000).optional().default(32000),
  promptBudgetTokens: z.number().int().min(4096).max(1000000).optional().default(24000),
  maxOutputTokens: z.number().int().min(128).max(128000).optional().default(3000),
  safetyTokens: z.number().int().min(2048).max(100000).optional().default(3000),
  autoConfigure: z.boolean().optional().default(true),
  apiMode: z.enum(["chat", "responses"]).optional().default("chat"),
  chatThinking: z.boolean().optional().default(false),
  reasoningEffort: z.enum(["none", "low", "medium", "high", "xhigh", "max"]).optional().default("medium"),
  reasoningMode: z.enum(["standard", "pro"]).optional().default("standard"),
  textVerbosity: z.enum(["low", "medium", "high"]).optional().default("medium"),
  apiKey: z.string().trim().min(8).max(1000),
  isDefault: z.boolean().optional().default(false)
});

const modelProfileUpdate = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  protocol: z.enum(["openai-compatible", "anthropic", "google"]).optional(),
  baseUrl: z.string().trim().url().max(500).refine((value) => value.startsWith("https://"), "Base URL must use HTTPS").optional(),
  model: z.string().trim().min(1).max(120).optional(),
  embeddingModel: z.string().trim().max(160).optional(),
  rerankModel: z.string().trim().max(160).optional(),
  contextWindow: z.number().int().min(4096).max(2000000).optional(),
  promptBudgetTokens: z.number().int().min(4096).max(1000000).optional(),
  maxOutputTokens: z.number().int().min(128).max(128000).optional(),
  safetyTokens: z.number().int().min(2048).max(100000).optional(),
  autoConfigure: z.boolean().optional(),
  apiMode: z.enum(["chat", "responses"]).optional(),
  chatThinking: z.boolean().optional(),
  reasoningEffort: z.enum(["none", "low", "medium", "high", "xhigh", "max"]).optional(),
  reasoningMode: z.enum(["standard", "pro"]).optional(),
  textVerbosity: z.enum(["low", "medium", "high"]).optional(),
  apiKey: z.string().trim().min(8).max(1000).optional()
});

function modelProfileFromNode(node) {
  const props = node.properties;
  const configured = {
    id: props.id,
    label: props.label,
    protocol: props.protocol,
    baseUrl: props.baseUrl,
    model: props.model,
    embeddingModel: props.embeddingModel || "",
    rerankModel: props.rerankModel || "",
    contextWindow: toNativeNumber(props.contextWindow || 32000),
    promptBudgetTokens: toNativeNumber(props.promptBudgetTokens || 24000),
    maxOutputTokens: toNativeNumber(props.maxOutputTokens || 3000),
    safetyTokens: toNativeNumber(props.safetyTokens || 3000),
    autoConfigure: Boolean(props.autoConfigure),
    apiMode: props.apiMode || "chat",
    chatThinking: Boolean(props.chatThinking),
    reasoningEffort: props.reasoningEffort || "medium",
    reasoningMode: props.reasoningMode || "standard",
    textVerbosity: props.textVerbosity || "medium",
    isDefault: Boolean(props.isDefault),
    hasApiKey: Boolean(props.apiKeyCipher),
    createdAt: props.createdAt,
    updatedAt: props.updatedAt
  };
  const effective = resolveRuntimeModelProfile(configured);
  return {
    ...configured,
    ...effective,
    capabilities: resolveModelCapabilities(configured)
  };
}

async function meteredComplete({
  ownerId,
  workspaceId = null,
  profile,
  profileNode,
  operation,
  system,
  user
}) {
  const metered = await runMeteredModelCall({
    userId: ownerId,
    workspaceId,
    operation,
    model: profile.model,
    input: `${system}\n\n${user}`,
    maxOutputTokens: profile.maxOutputTokens,
    execute: (onUsage) => completeWithProfile({
      profile,
      apiKey: decryptSecret(profileNode.properties.apiKeyCipher),
      system,
      user,
      maxOutputTokens: profile.maxOutputTokens,
      providerUserId: ownerId,
      thinking: operation.endsWith("chat") && profile.chatThinking,
      onUsage
    })
  });
  return metered;
}

async function meteredEmbedding({ ownerId, workspaceId = null, profile, profileNode, texts }) {
  return runMeteredModelCall({
    userId: ownerId,
    workspaceId,
    operation: "embedding",
    model: profile.embeddingModel,
    input: texts.join("\n"),
    execute: (onUsage) => embedWithProfile({
      profile,
      apiKey: decryptSecret(profileNode.properties.apiKeyCipher),
      texts,
      onUsage
    })
  });
}

async function meteredExtraction({ ownerId, workspaceId = null, profile, profileNode, text, source, images = [] }) {
  const semanticContext = await semanticContextText();
  const imageReservation = images.map((image) => `[image:${image.data?.length || 0} bytes]`).join("");
  return runMeteredModelCall({
    userId: ownerId,
    workspaceId,
    operation: "entity_extraction",
    model: profile.model,
    input: `${source}\n${semanticContext}\n${text}\n${imageReservation}`,
    maxOutputTokens: Math.min(profile.maxOutputTokens, profile.apiMode === "responses" ? 8192 : 4096),
    execute: (onUsage) => extractWithProfile({
      profile,
      apiKey: decryptSecret(profileNode.properties.apiKeyCipher),
      text,
      source,
      images,
      semanticContext,
      providerUserId: ownerId,
      onUsage
    })
  });
}

app.get("/api/model-profiles", asyncRoute(async (req, res) => {
  const records = await read(
    `
    MATCH (p:ModelProfile {ownerId: $ownerId})
    RETURN p
    ORDER BY p.isDefault DESC, p.updatedAt DESC
    `,
    { ownerId: req.user.id }
  );
  res.json({ profiles: records.map((record) => modelProfileFromNode(record.get("p"))) });
}));

app.get("/api/documents", asyncRoute(async (req, res) => {
  const records = await read(
    `
    MATCH (d:SourceDocument {ownerId: $ownerId})
    OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:TextChunk)
    RETURN d, count(c) AS chunkCount
    ORDER BY d.createdAt DESC
    LIMIT 100
    `,
    { ownerId: req.user.id }
  );
  res.json({
    documents: records.map((record) => {
      const props = record.get("d").properties;
      return {
        id: props.id,
        title: props.title,
        sourceType: props.sourceType,
        contentHash: props.contentHash,
        modelProfileId: props.modelProfileId || "",
        model: props.model || "",
        chunkCount: record.get("chunkCount").toNumber(),
        createdAt: props.createdAt
      };
    })
  });
}));

app.get("/api/documents/:id", asyncRoute(async (req, res) => {
  const records = await read(
    `
    MATCH (d:SourceDocument {id: $id, ownerId: $ownerId})
    OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:TextChunk)
    OPTIONAL MATCH (d)-[:HAS_ASSET]->(a:SourceAsset)
    RETURN d,
           collect(DISTINCT c { .id, .index, .start, .end, .text }) AS chunks,
           collect(DISTINCT a { .id, .name, .mimeType, .size }) AS assets
    `,
    { id: req.params.id, ownerId: req.user.id }
  );
  if (!records.length) return res.status(404).json({ error: "资料不存在" });
  const props = records[0].get("d").properties;
  res.json({
    document: {
      id: props.id,
      title: props.title,
      content: props.content,
      sourceType: props.sourceType,
      model: props.model || "",
      createdAt: props.createdAt,
      assets: records[0].get("assets").filter((asset) => asset.id),
      chunks: records[0].get("chunks")
        .filter((chunk) => chunk.id)
        .map((chunk) => ({
          ...chunk,
          index: toNativeNumber(chunk.index),
          start: toNativeNumber(chunk.start),
          end: toNativeNumber(chunk.end)
        }))
        .sort((a, b) => a.index - b.index)
    }
  });
}));

app.get("/api/assets/:id", asyncRoute(async (req, res) => {
  const records = await read(
    "MATCH (a:SourceAsset {id: $id, ownerId: $ownerId}) RETURN a",
    { id: req.params.id, ownerId: req.user.id }
  );
  if (!records.length) return res.status(404).json({ error: "原始文件不存在" });
  const asset = records[0].get("a").properties;
  const filePath = path.resolve(asset.storagePath);
  if (!filePath.startsWith(`${uploadRoot}${path.sep}`)) return res.status(403).json({ error: "文件路径无效" });
  res.type(asset.mimeType || "application/octet-stream");
  res.setHeader("Content-Disposition", `${String(asset.mimeType || "").startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(asset.name)}`);
  res.sendFile(filePath);
}));

function axiomFromNode(node, extras = {}) {
  const props = node.properties;
  return {
    id: props.id,
    title: props.title,
    statement: props.statement,
    status: props.status,
    authorId: props.authorId,
    authorName: props.authorName,
    sourceItemId: props.sourceItemId,
    sourceTitle: props.sourceTitle,
    sourceSummary: props.sourceSummary,
    evidenceSnapshot: props.evidenceSnapshot || "",
    factCount: toNativeNumber(props.factCount || 0),
    version: toNativeNumber(props.version || 1),
    previousAxiomId: props.previousAxiomId || "",
    supersededById: props.supersededById || "",
    supportCount: toNativeNumber(props.supportCount || 0),
    opposeCount: toNativeNumber(props.opposeCount || 0),
    createdAt: props.createdAt,
    updatedAt: props.updatedAt,
    ...extras
  };
}

async function createAuditEvent({ actor, action, entityType, entityId, metadata = {} }) {
  await write(
    `
    CREATE (:AuditEvent {
      id: $id,
      actorId: $actorId,
      actorName: $actorName,
      action: $action,
      entityType: $entityType,
      entityId: $entityId,
      metadataJson: $metadataJson,
      createdAt: $timestamp
    })
    `,
    {
      id: crypto.randomUUID(),
      actorId: actor.id,
      actorName: actor.displayName || actor.email,
      action,
      entityType,
      entityId,
      metadataJson: JSON.stringify(metadata),
      timestamp: now()
    }
  );
}

async function createNotification({ recipientId, actorId, type, title, body, entityId }) {
  if (!recipientId || recipientId === actorId) return;
  await write(
    `
    CREATE (:Notification {
      id: $id,
      recipientId: $recipientId,
      actorId: $actorId,
      type: $type,
      title: $title,
      body: $body,
      entityId: $entityId,
      read: false,
      createdAt: $timestamp
    })
    `,
    { id: crypto.randomUUID(), recipientId, actorId, type, title, body, entityId, timestamp: now() }
  );
}

function factFromNode(node, extras = {}) {
  const props = node.properties;
  return {
    id: props.id,
    statement: props.statement,
    quote: props.quote || "",
    confidence: Number(props.confidence || 0),
    status: props.status || "candidate",
    ownerId: props.ownerId,
    documentId: props.documentId,
    documentTitle: props.documentTitle || "",
    chunkId: props.chunkId || "",
    chunkIndex: toNativeNumber(props.chunkIndex || 0),
    modelProfileId: props.modelProfileId || "",
    model: props.model || "",
    createdAt: props.createdAt,
    updatedAt: props.updatedAt,
    ...extras
  };
}

function publicFactFromNode(node) {
  const props = node.properties;
  return {
    id: props.id,
    title: props.title || props.statement,
    statement: props.statement,
    evidence: props.evidence || "",
    confidence: Number(props.confidence || 0),
    status: props.status || "published",
    sourceTitle: props.sourceTitle || "",
    authorId: props.authorId || "",
    authorName: props.authorName || "",
    createdAt: props.createdAt,
    updatedAt: props.updatedAt
  };
}

function hypothesisFromNode(node, extras = {}) {
  const props = node.properties;
  return {
    id: props.id,
    title: props.title,
    claim: props.claim,
    rationale: props.rationale || "",
    alternativeExplanation: props.alternativeExplanation || "",
    falsificationCriteria: props.falsificationCriteria || "",
    confidence: Number(props.confidence || 0),
    status: props.status || "proposed",
    authorId: props.authorId || "",
    authorName: props.authorName || "",
    model: props.model || "",
    createdAt: props.createdAt,
    updatedAt: props.updatedAt,
    ...extras
  };
}

app.get("/api/facts", asyncRoute(async (req, res) => {
  const query = String(req.query.q || "").trim().toLowerCase();
  const status = String(req.query.status || "").trim();
  const records = await read(
    `
    MATCH (f:Fact {ownerId: $ownerId})
    WHERE ($status = "" OR f.status = $status)
      AND ($query = "" OR toLower(f.statement) CONTAINS $query OR toLower(f.quote) CONTAINS $query)
    OPTIONAL MATCH (f)-[:ABOUT]->(n:KnowledgeItem {ownerId: $ownerId})
    RETURN f, collect(DISTINCT n { .id, .title, .kind }) AS entities
    ORDER BY f.updatedAt DESC
    LIMIT 300
    `,
    { ownerId: req.user.id, query, status }
  );
  res.json({
    facts: records.map((record) => factFromNode(record.get("f"), {
      entities: record.get("entities").filter((entity) => entity.id)
    }))
  });
}));

app.get("/api/facts/:id", asyncRoute(async (req, res) => {
  const records = await read(
    `
    MATCH (f:Fact {id: $id, ownerId: $ownerId})
    OPTIONAL MATCH (f)-[:FROM_CHUNK]->(c:TextChunk)<-[:HAS_CHUNK]-(d:SourceDocument)
    OPTIONAL MATCH (f)-[:ABOUT]->(n:KnowledgeItem {ownerId: $ownerId})
    OPTIONAL MATCH (a:Axiom)-[:SUPPORTED_BY]->(f)
    RETURN f, c, d, collect(DISTINCT n { .id, .title, .kind }) AS entities,
           collect(DISTINCT a { .id, .title, .status }) AS axioms
    `,
    { id: req.params.id, ownerId: req.user.id }
  );
  if (!records.length) return res.status(404).json({ error: "事实不存在" });
  const record = records[0];
  const chunk = record.get("c")?.properties;
  const document = record.get("d")?.properties;
  res.json({
    fact: factFromNode(record.get("f"), {
      entities: record.get("entities").filter((entity) => entity.id),
      axioms: record.get("axioms").filter((axiom) => axiom.id),
      source: document ? {
        id: document.id,
        title: document.title,
        sourceType: document.sourceType,
        createdAt: document.createdAt,
        chunkText: chunk?.text || ""
      } : null
    })
  });
}));

app.patch("/api/facts/:id", asyncRoute(async (req, res) => {
  const input = z.object({
    status: z.enum(["candidate", "verified", "disputed", "rejected", "superseded"])
  }).parse(req.body);
  const records = await write(
    `
    MATCH (f:Fact {id: $id, ownerId: $ownerId})
    SET f.status = $status, f.updatedAt = $timestamp
    RETURN f
    `,
    { id: req.params.id, ownerId: req.user.id, status: input.status, timestamp: now() }
  );
  if (!records.length) return res.status(404).json({ error: "事实不存在" });
  await createAuditEvent({
    actor: req.user,
    action: "fact.status_changed",
    entityType: "Fact",
    entityId: req.params.id,
    metadata: { status: input.status }
  });
  res.json({ fact: factFromNode(records[0].get("f")) });
}));

const hypothesisStatus = z.enum(["proposed", "testing", "supported", "challenged", "rejected", "promoted"]);

app.get("/api/hypotheses", asyncRoute(async (req, res) => {
  const query = String(req.query.q || "").trim().toLowerCase();
  const status = String(req.query.status || "").trim();
  const records = await read(
    `
    MATCH (h:Hypothesis)
    WHERE ($status = "" OR h.status = $status)
      AND ($query = "" OR toLower(h.title) CONTAINS $query OR toLower(h.claim) CONTAINS $query)
    OPTIONAL MATCH (h)-[:BASED_ON]->(premise:PublicFact)
    OPTIONAL MATCH (h)-[:CHALLENGED_BY]->(challenge:PublicFact)
    OPTIONAL MATCH (h)-[:PROMOTED_TO]->(a:Axiom)
    RETURN h, count(DISTINCT premise) AS premiseCount,
           count(DISTINCT challenge) AS challengeCount,
           head(collect(DISTINCT a.id)) AS promotedAxiomId
    ORDER BY h.updatedAt DESC
    LIMIT 200
    `,
    { query, status }
  );
  res.json({
    hypotheses: records.map((record) => hypothesisFromNode(record.get("h"), {
      premiseCount: toNativeNumber(record.get("premiseCount")),
      challengeCount: toNativeNumber(record.get("challengeCount")),
      promotedAxiomId: record.get("promotedAxiomId") || ""
    }))
  });
}));

app.get("/api/hypotheses/:id", asyncRoute(async (req, res) => {
  const records = await read(
    `
    MATCH (h:Hypothesis {id: $id})
    OPTIONAL MATCH (h)-[:BASED_ON]->(premise:PublicFact)
    OPTIONAL MATCH (h)-[:CHALLENGED_BY]->(challenge:PublicFact)
    OPTIONAL MATCH (h)-[:PROMOTED_TO]->(axiom:Axiom)
    RETURN h,
           collect(DISTINCT premise) AS premises,
           collect(DISTINCT challenge) AS challenges,
           head(collect(DISTINCT axiom)) AS axiom
    `,
    { id: req.params.id }
  );
  if (!records.length) return res.status(404).json({ error: "假设不存在" });
  const record = records[0];
  res.json({
    hypothesis: hypothesisFromNode(record.get("h")),
    premises: record.get("premises").filter(Boolean).map(publicFactFromNode),
    challenges: record.get("challenges").filter(Boolean).map(publicFactFromNode),
    axiom: record.get("axiom") ? axiomFromNode(record.get("axiom")) : null
  });
}));

app.post("/api/hypotheses", asyncRoute(async (req, res) => {
  const input = z.object({
    title: z.string().trim().min(1).max(160),
    claim: z.string().trim().min(10).max(5000),
    rationale: z.string().trim().min(10).max(3000),
    alternativeExplanation: z.string().trim().max(2000).optional().default(""),
    falsificationCriteria: z.string().trim().min(5).max(2000),
    confidence: z.number().min(0).max(1),
    publicFactIds: z.array(z.string().uuid()).min(1).max(20),
    challengeFactIds: z.array(z.string().uuid()).max(20).optional().default([]),
    model: z.string().trim().max(160).optional().default("")
  }).parse(req.body);
  const factRecords = await read(
    "MATCH (f:PublicFact) WHERE f.id IN $ids RETURN f.id AS id",
    { ids: [...new Set([...input.publicFactIds, ...input.challengeFactIds])] }
  );
  const foundIds = new Set(factRecords.map((record) => record.get("id")));
  const missing = [...new Set([...input.publicFactIds, ...input.challengeFactIds])]
    .filter((id) => !foundIds.has(id));
  if (missing.length) return res.status(404).json({ error: "部分公共事实不存在", missing });
  const id = crypto.randomUUID();
  const timestamp = now();
  const records = await write(
    `
    CREATE (h:Hypothesis {
      id: $id,
      title: $title,
      claim: $claim,
      rationale: $rationale,
      alternativeExplanation: $alternativeExplanation,
      falsificationCriteria: $falsificationCriteria,
      confidence: $confidence,
      status: "proposed",
      authorId: $authorId,
      authorName: $authorName,
      model: $model,
      createdAt: $timestamp,
      updatedAt: $timestamp
    })
    WITH h
    MATCH (premise:PublicFact) WHERE premise.id IN $publicFactIds
    MERGE (h)-[r:BASED_ON]->(premise)
    ON CREATE SET r.id = randomUUID(), r.createdAt = $timestamp
    WITH DISTINCT h
    OPTIONAL MATCH (challenge:PublicFact) WHERE challenge.id IN $challengeFactIds
    FOREACH (_ IN CASE WHEN challenge IS NULL THEN [] ELSE [1] END |
      MERGE (h)-[r:CHALLENGED_BY]->(challenge)
      ON CREATE SET r.id = randomUUID(), r.createdAt = $timestamp
    )
    RETURN h
    `,
    { ...input, id, authorId: req.user.id, authorName: req.user.displayName, timestamp }
  );
  await createAuditEvent({
    actor: req.user,
    action: "hypothesis.created",
    entityType: "Hypothesis",
    entityId: id,
    metadata: { premiseCount: input.publicFactIds.length, confidence: input.confidence }
  });
  res.status(201).json({ hypothesis: hypothesisFromNode(records[0].get("h")) });
}));

app.patch("/api/hypotheses/:id/status", asyncRoute(async (req, res) => {
  const input = z.object({ status: hypothesisStatus }).parse(req.body);
  const records = await write(
    `
    MATCH (h:Hypothesis {id: $id})
    WHERE h.authorId = $userId OR $isAdmin
    SET h.status = $status, h.updatedAt = $timestamp
    RETURN h
    `,
    {
      id: req.params.id,
      userId: req.user.id,
      isAdmin: req.user.role === "admin",
      status: input.status,
      timestamp: now()
    }
  );
  if (!records.length) return res.status(404).json({ error: "假设不存在或无权修改" });
  await createAuditEvent({
    actor: req.user,
    action: "hypothesis.status_changed",
    entityType: "Hypothesis",
    entityId: req.params.id,
    metadata: { status: input.status }
  });
  res.json({ hypothesis: hypothesisFromNode(records[0].get("h")) });
}));

app.post("/api/hypotheses/:id/promote", asyncRoute(async (req, res) => {
  const input = z.object({
    title: z.string().trim().min(1).max(160).optional(),
    statement: z.string().trim().min(10).max(5000).optional()
  }).parse(req.body);
  const id = crypto.randomUUID();
  const timestamp = now();
  const records = await write(
    `
    MATCH (h:Hypothesis {id: $hypothesisId})
    WHERE (h.authorId = $userId OR $isAdmin)
      AND h.status IN ["proposed", "testing", "supported", "challenged"]
      AND NOT (h)-[:PROMOTED_TO]->(:Axiom)
    MATCH (h)-[:BASED_ON]->(premise:PublicFact)
    WITH h, collect(DISTINCT premise) AS premises
    CREATE (a:Axiom {
      id: $id,
      title: coalesce($title, h.title),
      statement: coalesce($statement, h.claim),
      status: "pending",
      authorId: $userId,
      authorName: $authorName,
      sourceTitle: "由公共假设提升",
      sourceSummary: h.rationale,
      evidenceSnapshot: "",
      factCount: size(premises),
      hypothesisId: h.id,
      version: 1,
      previousAxiomId: "",
      supersededById: "",
      supportCount: 0,
      opposeCount: 0,
      createdAt: $timestamp,
      updatedAt: $timestamp
    })
    FOREACH (premise IN premises | MERGE (a)-[:SUPPORTED_BY]->(premise))
    MERGE (h)-[promotion:PROMOTED_TO]->(a)
    ON CREATE SET promotion.id = randomUUID(), promotion.createdAt = $timestamp
    SET h.status = "promoted", h.updatedAt = $timestamp
    RETURN h, a
    `,
    {
      hypothesisId: req.params.id,
      id,
      userId: req.user.id,
      isAdmin: req.user.role === "admin",
      authorName: req.user.displayName,
      title: input.title || null,
      statement: input.statement || null,
      timestamp
    }
  );
  if (!records.length) return res.status(409).json({ error: "假设不存在、已提升或无权操作" });
  await Promise.all([
    createAuditEvent({
      actor: req.user,
      action: "hypothesis.promoted",
      entityType: "Hypothesis",
      entityId: req.params.id,
      metadata: { axiomId: id }
    }),
    createAuditEvent({
      actor: req.user,
      action: "axiom.created_from_hypothesis",
      entityType: "Axiom",
      entityId: id,
      metadata: { hypothesisId: req.params.id }
    })
  ]);
  res.status(201).json({
    hypothesis: hypothesisFromNode(records[0].get("h")),
    axiom: axiomFromNode(records[0].get("a"))
  });
}));

app.get("/api/notifications", asyncRoute(async (req, res) => {
  const records = await read(
    `
    MATCH (n:Notification {recipientId: $recipientId})
    RETURN n
    ORDER BY n.createdAt DESC
    LIMIT 100
    `,
    { recipientId: req.user.id }
  );
  res.json({
    notifications: records.map((record) => {
      const props = record.get("n").properties;
      return {
        id: props.id,
        type: props.type,
        title: props.title,
        body: props.body,
        entityId: props.entityId,
        read: Boolean(props.read),
        createdAt: props.createdAt
      };
    })
  });
}));

app.post("/api/notifications/:id/read", asyncRoute(async (req, res) => {
  const records = await write(
    `
    MATCH (n:Notification {id: $id, recipientId: $recipientId})
    SET n.read = true, n.readAt = $timestamp
    RETURN n.id AS id
    `,
    { id: req.params.id, recipientId: req.user.id, timestamp: now() }
  );
  if (!records.length) return res.status(404).json({ error: "通知不存在" });
  res.json({ ok: true });
}));

app.get("/api/axioms", asyncRoute(async (req, res) => {
  const query = String(req.query.q || "").trim().toLowerCase();
  const status = String(req.query.status || "").trim();
  const records = await read(
    `
    MATCH (a:Axiom)
    WHERE ($status = "" OR a.status = $status)
      AND ($query = "" OR toLower(a.title) CONTAINS $query OR toLower(a.statement) CONTAINS $query)
    OPTIONAL MATCH (u:User {id: $userId})-[v:VOTED]->(a)
    OPTIONAL MATCH (o:Observation)-[:ABOUT_AXIOM]->(a)
    RETURN a, v.value AS myVote, count(DISTINCT o) AS observationCount
    ORDER BY a.updatedAt DESC
    LIMIT 200
    `,
    { query, status, userId: req.user.id }
  );
  res.json({
    axioms: records.map((record) => axiomFromNode(record.get("a"), {
      myVote: record.get("myVote") || "",
      observationCount: record.get("observationCount").toNumber()
    }))
  });
}));

app.get("/api/axioms/:id", asyncRoute(async (req, res) => {
  const records = await read(
    `
    MATCH (a:Axiom {id: $id})
    OPTIONAL MATCH (u:User {id: $userId})-[v:VOTED]->(a)
    RETURN a, v.value AS myVote
    `,
    { id: req.params.id, userId: req.user.id }
  );
  if (!records.length) return res.status(404).json({ error: "公理不存在" });
  const observationRecords = await read(
    `
    MATCH (o:Observation)-[:ABOUT_AXIOM]->(:Axiom {id: $id})
    RETURN o
    ORDER BY o.createdAt DESC
    LIMIT 100
    `,
    { id: req.params.id }
  );
  const factRecords = await read(
    `
    MATCH (a:Axiom {id: $id})-[:SUPPORTED_BY]->(f:PublicFact)
    RETURN f
    ORDER BY f.createdAt
    `,
    { id: req.params.id }
  );
  const auditRecords = await read(
    `
    MATCH (e:AuditEvent {entityType: "Axiom", entityId: $id})
    RETURN e
    ORDER BY e.createdAt DESC
    LIMIT 100
    `,
    { id: req.params.id }
  );
  res.json({
    axiom: axiomFromNode(records[0].get("a"), { myVote: records[0].get("myVote") || "" }),
    facts: factRecords.map((record) => {
      const fact = publicFactFromNode(record.get("f"));
      return {
        id: fact.id,
        statement: fact.statement,
        quote: fact.evidence,
        documentTitle: fact.sourceTitle,
        confidence: fact.confidence
      };
    }),
    audit: auditRecords.map((record) => {
      const props = record.get("e").properties;
      return {
        id: props.id,
        actorName: props.actorName,
        action: props.action,
        metadata: JSON.parse(props.metadataJson || "{}"),
        createdAt: props.createdAt
      };
    }),
    observations: observationRecords.map((record) => {
      const props = record.get("o").properties;
      return {
        id: props.id,
        stance: props.stance,
        note: props.note,
        evidence: props.evidence || "",
        authorId: props.authorId,
        authorName: props.authorName,
        createdAt: props.createdAt
      };
    })
  });
}));

app.post("/api/axioms", asyncRoute(async (req, res) => {
  const input = z.object({
    factIds: z.array(z.string().trim().min(1)).min(1).max(20).optional(),
    sourceItemId: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).max(160),
    statement: z.string().trim().min(10).max(5000),
    evidenceSnapshot: z.string().trim().max(2000).optional().default("")
  }).parse(req.body);
  if (!input.factIds?.length && !input.sourceItemId) {
    return res.status(400).json({ error: "公理至少需要一条事实证据" });
  }
  const factRecords = input.factIds?.length
    ? await read(
      "MATCH (f:Fact {ownerId: $ownerId}) WHERE f.id IN $factIds RETURN f",
      { factIds: input.factIds, ownerId: req.user.id }
    )
    : [];
  if (input.factIds?.length && factRecords.length !== input.factIds.length) {
    return res.status(404).json({ error: "部分事实不存在或不属于当前用户" });
  }
  const sourceRecords = input.sourceItemId
    ? await read(
      "MATCH (n:KnowledgeItem {id: $id, ownerId: $ownerId}) RETURN n",
      { id: input.sourceItemId, ownerId: req.user.id }
    )
    : [];
  if (input.sourceItemId && !sourceRecords.length) return res.status(404).json({ error: "私有来源节点不存在" });
  const source = sourceRecords.length ? nodeToItem(sourceRecords[0].get("n")) : null;
  const facts = factRecords.map((record) => factFromNode(record.get("f")));
  const evidenceSnapshot = input.evidenceSnapshot || facts.map((fact) => fact.quote || fact.statement).join("\n\n") || source?.summary || "";
  const sourceTitle = facts.length === 1 ? facts[0].documentTitle : facts.length ? `${facts.length} 条事实` : source.title;
  const timestamp = now();
  const records = await write(
    `
    CREATE (a:Axiom {
      id: $id,
      title: $title,
      statement: $statement,
      status: "pending",
      authorId: $authorId,
      authorName: $authorName,
      sourceItemId: $sourceItemId,
      sourceTitle: $sourceTitle,
      sourceSummary: $sourceSummary,
      evidenceSnapshot: $evidenceSnapshot,
      factCount: $factCount,
      version: 1,
      previousAxiomId: "",
      supersededById: "",
      supportCount: 0,
      opposeCount: 0,
      createdAt: $timestamp,
      updatedAt: $timestamp
    })
    RETURN a
    `,
    {
      id: crypto.randomUUID(),
      title: input.title,
      statement: input.statement,
      authorId: req.user.id,
      authorName: req.user.displayName,
      sourceItemId: source?.id || "",
      sourceTitle,
      sourceSummary: source?.summary || facts.map((fact) => fact.statement).join("\n"),
      evidenceSnapshot,
      factCount: facts.length,
      timestamp
    }
  );
  if (facts.length) {
    await write(
      `
      MATCH (a:Axiom {id: $axiomId})
      MATCH (f:Fact {ownerId: $ownerId})
      WHERE f.id IN $factIds
      CREATE (publicFact:PublicFact {
        id: randomUUID(),
        title: f.statement,
        statement: f.statement,
        evidence: f.quote,
        confidence: f.confidence,
        status: "published",
        sourceTitle: f.documentTitle,
        sourceFactId: f.id,
        authorId: $ownerId,
        authorName: $authorName,
        createdAt: $timestamp,
        updatedAt: $timestamp
      })
      CREATE (f)-[:PUBLISHED_AS {createdAt: $timestamp}]->(publicFact)
      CREATE (a)-[:SUPPORTED_BY {createdAt: $timestamp}]->(publicFact)
      `,
      {
        axiomId: records[0].get("a").properties.id,
        ownerId: req.user.id,
        authorName: req.user.displayName,
        factIds: input.factIds,
        timestamp
      }
    );
    await write(
      `
      MATCH (f:Fact {ownerId: $ownerId})
      WHERE f.id IN $factIds
      MATCH (f)-[:ABOUT]->(privateEntity:KnowledgeItem {ownerId: $ownerId})
      MATCH (publicFact:PublicFact {sourceFactId: f.id})
      MERGE (publicEntity:PublicEntity {canonicalKey: toLower(trim(privateEntity.title))})
      ON CREATE SET publicEntity.id = randomUUID(),
                    publicEntity.createdAt = $timestamp
      SET publicEntity.name = privateEntity.title,
          publicEntity.entityType = privateEntity.kind,
          publicEntity.description = privateEntity.summary,
          publicEntity.sourceTitle = f.documentTitle,
          publicEntity.updatedAt = $timestamp
      MERGE (publicFact)-[:ABOUT {createdAt: $timestamp}]->(publicEntity)
      `,
      {
        ownerId: req.user.id,
        factIds: input.factIds,
        timestamp
      }
    );
    await write(
      `
      MATCH (f:Fact {ownerId: $ownerId})
      WHERE f.id IN $factIds
      MATCH (f)-[:ABOUT]->(privateSource:KnowledgeItem {ownerId: $ownerId})
      MATCH (f)-[:ABOUT]->(privateTarget:KnowledgeItem {ownerId: $ownerId})
      MATCH (privateSource)-[privateRelation:RELATED_TO]->(privateTarget)
      WHERE privateRelation.ownerId = $ownerId
        AND privateSource.id <> privateTarget.id
        AND privateRelation.evidenceChunkId = f.chunkId
      MATCH (publicSource:PublicEntity {canonicalKey: toLower(trim(privateSource.title))})
      MATCH (publicTarget:PublicEntity {canonicalKey: toLower(trim(privateTarget.title))})
      MATCH (publicFact:PublicFact {sourceFactId: f.id})
      MERGE (publicSource)-[publicRelation:RELATED_TO {
        type: privateRelation.type,
        evidenceFactId: publicFact.id
      }]->(publicTarget)
      ON CREATE SET publicRelation.id = randomUUID(),
                    publicRelation.createdAt = $timestamp
      SET publicRelation.description = privateRelation.note,
          publicRelation.confidence = privateRelation.confidence,
          publicRelation.provenance = "published_fact",
          publicRelation.updatedAt = $timestamp
      `,
      {
        ownerId: req.user.id,
        factIds: input.factIds,
        timestamp
      }
    );
  } else if (source) {
    await write(
      `
      MATCH (a:Axiom {id: $axiomId})
      MATCH (source:KnowledgeItem {id: $sourceItemId, ownerId: $ownerId})
      CREATE (publicFact:PublicFact {
        id: randomUUID(),
        title: source.title,
        statement: source.summary,
        evidence: $evidenceSnapshot,
        confidence: 1.0,
        status: "published",
        sourceTitle: source.title,
        sourceItemId: source.id,
        authorId: $ownerId,
        authorName: $authorName,
        createdAt: $timestamp,
        updatedAt: $timestamp
      })
      CREATE (source)-[:PUBLISHED_AS {createdAt: $timestamp}]->(publicFact)
      CREATE (a)-[:SUPPORTED_BY {createdAt: $timestamp}]->(publicFact)
      `,
      {
        axiomId: records[0].get("a").properties.id,
        sourceItemId: source.id,
        ownerId: req.user.id,
        authorName: req.user.displayName,
        evidenceSnapshot,
        timestamp
      }
    );
    await write(
      `
      MATCH (privateEntity:KnowledgeItem {id: $sourceItemId, ownerId: $ownerId})
      MATCH (publicFact:PublicFact {sourceItemId: privateEntity.id})
      MERGE (publicEntity:PublicEntity {canonicalKey: toLower(trim(privateEntity.title))})
      ON CREATE SET publicEntity.id = randomUUID(),
                    publicEntity.createdAt = $timestamp
      SET publicEntity.name = privateEntity.title,
          publicEntity.entityType = privateEntity.kind,
          publicEntity.description = privateEntity.summary,
          publicEntity.sourceTitle = privateEntity.source,
          publicEntity.updatedAt = $timestamp
      MERGE (publicFact)-[:ABOUT {createdAt: $timestamp}]->(publicEntity)
      `,
      {
        sourceItemId: source.id,
        ownerId: req.user.id,
        timestamp
      }
    );
  }
  await createAuditEvent({
    actor: req.user,
    action: "axiom.created",
    entityType: "Axiom",
    entityId: records[0].get("a").properties.id,
    metadata: { factCount: facts.length }
  });
  res.status(201).json({ axiom: axiomFromNode(records[0].get("a")) });
}));

app.post("/api/axioms/:id/revisions", asyncRoute(async (req, res) => {
  const input = z.object({
    title: z.string().trim().min(1).max(160),
    statement: z.string().trim().min(10).max(5000)
  }).parse(req.body);
  const id = crypto.randomUUID();
  const timestamp = now();
  const records = await write(
    `
    MATCH (old:Axiom {id: $oldId, authorId: $authorId})
    CREATE (next:Axiom {
      id: $id,
      title: $title,
      statement: $statement,
      status: "pending",
      authorId: old.authorId,
      authorName: old.authorName,
      sourceItemId: old.sourceItemId,
      sourceTitle: old.sourceTitle,
      sourceSummary: old.sourceSummary,
      evidenceSnapshot: old.evidenceSnapshot,
      factCount: old.factCount,
      version: coalesce(old.version, 1) + 1,
      previousAxiomId: old.id,
      supersededById: "",
      supportCount: 0,
      opposeCount: 0,
      createdAt: $timestamp,
      updatedAt: $timestamp
    })
    WITH old, next
    OPTIONAL MATCH (old)-[:SUPPORTED_BY]->(f:PublicFact)
    FOREACH (_ IN CASE WHEN f IS NULL THEN [] ELSE [1] END | MERGE (next)-[:SUPPORTED_BY]->(f))
    SET old.status = "superseded",
        old.supersededById = next.id,
        old.updatedAt = $timestamp
    RETURN next
    `,
    {
      oldId: req.params.id,
      authorId: req.user.id,
      id,
      title: input.title,
      statement: input.statement,
      timestamp
    }
  );
  if (!records.length) return res.status(404).json({ error: "公理不存在，或你不是作者" });
  await Promise.all([
    createAuditEvent({
      actor: req.user,
      action: "axiom.revised",
      entityType: "Axiom",
      entityId: id,
      metadata: { previousAxiomId: req.params.id }
    }),
    createAuditEvent({
      actor: req.user,
      action: "axiom.superseded",
      entityType: "Axiom",
      entityId: req.params.id,
      metadata: { supersededById: id }
    })
  ]);
  res.status(201).json({ axiom: axiomFromNode(records[0].get("next")) });
}));

app.put("/api/axioms/:id/vote", asyncRoute(async (req, res) => {
  const input = z.object({ value: z.enum(["support", "oppose"]) }).parse(req.body);
  const records = await write(
    `
    MATCH (u:User {id: $userId})
    MATCH (a:Axiom {id: $id})
    MERGE (u)-[v:VOTED]->(a)
    SET v.value = $value, v.updatedAt = $timestamp
    WITH a
    OPTIONAL MATCH (:User)-[allVotes:VOTED]->(a)
    WITH a,
         count(CASE WHEN allVotes.value = "support" THEN 1 END) AS supports,
         count(CASE WHEN allVotes.value = "oppose" THEN 1 END) AS opposes
    SET a.supportCount = supports,
        a.opposeCount = opposes,
        a.status = CASE
          WHEN supports >= 3 AND supports >= opposes * 2 THEN "accepted"
          WHEN opposes >= 3 AND opposes >= supports * 2 THEN "rejected"
          WHEN supports > 0 AND opposes > 0 THEN "disputed"
          ELSE "observed"
        END,
        a.updatedAt = $timestamp
    RETURN a
    `,
    { id: req.params.id, userId: req.user.id, value: input.value, timestamp: now() }
  );
  if (!records.length) return res.status(404).json({ error: "公理不存在" });
  const votedAxiom = axiomFromNode(records[0].get("a"));
  await Promise.all([
    createAuditEvent({
      actor: req.user,
      action: "axiom.voted",
      entityType: "Axiom",
      entityId: req.params.id,
      metadata: { value: input.value }
    }),
    createNotification({
      recipientId: votedAxiom.authorId,
      actorId: req.user.id,
      type: "axiom.vote",
      title: `公理收到${input.value === "support" ? "认可" : "不认可"}`,
      body: votedAxiom.title,
      entityId: req.params.id
    })
  ]);
  res.json({ axiom: { ...votedAxiom, myVote: input.value } });
}));

app.post("/api/axioms/:id/observations", asyncRoute(async (req, res) => {
  const input = z.object({
    stance: z.enum(["support", "oppose", "neutral"]),
    note: z.string().trim().min(2).max(3000),
    evidence: z.string().trim().max(2000).optional().default("")
  }).parse(req.body);
  const timestamp = now();
  const records = await write(
    `
    MATCH (a:Axiom {id: $axiomId})
    CREATE (o:Observation {
      id: $id,
      stance: $stance,
      note: $note,
      evidence: $evidence,
      authorId: $authorId,
      authorName: $authorName,
      createdAt: $timestamp
    })-[:ABOUT_AXIOM]->(a)
    SET a.updatedAt = $timestamp,
        a.status = CASE WHEN a.status = "pending" THEN "observed" ELSE a.status END
    RETURN o, a
    `,
    {
      axiomId: req.params.id,
      id: crypto.randomUUID(),
      stance: input.stance,
      note: input.note,
      evidence: input.evidence,
      authorId: req.user.id,
      authorName: req.user.displayName,
      timestamp
    }
  );
  if (!records.length) return res.status(404).json({ error: "公理不存在" });
  const observedAxiom = axiomFromNode(records[0].get("a"));
  await Promise.all([
    createAuditEvent({
      actor: req.user,
      action: "axiom.observed",
      entityType: "Axiom",
      entityId: req.params.id,
      metadata: { stance: input.stance }
    }),
    createNotification({
      recipientId: observedAxiom.authorId,
      actorId: req.user.id,
      type: "axiom.observation",
      title: "公理收到新观察",
      body: input.note.slice(0, 240),
      entityId: req.params.id
    })
  ]);
  res.status(201).json({ ok: true });
}));

app.get("/api/public/graph", asyncRoute(async (_req, res) => {
  const records = await read(
    `
    MATCH (publicEntity:PublicEntity)
    RETURN collect(DISTINCT publicEntity)[0..300] AS publicEntities
    `
  );
  const record = records[0];
  const publicEntities = record.get("publicEntities").filter(Boolean);
  const publicLinks = publicEntities.length
    ? await read(
      `
      MATCH (source:PublicEntity)-[r]->(target:PublicEntity)
      OPTIONAL MATCH (evidenceFact:PublicFact {id: r.evidenceFactId})
      RETURN coalesce(r.id, elementId(r)) AS id,
             source.id AS sourceId,
             target.id AS targetId,
             type(r) AS relationshipType,
             r.type AS semanticType,
             r.note AS note,
             r.description AS description,
             r.evidenceFactId AS evidenceFactId,
             r.confidence AS confidence,
             r.provenance AS provenance,
             r.createdAt AS createdAt,
             evidenceFact.statement AS evidenceStatement,
             evidenceFact.evidence AS evidenceQuote,
             evidenceFact.sourceTitle AS evidenceSource
      LIMIT 600
      `
    )
    : [];
  res.json({
    ontology: {
      nodeRule: "只有具有稳定身份、可重复引用和归一化的名词对象才能成为实体节点。",
      assertionRule: "事实、公理、假设和观察属于断言与治理记录，不作为实体节点展示。"
    },
    nodes: publicEntities.map((node) => {
      const props = node.properties;
      return {
        id: props.id,
        title: props.name,
        kind: props.entityType || "Concept",
        summary: props.description || "",
        content: props.description || "",
        tags: ["实体", props.entityType || "Concept"],
        source: props.sourceTitle || "",
        publicEntity: {
          id: props.id,
          name: props.name,
          entityType: props.entityType || "Concept",
          description: props.description || "",
          canonicalKey: props.canonicalKey || "",
          sourceTitle: props.sourceTitle || ""
        }
      };
    }),
    links: publicLinks.map((record) => ({
        id: record.get("id"),
        sourceId: record.get("sourceId"),
        targetId: record.get("targetId"),
        type: record.get("semanticType") || record.get("relationshipType"),
        note: record.get("note") || "",
        description: record.get("description") || "",
        evidenceFactId: record.get("evidenceFactId") || "",
        confidence: Number(record.get("confidence") || 0),
        provenance: record.get("provenance") || "",
        createdAt: record.get("createdAt") || "",
        evidence: record.get("evidenceStatement") ? {
          statement: record.get("evidenceStatement"),
          quote: record.get("evidenceQuote") || "",
          sourceTitle: record.get("evidenceSource") || ""
        } : null
      }))
  });
}));

app.post("/api/model-profiles", asyncRoute(async (req, res) => {
  const input = modelProfileInput.parse(req.body);
  const timestamp = now();
  const existing = await read("MATCH (p:ModelProfile {ownerId: $ownerId}) RETURN count(p) AS count", {
    ownerId: req.user.id
  });
  const isDefault = input.isDefault || existing[0].get("count").toNumber() === 0;
  if (isDefault) {
    await write("MATCH (p:ModelProfile {ownerId: $ownerId}) SET p.isDefault = false", { ownerId: req.user.id });
  }
  const records = await write(
    `
    MATCH (u:User {id: $ownerId})
    CREATE (u)-[:OWNS_MODEL_PROFILE]->(p:ModelProfile {
      id: $id,
      ownerId: $ownerId,
      label: $label,
      protocol: $protocol,
      baseUrl: $baseUrl,
      model: $model,
      embeddingModel: $embeddingModel,
      rerankModel: $rerankModel,
      contextWindow: $contextWindow,
      promptBudgetTokens: $promptBudgetTokens,
      maxOutputTokens: $maxOutputTokens,
      safetyTokens: $safetyTokens,
      autoConfigure: $autoConfigure,
      apiMode: $apiMode,
      chatThinking: $chatThinking,
      reasoningEffort: $reasoningEffort,
      reasoningMode: $reasoningMode,
      textVerbosity: $textVerbosity,
      apiKeyCipher: $apiKeyCipher,
      isDefault: $isDefault,
      createdAt: $timestamp,
      updatedAt: $timestamp
    })
    RETURN p
    `,
    {
      id: crypto.randomUUID(),
      ownerId: req.user.id,
      label: input.label,
      protocol: input.protocol,
      baseUrl: input.baseUrl.replace(/\/+$/, ""),
      model: input.model,
      embeddingModel: input.embeddingModel,
      rerankModel: input.rerankModel,
      contextWindow: input.contextWindow,
      promptBudgetTokens: input.promptBudgetTokens,
      maxOutputTokens: input.maxOutputTokens,
      safetyTokens: input.safetyTokens,
      autoConfigure: input.autoConfigure,
      apiMode: input.apiMode,
      chatThinking: input.chatThinking,
      reasoningEffort: input.reasoningEffort,
      reasoningMode: input.reasoningMode,
      textVerbosity: input.textVerbosity,
      apiKeyCipher: encryptSecret(input.apiKey),
      isDefault,
      timestamp
    }
  );
  res.status(201).json({ profile: modelProfileFromNode(records[0].get("p")) });
}));

app.post("/api/model-profiles/:id/default", asyncRoute(async (req, res) => {
  const records = await write(
    `
    MATCH (selected:ModelProfile {id: $id, ownerId: $ownerId})
    MATCH (p:ModelProfile {ownerId: $ownerId})
    SET p.isDefault = p.id = selected.id,
        p.updatedAt = CASE WHEN p.id = selected.id THEN $timestamp ELSE p.updatedAt END
    RETURN selected
    `,
    { id: req.params.id, ownerId: req.user.id, timestamp: now() }
  );
  if (!records.length) return res.status(404).json({ error: "模型配置不存在" });
  res.json({ profile: modelProfileFromNode(records[0].get("selected")) });
}));

app.patch("/api/model-profiles/:id", asyncRoute(async (req, res) => {
  const input = modelProfileUpdate.parse(req.body);
  const properties = {
    ...input,
    ...(input.baseUrl ? { baseUrl: input.baseUrl.replace(/\/+$/, "") } : {}),
    ...(input.apiKey ? { apiKeyCipher: encryptSecret(input.apiKey) } : {}),
    updatedAt: now()
  };
  delete properties.apiKey;
  const records = await write(
    `
    MATCH (p:ModelProfile {id: $id, ownerId: $ownerId})
    SET p += $properties
    RETURN p
    `,
    { id: req.params.id, ownerId: req.user.id, properties }
  );
  if (!records.length) return res.status(404).json({ error: "模型配置不存在" });
  res.json({ profile: modelProfileFromNode(records[0].get("p")) });
}));

app.get("/api/model-profiles/:id/models", asyncRoute(async (req, res) => {
  const records = await read(
    "MATCH (p:ModelProfile {id: $id, ownerId: $ownerId}) RETURN p",
    { id: req.params.id, ownerId: req.user.id }
  );
  if (!records.length) return res.status(404).json({ error: "模型配置不存在" });
  const profileNode = records[0].get("p");
  const models = await discoverProfileModels({
    profile: modelProfileFromNode(profileNode),
    apiKey: decryptSecret(profileNode.properties.apiKeyCipher)
  });
  res.json({ models });
}));

app.delete("/api/model-profiles/:id", asyncRoute(async (req, res) => {
  const records = await write(
    `
    MATCH (p:ModelProfile {id: $id, ownerId: $ownerId})
    WITH p, p.isDefault AS wasDefault
    DETACH DELETE p
    RETURN wasDefault
    `,
    { id: req.params.id, ownerId: req.user.id }
  );
  if (!records.length) return res.status(404).json({ error: "模型配置不存在" });
  if (records[0].get("wasDefault")) {
    await write(
      `
      MATCH (p:ModelProfile {ownerId: $ownerId})
      WITH p ORDER BY p.updatedAt DESC LIMIT 1
      SET p.isDefault = true
      `,
      { ownerId: req.user.id }
    );
  }
  res.json({ deleted: 1 });
}));

app.get("/api/items", asyncRoute(async (req, res) => {
  const query = String(req.query.q || "").trim().toLowerCase();
  const kind = String(req.query.kind || "").trim();
  const tags = String(req.query.tags || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  const records = await read(
    `
    MATCH (n:KnowledgeItem)
    WHERE n.ownerId = $ownerId
      AND ($query = "" OR toLower(n.title) CONTAINS $query OR toLower(n.summary) CONTAINS $query OR any(tag IN n.tags WHERE toLower(tag) CONTAINS $query))
      AND ($kind = "" OR n.kind = $kind)
      AND (size($tags) = 0 OR all(tag IN $tags WHERE tag IN n.tags))
    OPTIONAL MATCH (n)-[r:RELATED_TO]-(:KnowledgeItem)
    WHERE r.ownerId = $ownerId
    RETURN n, count(r) AS degree
    ORDER BY n.updatedAt DESC
    LIMIT 200
    `,
    { query, kind, tags, ownerId: req.user.id }
  );

  res.json({
    items: records.map((record) => ({
      ...nodeToItem(record.get("n")),
      degree: record.get("degree").toNumber()
    }))
  });
}));

app.post("/api/items", asyncRoute(async (req, res) => {
  const input = itemSchema.parse(req.body);
  const timestamp = now();
  const id = crypto.randomUUID();
  const records = await write(
    `
    CREATE (n:KnowledgeItem {
      id: $id,
      title: $title,
      kind: $kind,
      summary: $summary,
      content: $content,
      tags: $tags,
      source: $source,
      ownerId: $ownerId,
      createdAt: $timestamp,
      updatedAt: $timestamp
    })
    RETURN n
    `,
    { id, timestamp, ownerId: req.user.id, ...input }
  );
  res.status(201).json({ item: nodeToItem(records[0].get("n")) });
}));

app.patch("/api/items/:id", asyncRoute(async (req, res) => {
  const input = itemUpdateSchema.parse(req.body);
  const records = await write(
    `
    MATCH (n:KnowledgeItem {id: $id, ownerId: $ownerId})
    SET n += $input, n.updatedAt = $timestamp
    RETURN n
    `,
    { id: req.params.id, ownerId: req.user.id, input, timestamp: now() }
  );
  if (!records.length) return res.status(404).json({ error: "Item not found" });
  res.json({ item: nodeToItem(records[0].get("n")) });
}));

app.delete("/api/items/:id", asyncRoute(async (req, res) => {
  const records = await write(
    `
    MATCH (n:KnowledgeItem {id: $id, ownerId: $ownerId})
    DETACH DELETE n
    RETURN count(n) AS deleted
    `,
    { id: req.params.id, ownerId: req.user.id }
  );
  res.json({ deleted: records[0].get("deleted").toNumber() });
}));

app.get("/api/graph", asyncRoute(async (req, res) => {
  const query = String(req.query.q || "").trim().toLowerCase();
  const scope = req.query.scope === "local" ? "local" : "global";
  const centerId = String(req.query.centerId || "").trim();
  const kind = String(req.query.kind || "").trim();
  const depth = Math.max(1, Math.min(3, Number(req.query.depth) || 1));
  const params = { query, ownerId: req.user.id, centerId, kind };
  const records = scope === "local" && centerId
    ? await read(
      `
      MATCH (center:KnowledgeItem {id: $centerId, ownerId: $ownerId})
      MATCH path=(center)-[:RELATED_TO*0..${depth}]-(n:KnowledgeItem)
      WHERE n.ownerId = $ownerId
        AND all(rel IN relationships(path) WHERE rel.ownerId = $ownerId)
        AND ($kind = "" OR n.kind = $kind OR n.id = $centerId)
        AND ($query = "" OR toLower(n.title) CONTAINS $query OR toLower(n.summary) CONTAINS $query OR toLower(n.content) CONTAINS $query OR any(tag IN n.tags WHERE toLower(tag) CONTAINS $query))
      WITH collect(DISTINCT n)[0..120] AS nodes
      UNWIND nodes AS n
      OPTIONAL MATCH (n)-[r:RELATED_TO]-(m:KnowledgeItem)
      WHERE m IN nodes AND r.ownerId = $ownerId
      RETURN collect(DISTINCT n) AS nodes, collect(DISTINCT {rel: r, source: startNode(r).id, target: endNode(r).id}) AS links
      `,
      params
    )
    : await read(
      `
      MATCH (n:KnowledgeItem)
      WHERE n.ownerId = $ownerId
        AND ($kind = "" OR n.kind = $kind)
        AND ($query = "" OR toLower(n.title) CONTAINS $query OR toLower(n.summary) CONTAINS $query OR toLower(n.content) CONTAINS $query OR any(tag IN n.tags WHERE toLower(tag) CONTAINS $query))
      WITH n
      ORDER BY n.updatedAt DESC
      LIMIT 120
      WITH collect(n) AS nodes
      UNWIND nodes AS n
      OPTIONAL MATCH (n)-[r:RELATED_TO]-(m:KnowledgeItem)
      WHERE m IN nodes AND r.ownerId = $ownerId
      RETURN collect(DISTINCT n) AS nodes, collect(DISTINCT {rel: r, source: startNode(r).id, target: endNode(r).id}) AS links
      `,
      params
    );

  const record = records[0];
  const nodes = record.get("nodes").map(nodeToItem);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = record.get("links")
    .filter((entry) => entry.rel && nodeIds.has(entry.source) && nodeIds.has(entry.target))
    .map((entry) => ({
      ...relationshipToLink(entry.rel),
      sourceId: entry.source,
      targetId: entry.target
    }));

  res.json({ nodes, links });
}));

app.get("/api/items/:id/references", asyncRoute(async (req, res) => {
  const selectedRecords = await read(
    "MATCH (n:KnowledgeItem {id: $id, ownerId: $ownerId}) RETURN n",
    { id: req.params.id, ownerId: req.user.id }
  );
  if (!selectedRecords.length) return res.status(404).json({ error: "节点不存在" });
  const selected = nodeToItem(selectedRecords[0].get("n"));
  const records = await read(
    `
    MATCH (candidate:KnowledgeItem {ownerId: $ownerId})
    WHERE candidate.id <> $id
      AND (toLower(candidate.summary) CONTAINS toLower($title)
        OR toLower(candidate.content) CONTAINS toLower($title))
      AND NOT (candidate)-[:RELATED_TO]-(:KnowledgeItem {id: $id, ownerId: $ownerId})
    RETURN candidate
    ORDER BY candidate.updatedAt DESC
    LIMIT 20
    `,
    { id: req.params.id, ownerId: req.user.id, title: selected.title }
  );
  res.json({ mentions: records.map((record) => nodeToItem(record.get("candidate"))) });
}));

app.get("/api/items/:id/evidence", asyncRoute(async (req, res) => {
  const records = await read(
    `
    MATCH (e:Evidence {ownerId: $ownerId, targetType: "item", targetId: $id})
    MATCH (e)-[:FROM_CHUNK]->(c:TextChunk)<-[:HAS_CHUNK]-(d:SourceDocument)
    RETURN e, c, d
    ORDER BY e.createdAt DESC
    LIMIT 30
    `,
    { id: req.params.id, ownerId: req.user.id }
  );
  res.json({
    evidence: records.map((record) => {
      const evidence = record.get("e").properties;
      const chunk = record.get("c").properties;
      const document = record.get("d").properties;
      return {
        id: evidence.id,
        quote: evidence.quote,
        model: evidence.model || "",
        createdAt: evidence.createdAt,
        document: { id: document.id, title: document.title },
        chunk: {
          id: chunk.id,
          index: toNativeNumber(chunk.index),
          start: toNativeNumber(chunk.start),
          end: toNativeNumber(chunk.end)
        }
      };
    })
  });
}));

async function applyConfiguredRerank(ownerId, profileNode, question, context, workspaceId = null) {
  if (!profileNode || context.sources.length < 2) return { ...context, rerankApplied: false };
  const profile = modelProfileFromNode(profileNode);
  if (!profile.rerankModel) return { ...context, rerankApplied: false };
  try {
    const { result: sources } = await runMeteredModelCall({
      userId: ownerId,
      workspaceId,
      operation: "rerank",
      model: profile.rerankModel,
      input: `${question}\n${context.sources.map((source) => source.text).join("\n")}`,
      maxOutputTokens: Math.min(1200, profile.maxOutputTokens),
      execute: (onUsage) => rerankWithProfile({
        profile,
        apiKey: decryptSecret(profileNode.properties.apiKeyCipher),
        query: question,
        candidates: context.sources,
        maxOutputTokens: Math.min(1200, profile.maxOutputTokens),
        providerUserId: ownerId,
        onUsage
      })
    });
    return {
      ...context,
      sources: sources.map((source, index) => ({ ...source, ref: `S${index + 1}` })),
      retrievalMode: `${context.retrievalMode}+rerank`,
      rerankApplied: true
    };
  } catch (error) {
    if (error instanceof QuotaExceededError) throw error;
    return { ...context, rerankApplied: false };
  }
}

app.get("/api/rag/retrieve", asyncRoute(async (req, res) => {
  const question = z.string().trim().min(2).max(2000).parse(req.query.q);
  const retrievalIntent = classifyRetrievalIntent(question);
  const profileId = z.string().trim().max(80).optional().parse(req.query.profileId);
  const optionalUuid = z.union([z.string().uuid(), z.literal("")]).optional().default("");
  const workspaceId = optionalUuid.parse(req.query.workspaceId);
  const currentNoteId = optionalUuid.parse(req.query.currentNoteId);
  let queryEmbedding = null;
  let embeddingModel = "";
  let profileNode = null;
  if (profileId) {
    const records = await read(
      "MATCH (p:ModelProfile {id: $profileId, ownerId: $ownerId}) RETURN p",
      { profileId, ownerId: req.user.id }
    );
    if (records.length) {
      profileNode = records[0].get("p");
      const profile = modelProfileFromNode(profileNode);
      embeddingModel = profile.embeddingModel;
      if (embeddingModel) {
        try {
          const metered = await meteredEmbedding({
            ownerId: req.user.id,
            profile,
            profileNode,
            texts: [question]
          });
          [queryEmbedding] = metered.result;
        } catch {
          queryEmbedding = null;
        }
      }
    }
  }
  const context = await retrieveGraphRagContext({
    ownerId: req.user.id,
    question,
    queryEmbedding,
    embeddingModel,
    workspaceId,
    currentNoteId
  });
  const result = await applyConfiguredRerank(req.user.id, profileNode, question, context, workspaceId || null);
  res.json({
    ...result,
    retrievalPlan: {
      intent: retrievalIntent,
      noteCandidates: result.noteCandidates?.length || 0,
      selectedNotes: Math.min(5, result.noteCandidates?.length || 0),
      maxGraphHops: 2,
      maxPromptChunks: 12
    }
  });
}));

app.post("/api/rag/ask", asyncRoute(async (req, res) => {
  const input = z.object({
    question: z.string().trim().min(2).max(2000),
    profileId: z.string().trim().min(1).max(80),
    conversationId: z.union([z.string().uuid(), z.literal("")]).optional().default(""),
    workspaceId: z.union([z.string().uuid(), z.literal("")]).optional().default(""),
    currentNoteId: z.union([z.string().uuid(), z.literal("")]).optional().default(""),
    webSearch: z.boolean().optional().default(false),
    searchContextSize: z.enum(["low", "medium", "high"]).optional().default("medium")
  }).parse(req.body);
  if (input.conversationId) {
    const ownedConversation = await read(
      "MATCH (c:Conversation {id: $id, ownerId: $ownerId}) RETURN c.id AS id",
      { id: input.conversationId, ownerId: req.user.id }
    );
    if (!ownedConversation.length) return res.status(404).json({ error: "对话不存在" });
  }
  const profileRecords = await read(
    "MATCH (p:ModelProfile {id: $profileId, ownerId: $ownerId}) RETURN p",
    { profileId: input.profileId, ownerId: req.user.id }
  );
  if (!profileRecords.length) return res.status(404).json({ error: "模型配置不存在" });
  const profileNode = profileRecords[0].get("p");
  const profile = modelProfileFromNode(profileNode);
  const retrievalIntent = classifyRetrievalIntent(input.question);
  const historyRecords = input.conversationId
    ? await read(
      `
      MATCH (:Conversation {id: $conversationId, ownerId: $ownerId})-[:HAS_MESSAGE]->(m:Message)
      RETURN m.role AS role, m.content AS content, m.createdAt AS createdAt
      ORDER BY m.createdAt DESC
      LIMIT 24
      `,
      { conversationId: input.conversationId, ownerId: req.user.id }
    )
    : [];
  const historyCandidates = historyRecords.map((record) => ({
    text: `${record.get("role") === "user" ? "用户" : "助手"}：${record.get("content")}`
  }));
  const historySelection = selectWithinTokenBudget(
    historyCandidates,
    Math.floor(profile.promptBudgetTokens * 0.15),
    { maxItems: 24, text: (item) => item.text }
  );
  const conversationHistory = historySelection.items.reverse().map((item) => item.text).join("\n");
  let queryEmbedding = null;
  if (profile.embeddingModel) {
    try {
      const metered = await meteredEmbedding({
        ownerId: req.user.id,
        profile,
        profileNode,
        texts: [input.question]
      });
      [queryEmbedding] = metered.result;
    } catch {
      queryEmbedding = null;
    }
  }
  const context = await retrieveGraphRagContext({
    ownerId: req.user.id,
    question: input.question,
    queryEmbedding,
    embeddingModel: profile.embeddingModel,
    workspaceId: input.workspaceId,
    currentNoteId: input.currentNoteId
  });
  const rerankedContext = await applyConfiguredRerank(
    req.user.id,
    profileNode,
    input.question,
    context,
    input.workspaceId || null
  );
  const searchLimit = { low: 4, medium: 8, high: 12 }[input.searchContextSize];
  const rawWebSources = input.webSearch
    ? await searchWeb(input.question, { limit: searchLimit })
    : [];
  const semanticContext = await semanticContextText();
  const system = `你是知识库研究助手。${input.webSearch
    ? "优先结合提供的私有资料、知识图谱和互联网搜索证据。明确区分私有资料、图谱推导与网页信息；所有网页结论必须使用 [W1] 形式引用对应证据。"
    : "只能根据提供的原始资料和知识图谱回答。"}原始资料结论必须使用 [S1] 形式引用；图谱推导使用 [G1] 形式引用。资料不足时明确说明，不要把推测写成事实。
语义边界：
${semanticContext}
如果问题要求归因，只能提出假设，并明确前提、置信度、替代解释和可证伪条件；不能把假设写成事实。`;
  const preliminaryBudget = createTokenBudget({
    contextWindow: profile.contextWindow,
    promptBudgetTokens: profile.promptBudgetTokens,
    maxOutputTokens: profile.maxOutputTokens,
    safetyTokens: profile.safetyTokens,
    system,
    history: conversationHistory,
    question: input.question
  });
  const webBudget = selectWithinTokenBudget(
    rawWebSources,
    Math.floor(preliminaryBudget.retrievalTokens * 0.3),
    { maxItems: searchLimit, text: (source) => `${source.title}\n${source.url}\n${source.snippet}` }
  );
  const webSources = webBudget.items.map(({ budgetTokens: _budgetTokens, ...source }) => source);
  const webContext = formatWebSearchContext(webSources);
  const budget = createTokenBudget({
    contextWindow: profile.contextWindow,
    promptBudgetTokens: profile.promptBudgetTokens,
    maxOutputTokens: profile.maxOutputTokens,
    safetyTokens: profile.safetyTokens,
    system,
    history: conversationHistory,
    question: `${input.question}\n${webContext}`
  });
  const sourceBudget = selectWithinTokenBudget(
    rerankedContext.sources,
    Math.floor(budget.retrievalTokens * 0.7),
    { maxItems: 12, text: (source) => source.text }
  );
  const nodeBudget = selectWithinTokenBudget(
    rerankedContext.nodes,
    Math.floor(budget.retrievalTokens * 0.2),
    { maxItems: 40, text: (node) => JSON.stringify(node) }
  );
  const linkBudget = selectWithinTokenBudget(
    rerankedContext.links,
    Math.floor(budget.retrievalTokens * 0.1),
    { maxItems: 80, text: (link) => JSON.stringify(link) }
  );
  const boundedContext = {
    ...rerankedContext,
    sources: sourceBudget.items.map((source, index) => ({ ...source, ref: `S${index + 1}` })),
    nodes: nodeBudget.items,
    links: linkBudget.items
  };
  const { result: answer, usage, settlement } = await meteredComplete({
    ownerId: req.user.id,
    workspaceId: input.workspaceId || null,
    profile,
    profileNode,
    operation: input.webSearch ? "web_search_chat" : "chat",
    system,
    user: `${formatRagContext(boundedContext)}${webContext ? `\n\n${webContext}` : ""}${conversationHistory ? `\n\n最近对话：\n${conversationHistory}` : ""}\n\n当前意图：${retrievalIntent}\n问题：${input.question}`
  });
  if (!answer) throw new Error("模型没有返回回答");
  const knowledgeSources = boundedContext.sources.map((source) => ({
    type: "knowledge",
    ref: source.ref,
    documentId: source.documentId,
    chunkId: source.chunkId,
    documentTitle: source.documentTitle,
    chunkIndex: source.chunkIndex
  }));
  const messageSources = [...knowledgeSources, ...webSources];
  const agentTrace = {
    mode: "research",
    steps: [
      {
        id: "knowledge_query",
        label: "查询知识库",
        status: "completed",
        detail: `${boundedContext.sources.length} 个资料片段，${boundedContext.nodes.length} 个图节点，意图 ${retrievalIntent}`
      },
      ...(input.webSearch ? [{
        id: "web_search",
        label: "搜索互联网",
        status: "completed",
        detail: `${webSources.length} 个网页来源`
      }] : []),
      {
        id: "context_build",
        label: "构建模型上下文",
        status: "completed",
        detail: `加入约 ${sourceBudget.usedTokens + webBudget.usedTokens} Token 检索证据`
      },
      {
        id: "model_call",
        label: `调用 ${profile.label || profile.model}`,
        status: "completed",
        detail: `输入 ${usage?.inputTokens || 0} / 输出 ${usage?.outputTokens || 0} Token`
      },
      {
        id: "citation_render",
        label: "附加证据引用",
        status: "completed",
        detail: `${messageSources.length} 个可追溯来源`
      }
    ]
  };
  const conversationId = input.conversationId || crypto.randomUUID();
  const messageTimestamp = now();
  const userMessageId = crypto.randomUUID();
  const assistantMessageId = crypto.randomUUID();
  await write(
    `
    MERGE (c:Conversation {id: $conversationId})
    ON CREATE SET c.ownerId = $ownerId,
                  c.title = $title,
                  c.createdAt = $timestamp
    SET c.updatedAt = $timestamp
    CREATE (userMessage:Message {
      id: $userMessageId,
      conversationId: $conversationId,
      role: "user",
      content: $question,
      sourcesJson: "[]",
      createdAt: $timestamp
    })
    CREATE (assistantMessage:Message {
      id: $assistantMessageId,
      conversationId: $conversationId,
      role: "assistant",
      content: $answer,
      sourcesJson: $sourcesJson,
      modelProfileId: $modelProfileId,
      webSearch: $webSearch,
      searchQueriesJson: $searchQueriesJson,
      agentTraceJson: $agentTraceJson,
      createdAt: $assistantTimestamp
    })
    CREATE (c)-[:HAS_MESSAGE]->(userMessage)
    CREATE (c)-[:HAS_MESSAGE]->(assistantMessage)
    `,
    {
      conversationId,
      ownerId: req.user.id,
      title: input.question.slice(0, 80),
      question: input.question,
      answer,
      userMessageId,
      assistantMessageId,
      sourcesJson: JSON.stringify(messageSources),
      modelProfileId: input.profileId,
      webSearch: input.webSearch,
      searchQueriesJson: JSON.stringify(input.webSearch ? [input.question] : []),
      agentTraceJson: JSON.stringify(agentTrace),
      timestamp: messageTimestamp,
      assistantTimestamp: new Date(Date.now() + 1).toISOString()
    }
  );
  res.json({
    conversationId,
    assistantMessageId,
    answer,
    ...boundedContext,
    sources: messageSources,
    agentTrace,
    webSearch: {
      requested: input.webSearch,
      used: webSources.length > 0,
      queries: input.webSearch ? [input.question] : [],
      sourceCount: webSources.length
    },
    tokenBudget: { ...budget, retrievalUsedTokens: sourceBudget.usedTokens },
    retrievalPlan: {
      intent: retrievalIntent,
      noteCandidates: boundedContext.noteCandidates?.length || 0,
      selectedNotes: Math.min(5, boundedContext.noteCandidates?.length || 0),
      maxGraphHops: 2,
      maxPromptChunks: 12
    },
    usage,
    settlement
  });
}));

app.post("/api/research/build", asyncRoute(async (req, res) => {
  const input = z.object({
    topic: z.string().trim().min(2).max(200),
    profileId: z.string().trim().min(1).max(80)
  }).parse(req.body);
  const profileRecords = await read(
    "MATCH (p:ModelProfile {id: $profileId, ownerId: $ownerId}) RETURN p",
    { profileId: input.profileId, ownerId: req.user.id }
  );
  if (!profileRecords.length) return res.status(404).json({ error: "模型配置不存在" });
  const profileNode = profileRecords[0].get("p");
  const profile = modelProfileFromNode(profileNode);
  const queries = [
    `"${input.topic}" 定义 范围`,
    `"${input.topic}" 职责 工作内容`,
    `"${input.topic}" 选拔 任用 管理`,
    `"${input.topic}" 教育 培训 考核 纪律`,
    `"${input.topic}" 条例 规定 site:gov.cn OR site:12371.cn OR site:gqt.org.cn`
  ];
  const searchResults = [];
  const searchErrors = [];
  for (const query of queries) {
    try {
      searchResults.push(await searchWeb(query, { limit: 8 }));
    } catch (error) {
      searchErrors.push(error.message);
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  const byUrl = new Map();
  for (const result of searchResults) {
    for (const source of result) {
      if (!byUrl.has(source.url)) byUrl.set(source.url, source);
      if (byUrl.size >= 20) break;
    }
  }
  if (!byUrl.size) {
    try {
      for (const source of await searchWeb(input.topic, { limit: 8 })) {
        if (!byUrl.has(source.url)) byUrl.set(source.url, source);
      }
    } catch (error) {
      searchErrors.push(error.message);
    }
  }
  if (!byUrl.size) {
    const error = new Error(
      searchErrors.length
        ? "公开搜索服务当前被上游引擎限流，请稍候重试；系统没有消耗研究模型 Token，也没有创建摄取任务。"
        : `没有检索到“${input.topic}”的可用公开来源，请修改研究主题后重试。`
    );
    error.code = searchErrors.length ? "web_search_rate_limited" : "web_search_empty";
    error.statusCode = searchErrors.length ? 503 : 404;
    throw error;
  }
  function authorityScore(source) {
    const host = new URL(source.url).hostname.toLowerCase();
    if (
      host === "gov.cn" || host.endsWith(".gov.cn")
      || host === "12371.cn" || host.endsWith(".12371.cn")
      || host === "gqt.org.cn" || host.endsWith(".gqt.org.cn")
    ) return 4;
    if (host.endsWith(".edu.cn")) return 3;
    if (host.includes("court.gov.cn") || host.includes("spp.gov.cn")) return 3;
    if (host.includes("wikipedia.org") || host.includes("zhihu.com") || host.includes("csdn.net")) return 0;
    return 1;
  }
  const discoveredSources = [...byUrl.values()]
    .sort((left, right) => authorityScore(right) - authorityScore(left))
    .map((source, index) => ({
    ...source,
    ref: `W${index + 1}`
    }));
  const enrichedSources = await enrichWebSources(discoveredSources, { limit: 12 });
  const system = `你是公开资料研究 Agent。根据提供的网页正文建立可供知识编译器继续抽取的中文研究资料。
只能陈述证据中能够支持的内容，每个关键判断必须使用 [W1] 形式引用。
按以下结构输出 Markdown：概念与边界、核心职责、选拔与任用、教育培训、管理考核、纪律与监督、相关制度、尚待补证。
不同来源冲突时并列说明，禁止为了完整而虚构定义、职责或制度。`;
  const preliminaryBudget = createTokenBudget({
    contextWindow: profile.contextWindow,
    promptBudgetTokens: profile.promptBudgetTokens,
    maxOutputTokens: profile.maxOutputTokens,
    safetyTokens: profile.safetyTokens,
    system,
    question: input.topic
  });
  const sourceBudget = selectWithinTokenBudget(
    enrichedSources,
    Math.floor(preliminaryBudget.retrievalTokens * 0.75),
    {
      minItems: Math.min(4, enrichedSources.length),
      maxItems: 12,
      text: (source) => `${source.title}\n${source.url}\n${source.content || source.snippet}`
    }
  );
  const researchSources = sourceBudget.items.map(({ budgetTokens: _budgetTokens, ...source }) => source);
  const researchContext = formatWebSearchContext(researchSources);
  const { result: dossier, usage, settlement } = await meteredComplete({
    ownerId: req.user.id,
    profile,
    profileNode,
    operation: "web_research",
    system,
    user: `研究主题：${input.topic}\n\n${researchContext}`
  });
  const sourceAppendix = researchSources.map((source) => [
    `[${source.ref}] ${source.title}`,
    `URL: ${source.url}`,
    `来源正文：${source.content || source.snippet}`
  ].join("\n")).join("\n\n");
  const inputText = `研究主题：${input.topic}

Agent 研究稿：
${dossier}

公开来源证据：
${sourceAppendix}`.slice(0, 60000);
  const timestamp = now();
  const jobId = crypto.randomUUID();
  const records = await write(
    `
    CREATE (j:IngestJob {
      id: $id,
      ownerId: $ownerId,
      profileId: $profileId,
      source: $source,
      inputText: $inputText,
      assetsJson: "[]",
      resultJson: "",
      draftJson: "",
      workflowJson: "",
      normalizedText: "",
      status: "queued",
      error: "",
      createdAt: $timestamp,
      updatedAt: $timestamp
    })
    RETURN j
    `,
    {
      id: jobId,
      ownerId: req.user.id,
      profileId: input.profileId,
      source: `Agent 研究 · ${input.topic}`.slice(0, 300),
      inputText,
      timestamp
    }
  );
  scheduleIngestJob(jobId);
  res.status(202).json({
    job: ingestJobFromNode(records[0].get("j")),
    research: {
      topic: input.topic,
      queries,
      sources: researchSources.map(({ content: _content, ...source }) => source),
      agentTrace: {
        mode: "research_build",
        steps: [
          {
            id: "multi_search",
            label: "执行多轮公开检索",
            status: "completed",
            detail: `${queries.length} 个查询，发现 ${discoveredSources.length} 个来源`
          },
          {
            id: "read_pages",
            label: "打开并读取网页",
            status: "completed",
            detail: `${researchSources.length} 个来源进入研究上下文`
          },
          {
            id: "research_model",
            label: `调用 ${profile.label || profile.model}`,
            status: "completed",
            detail: `输入 ${usage?.inputTokens || 0} / 输出 ${usage?.outputTokens || 0} Token`
          },
          {
            id: "create_ingest",
            label: "创建知识编译任务",
            status: "completed",
            detail: "研究稿与来源证据已提交给摄取 Agent"
          }
        ]
      }
    },
    usage,
    settlement
  });
}));

app.post("/api/messages/:id/build-knowledge", asyncRoute(async (req, res) => {
  const input = z.object({
    profileId: z.string().trim().min(1).max(80)
  }).parse(req.body);
  const answerRecords = await read(
    `
    MATCH (c:Conversation {ownerId: $ownerId})-[:HAS_MESSAGE]->(m:Message {
      id: $messageId,
      role: "assistant"
    })
    RETURN c, m
    `,
    {
      ownerId: req.user.id,
      messageId: req.params.id
    }
  );
  if (!answerRecords.length) return res.status(404).json({ error: "该回答尚未持久化或已被删除，不能重复构建知识" });
  const profileRecords = await read(
    "MATCH (p:ModelProfile {id: $profileId, ownerId: $ownerId}) RETURN p.id AS id",
    { profileId: input.profileId, ownerId: req.user.id }
  );
  if (!profileRecords.length) return res.status(404).json({ error: "当前选择的模型配置不存在，请重新选择模型" });
  const conversation = answerRecords[0].get("c").properties;
  const message = answerRecords[0].get("m").properties;
  const sources = JSON.parse(message.sourcesJson || "[]").filter((source) => source.type === "web");
  if (!sources.length) return res.status(409).json({ error: "该回答没有可用于构建知识的网页来源" });

  const sourceList = sources.map((source) => [
    `[${source.ref}] ${source.title}`,
    source.url,
    source.snippet ? `网页摘要：${source.snippet}` : ""
  ].filter(Boolean).join("\n")).join("\n\n");
  const inputText = `互联网研究主题：${conversation.title}

研究摘要：
${message.content}

引用网页：
${sourceList}`;
  const timestamp = now();
  const jobId = crypto.randomUUID();
  const jobRecords = await write(
    `
    CREATE (j:IngestJob {
      id: $id,
      ownerId: $ownerId,
      profileId: $profileId,
      source: $source,
      inputText: $inputText,
      assetsJson: "[]",
      resultJson: "",
      draftJson: "",
      workflowJson: "",
      normalizedText: "",
      status: "queued",
      error: "",
      createdAt: $timestamp,
      updatedAt: $timestamp
    })
    RETURN j
    `,
    {
      id: jobId,
      ownerId: req.user.id,
      profileId: input.profileId,
      source: `互联网研究 · ${String(conversation.title || "基础知识").slice(0, 260)}`,
      inputText,
      timestamp
    }
  );
  scheduleIngestJob(jobId);
  res.status(202).json({ job: ingestJobFromNode(jobRecords[0].get("j")) });
}));

app.post("/api/links", asyncRoute(async (req, res) => {
  const input = linkSchema.parse(req.body);
  if (input.sourceId === input.targetId) {
    return res.status(400).json({ error: "Source and target must be different" });
  }
  const records = await write(
    `
    MATCH (source:KnowledgeItem {id: $sourceId, ownerId: $ownerId})
    MATCH (target:KnowledgeItem {id: $targetId, ownerId: $ownerId})
    CREATE (source)-[r:RELATED_TO {
      id: $id,
      type: $type,
      note: $note,
      ownerId: $ownerId,
      source: "user",
      confidence: 1.0,
      createdAt: $timestamp
    }]->(target)
    SET source.updatedAt = $timestamp, target.updatedAt = $timestamp
    RETURN r, source.id AS sourceId, target.id AS targetId
    `,
    { ...input, ownerId: req.user.id, id: crypto.randomUUID(), timestamp: now() }
  );
  if (!records.length) return res.status(404).json({ error: "Source or target not found" });
  const record = records[0];
  res.status(201).json({
    link: {
      ...relationshipToLink(record.get("r")),
      sourceId: record.get("sourceId"),
      targetId: record.get("targetId")
    }
  });
}));

app.patch("/api/links/:id", asyncRoute(async (req, res) => {
  const input = linkUpdateSchema.parse(req.body);
  const records = await write(
    `
    MATCH ()-[r:RELATED_TO {id: $id, ownerId: $ownerId}]->()
    SET r += $input
    RETURN r, startNode(r).id AS sourceId, endNode(r).id AS targetId
    `,
    { id: req.params.id, ownerId: req.user.id, input }
  );
  if (!records.length) return res.status(404).json({ error: "Link not found" });
  const record = records[0];
  res.json({
    link: {
      ...relationshipToLink(record.get("r")),
      sourceId: record.get("sourceId"),
      targetId: record.get("targetId")
    }
  });
}));

app.delete("/api/links/:id", asyncRoute(async (req, res) => {
  const records = await write(
    `
    MATCH ()-[r:RELATED_TO {id: $id, ownerId: $ownerId}]->()
    DELETE r
    RETURN count(r) AS deleted
    `,
    { id: req.params.id, ownerId: req.user.id }
  );
  res.json({ deleted: records[0].get("deleted").toNumber() });
}));

app.post("/api/extract", asyncRoute(async (req, res) => {
  const input = extractSchema.parse(req.body);
  const profileRecords = await read(
    `
    MATCH (p:ModelProfile {ownerId: $ownerId})
    WHERE ($profileId <> "" AND p.id = $profileId)
       OR ($profileId = "" AND p.isDefault = true)
    RETURN p
    ORDER BY p.isDefault DESC
    LIMIT 1
    `,
    { ownerId: req.user.id, profileId: input.profileId }
  );
  let graph;
  if (profileRecords.length) {
    const profileNode = profileRecords[0].get("p");
    const profile = modelProfileFromNode(profileNode);
    const metered = await meteredExtraction({
      ownerId: req.user.id,
      profile,
      profileNode,
      text: input.text,
      source: input.source
    });
    graph = metered.result;
  } else {
    const records = await read("MATCH (u:User {id: $userId}) RETURN u.openAiKeyCipher AS cipher", { userId: req.user.id });
    const cipher = records[0]?.get("cipher");
    if (!cipher) return res.status(400).json({ error: "请先创建模型配置" });
    const metered = await runMeteredModelCall({
      userId: req.user.id,
      operation: "entity_extraction",
      model: input.model,
      input: `${input.source}\n${input.text}`,
      maxOutputTokens: 4096,
      execute: () => extractGraphFromText({
        apiKey: decryptSecret(cipher),
        text: input.text,
        source: input.source,
        model: input.model
      })
    });
    graph = metered.result;
  }
  const normalized = normalizeExtractionGraph(graph);
  const compiled = attachModelOutputIssues(compileKnowledgeDraft({
    graph: normalized.graph,
    sourceText: input.text
  }), normalized.issues);
  res.json(compiled);
}));

async function persistUploadedFiles(ownerId, files) {
  const assetDirectory = path.join(uploadRoot, ownerId);
  await mkdir(assetDirectory, { recursive: true });
  const assets = [];
  for (const file of files) {
    const id = crypto.randomUUID();
    const extension = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, "").slice(0, 12);
    const storedName = `${id}${extension}`;
    await writeFile(path.join(assetDirectory, storedName), file.buffer, { flag: "wx" });
    assets.push({
      id,
      name: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      storedName
    });
  }
  return assets;
}

app.post("/api/ingest/preview", upload.array("files", 6), asyncRoute(async (req, res) => {
  const input = z.object({
    text: z.string().trim().max(60000).optional().default(""),
    profileId: z.string().trim().min(1).max(80),
    source: z.string().trim().max(300).optional().default("")
  }).parse(req.body);
  const files = req.files || [];
  const images = files
    .filter((file) => file.mimetype.startsWith("image/"))
    .map((file) => ({ mimeType: file.mimetype, data: file.buffer, name: file.originalname }));
  const documentParts = await Promise.all(files.filter((file) => !file.mimetype.startsWith("image/")).map(async (file) => ({
    name: file.originalname,
    text: await textFromUpload(file)
  })));
  const unsupported = documentParts.filter((part) => !part.text).map((part) => part.name);
  if (unsupported.length) return res.status(400).json({ error: `暂不支持这些文件：${unsupported.join("、")}` });
  const combinedText = [
    input.text,
    ...documentParts.map((part) => `\n\n--- 文件：${part.name} ---\n${part.text}`)
  ].join("").trim().slice(0, 60000);
  if (!combinedText && !images.length) return res.status(400).json({ error: "请输入文字或添加文件" });
  const profileRecords = await read(
    "MATCH (p:ModelProfile {id: $profileId, ownerId: $ownerId}) RETURN p",
    { profileId: input.profileId, ownerId: req.user.id }
  );
  if (!profileRecords.length) return res.status(404).json({ error: "模型配置不存在" });
  const profileNode = profileRecords[0].get("p");
  const profile = modelProfileFromNode(profileNode);
  const source = input.source || files.map((file) => file.originalname).join("、") || "对话摄取";
  const { result: rawGraph } = await meteredExtraction({
    ownerId: req.user.id,
    profile,
    profileNode,
    text: combinedText,
    source,
    images
  });
  const normalized = normalizeExtractionGraph(rawGraph);
  const graph = normalized.graph;
  const imageEvidence = images.length
    ? `\n\n--- 图片视觉证据 ---\n${graph.facts.map((fact) => fact.evidence).filter(Boolean).join("\n")}`
    : "";
  const normalizedText = `${combinedText || `图片来源：${images.map((image) => image.name).join("、")}`}${imageEvidence}`.slice(0, 60000);
  const compiled = attachModelOutputIssues(compileKnowledgeDraft({
    graph,
    sourceText: normalizedText,
    allowVisualEvidence: images.length > 0
  }), normalized.issues);
  const assets = await persistUploadedFiles(req.user.id, files);
  res.json({
    source,
    text: normalizedText,
    ...compiled,
    assets
  });
}));

function ingestJobFromNode(node) {
  const props = node.properties;
  return {
    id: props.id,
    documentId: props.documentId || "",
    source: props.source,
    status: props.status,
    profileId: props.profileId,
    fileNames: JSON.parse(props.assetsJson || "[]").map((asset) => asset.name),
    error: props.error || "",
    errorCode: props.errorCode || "",
    errorTitle: props.errorTitle || "",
    errorSuggestion: props.errorSuggestion || "",
    result: JSON.parse(props.resultJson || "null"),
    draft: JSON.parse(props.draftJson || "null"),
    workflow: JSON.parse(props.workflowJson || "null"),
    reviewAction: props.reviewAction || "",
    createdAt: props.createdAt,
    updatedAt: props.updatedAt
  };
}

const activeIngestJobs = new Set();

function describeIngestFailure(error) {
  const message = String(error?.message || error || "未知错误").slice(0, 2000);
  if (error instanceof QuotaExceededError || /Token (?:quota|额度不足)/i.test(message)) {
    return {
      code: "quota_exceeded",
      title: "Token 额度不足",
      suggestion: "前往设置查看剩余额度，或降低单次摄取内容量后重试。"
    };
  }
  if (/知识编译需要审核|属性键|证据无法在原文中定位|缺少来源证据/.test(message)) {
    return {
      code: "knowledge_validation",
      title: "知识结构未通过规则校验",
      suggestion: "系统没有写入不合规结果。可直接重试；若重复出现，请缩小原文范围或检查抽取模型。"
    };
  }
  if (/暂不支持这些文件|unsupported/i.test(message)) {
    return {
      code: "unsupported_file",
      title: "文件格式无法解析",
      suggestion: "请改用 TXT、Markdown、CSV、JSON、PDF、DOCX 或常见图片格式。"
    };
  }
  if (/401|403|api.?key|unauthorized|authentication|鉴权|密钥/i.test(message)) {
    return {
      code: "provider_auth",
      title: "模型服务认证失败",
      suggestion: "前往设置检查该模型配置的 API Key、Base URL 和模型 ID。"
    };
  }
  if (/429|rate.?limit|too many requests|限流/i.test(message)) {
    return {
      code: "provider_rate_limit",
      title: "模型服务触发限流",
      suggestion: "稍后重试，或检查模型服务商账户的并发与余额限制。"
    };
  }
  if (/timeout|timed out|abort|连接|fetch failed|ECONN/i.test(message)) {
    return {
      code: "provider_unavailable",
      title: "模型服务暂时不可用",
      suggestion: "检查 Base URL 和服务器网络，稍后再次重试。"
    };
  }
  if (
    error?.code === "INVALID_MODEL_OUTPUT"
    || /有效 JSON|知识结构不是有效 JSON|抽取结果|Zod|invalid_type|模型没有返回|Expected .+ after array element|Unexpected (?:token|end)|JSON Parse error/i.test(message)
  ) {
    return {
      code: "invalid_model_output",
      title: "模型返回格式不符合抽取协议",
      suggestion: "系统已尝试修复格式且没有写入异常数据。请直接重试；若持续失败，请缩小单次摄取内容或改用支持结构化输出的模型。"
    };
  }
  return {
    code: "ingest_failed",
    title: "摄取处理失败",
    suggestion: "请根据下方原始原因检查内容或模型配置后重试。"
  };
}

async function commitIngestJob({ job, user, graph, normalizedText, assets, workflow, reviewAction = "" }) {
  const commitResponse = await fetch(`http://127.0.0.1:${port}/api/extract/commit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${createSessionToken(user)}`
    },
    body: JSON.stringify({
      source: job.source,
      text: normalizedText,
      profileId: job.profileId,
      assets,
      graph
    })
  });
  const result = await commitResponse.json().catch(() => ({}));
  if (!commitResponse.ok) throw new Error(result.error || "写入知识库失败");
  await write(
    `
    MATCH (j:IngestJob {id: $jobId})
    SET j.status = "completed",
        j.documentId = $documentId,
        j.resultJson = $resultJson,
        j.workflowJson = $workflowJson,
        j.reviewAction = $reviewAction,
        j.updatedAt = $timestamp,
        j.completedAt = $timestamp
    `,
    {
      jobId: job.id,
      documentId: result.documentId,
      resultJson: JSON.stringify(result.created),
      workflowJson: JSON.stringify(workflow),
      reviewAction,
      timestamp: now()
    }
  );
  return result;
}

async function processIngestJob(jobId) {
  if (activeIngestJobs.has(jobId)) return;
  activeIngestJobs.add(jobId);
  try {
    const claimed = await write(
      `
      MATCH (j:IngestJob {id: $jobId})
      WHERE j.status = "queued"
      SET j.status = "processing", j.error = "", j.updatedAt = $timestamp
      RETURN j
      `,
      { jobId, timestamp: now() }
    );
    if (!claimed.length) return;
    const job = claimed[0].get("j").properties;
    const context = await read(
      `
      MATCH (u:User {id: $ownerId})
      MATCH (p:ModelProfile {id: $profileId, ownerId: $ownerId})
      RETURN u, p
      `,
      { ownerId: job.ownerId, profileId: job.profileId }
    );
    if (!context.length) throw new Error("用户或模型配置不存在");
    const user = userFromNode(context[0].get("u"));
    const profileNode = context[0].get("p");
    const profile = modelProfileFromNode(profileNode);
    const assets = JSON.parse(job.assetsJson || "[]");
    const files = await Promise.all(assets.map(async (asset) => ({
      originalname: asset.name,
      mimetype: asset.mimeType,
      size: asset.size,
      buffer: await readFile(path.join(uploadRoot, job.ownerId, asset.storedName))
    })));
    const images = files
      .filter((file) => file.mimetype.startsWith("image/"))
      .map((file) => ({ mimeType: file.mimetype, data: file.buffer, name: file.originalname }));
    const documentParts = await Promise.all(files.filter((file) => !file.mimetype.startsWith("image/")).map(async (file) => ({
      name: file.originalname,
      text: await textFromUpload(file)
    })));
    const unsupported = documentParts.filter((part) => !part.text).map((part) => part.name);
    if (unsupported.length) throw new Error(`暂不支持这些文件：${unsupported.join("、")}`);
    const combinedText = [
      job.inputText || "",
      ...documentParts.map((part) => `\n\n--- 文件：${part.name} ---\n${part.text}`)
    ].join("").trim().slice(0, 60000);
    if (!combinedText && !images.length) throw new Error("摄取内容为空");
    const extraction = await meteredExtraction({
      ownerId: job.ownerId,
      profile,
      profileNode,
      text: combinedText,
      source: job.source,
      images
    });
    const normalizedExtraction = normalizeExtractionGraph(extraction.result);
    const graph = normalizedExtraction.graph;
    const imageEvidence = images.length
      ? `\n\n--- 图片视觉证据 ---\n${graph.facts.map((fact) => fact.evidence).filter(Boolean).join("\n")}`
      : "";
    const normalizedText = `${combinedText || `图片来源：${images.map((image) => image.name).join("、")}`}${imageEvidence}`.slice(0, 60000);
    const compiled = attachModelOutputIssues(compileKnowledgeDraft({
      graph,
      sourceText: normalizedText,
      allowVisualEvidence: images.length > 0
    }), normalizedExtraction.issues);
    if (compiled.workflow.status !== "ready") {
      await write(
        `
        MATCH (j:IngestJob {id: $jobId})
        SET j.status = "review_required",
            j.draftJson = $draftJson,
            j.workflowJson = $workflowJson,
            j.normalizedText = $normalizedText,
            j.error = "",
            j.errorCode = "",
            j.errorTitle = "",
            j.errorSuggestion = "",
            j.updatedAt = $timestamp
        `,
        {
          jobId,
          draftJson: JSON.stringify(compiled.graph),
          workflowJson: JSON.stringify(compiled.workflow),
          normalizedText,
          timestamp: now()
        }
      );
      return;
    }
    await commitIngestJob({
      job: { ...job, id: jobId },
      user,
      graph: compiled.graph,
      normalizedText,
      assets,
      workflow: compiled.workflow
    });
  } catch (error) {
    const failure = describeIngestFailure(error);
    await write(
      `
      MATCH (j:IngestJob {id: $jobId})
      SET j.status = "failed",
          j.error = $error,
          j.errorCode = $errorCode,
          j.errorTitle = $errorTitle,
          j.errorSuggestion = $errorSuggestion,
          j.updatedAt = $timestamp
      `,
      {
        jobId,
        error: String(error.message || error).slice(0, 2000),
        errorCode: failure.code,
        errorTitle: failure.title,
        errorSuggestion: failure.suggestion,
        timestamp: now()
      }
    ).catch(() => {});
  } finally {
    activeIngestJobs.delete(jobId);
  }
}

function scheduleIngestJob(jobId) {
  setTimeout(() => processIngestJob(jobId), 0);
}

app.post("/api/ingest/jobs", upload.array("files", 6), asyncRoute(async (req, res) => {
  const input = z.object({
    text: z.string().trim().max(60000).optional().default(""),
    profileId: z.string().trim().min(1).max(80),
    source: z.string().trim().max(300).optional().default("")
  }).parse(req.body);
  const files = req.files || [];
  if (!input.text && !files.length) return res.status(400).json({ error: "请输入文字或添加文件" });
  const profileRecords = await read(
    "MATCH (p:ModelProfile {id: $profileId, ownerId: $ownerId}) RETURN p.id AS id",
    { profileId: input.profileId, ownerId: req.user.id }
  );
  if (!profileRecords.length) return res.status(404).json({ error: "模型配置不存在" });
  const assets = await persistUploadedFiles(req.user.id, files);
  const jobId = crypto.randomUUID();
  const timestamp = now();
  const source = input.source || files.map((file) => file.originalname).join("、") || "对话摄取";
  const records = await write(
    `
    CREATE (j:IngestJob {
      id: $id,
      ownerId: $ownerId,
      profileId: $profileId,
      source: $source,
      inputText: $inputText,
      assetsJson: $assetsJson,
      resultJson: "",
      draftJson: "",
      workflowJson: "",
      normalizedText: "",
      status: "queued",
      error: "",
      createdAt: $timestamp,
      updatedAt: $timestamp
    })
    RETURN j
    `,
    {
      id: jobId,
      ownerId: req.user.id,
      profileId: input.profileId,
      source,
      inputText: input.text,
      assetsJson: JSON.stringify(assets),
      timestamp
    }
  );
  scheduleIngestJob(jobId);
  res.status(202).json({ job: ingestJobFromNode(records[0].get("j")) });
}));

app.get("/api/ingest/jobs", asyncRoute(async (req, res) => {
  const records = await read(
    `
    MATCH (j:IngestJob {ownerId: $ownerId})
    RETURN j
    ORDER BY j.createdAt DESC
    LIMIT 50
    `,
    { ownerId: req.user.id }
  );
  res.json({ jobs: records.map((record) => ingestJobFromNode(record.get("j"))) });
}));

app.get("/api/ingest/jobs/:id", asyncRoute(async (req, res) => {
  const records = await read(
    "MATCH (j:IngestJob {id: $id, ownerId: $ownerId}) RETURN j",
    { id: req.params.id, ownerId: req.user.id }
  );
  if (!records.length) return res.status(404).json({ error: "摄取任务不存在" });
  res.json({ job: ingestJobFromNode(records[0].get("j")) });
}));

app.post("/api/ingest/jobs/:id/retry", asyncRoute(async (req, res) => {
  const records = await write(
    `
    MATCH (j:IngestJob {id: $id, ownerId: $ownerId})
    WHERE j.status IN ["failed", "review_required"]
    SET j.status = "queued",
        j.error = "",
        j.errorCode = "",
        j.errorTitle = "",
        j.errorSuggestion = "",
        j.draftJson = "",
        j.workflowJson = "",
        j.normalizedText = "",
        j.updatedAt = $timestamp
    RETURN j
    `,
    { id: req.params.id, ownerId: req.user.id, timestamp: now() }
  );
  if (!records.length) return res.status(409).json({ error: "只有失败或待审核任务可以重新抽取" });
  scheduleIngestJob(req.params.id);
  res.json({ job: ingestJobFromNode(records[0].get("j")) });
}));

app.post("/api/ingest/jobs/:id/discard-invalid", asyncRoute(async (req, res) => {
  const records = await read(
    `
    MATCH (j:IngestJob {id: $id, ownerId: $ownerId, status: "review_required"})
    MATCH (u:User {id: $ownerId})
    RETURN j, u
    `,
    { id: req.params.id, ownerId: req.user.id }
  );
  if (!records.length) return res.status(409).json({ error: "任务当前不在待审核状态" });
  const jobNode = records[0].get("j");
  const job = jobNode.properties;
  const user = userFromNode(records[0].get("u"));
  const draft = JSON.parse(job.draftJson || "null");
  const workflow = JSON.parse(job.workflowJson || "null");
  if (!draft || !workflow) return res.status(409).json({ error: "任务缺少可审核草稿" });

  const latestCompilation = compileKnowledgeDraft({
    graph: draft,
    sourceText: job.normalizedText || job.inputText || "",
    allowVisualEvidence: JSON.parse(job.assetsJson || "[]").some((asset) => asset.mimeType?.startsWith("image/"))
  });
  const pruned = discardInvalidKnowledgeParts({
    graph: draft,
    workflow: latestCompilation.workflow
  });
  if (!pruned.graph.nodes.length && !pruned.graph.facts.length) {
    return res.status(409).json({ error: "剔除问题项后没有可写入的有效知识，请重新抽取" });
  }
  const compiled = compileKnowledgeDraft({
    graph: pruned.graph,
    sourceText: job.normalizedText || job.inputText || "",
    allowVisualEvidence: JSON.parse(job.assetsJson || "[]").some((asset) => asset.mimeType?.startsWith("image/"))
  });
  if (compiled.workflow.status !== "ready") {
    await write(
      `
      MATCH (j:IngestJob {id: $id, ownerId: $ownerId})
      SET j.draftJson = $draftJson,
          j.workflowJson = $workflowJson,
          j.updatedAt = $timestamp
      `,
      {
        id: req.params.id,
        ownerId: req.user.id,
        draftJson: JSON.stringify(compiled.graph),
        workflowJson: JSON.stringify(compiled.workflow),
        timestamp: now()
      }
    );
    return res.status(409).json({
      error: "剔除一轮问题项后仍有依赖问题，请再次审核",
      workflow: compiled.workflow
    });
  }

  await commitIngestJob({
    job: { ...job, id: req.params.id },
    user,
    graph: compiled.graph,
    normalizedText: job.normalizedText || job.inputText || "",
    assets: JSON.parse(job.assetsJson || "[]"),
    workflow: {
      ...compiled.workflow,
      repairs: [{ type: "discard_invalid", ...pruned.discarded }]
    },
    reviewAction: "discard_invalid"
  });
  const updated = await read(
    "MATCH (j:IngestJob {id: $id, ownerId: $ownerId}) RETURN j",
    { id: req.params.id, ownerId: req.user.id }
  );
  res.json({ job: ingestJobFromNode(updated[0].get("j")), discarded: pruned.discarded });
}));

function embeddingJobFromNode(node) {
  const props = node.properties;
  return {
    id: props.id,
    profileId: props.profileId,
    embeddingModel: props.embeddingModel,
    status: props.status,
    processed: toNativeNumber(props.processed || 0),
    total: toNativeNumber(props.total || 0),
    error: props.error || "",
    createdAt: props.createdAt,
    updatedAt: props.updatedAt
  };
}

const activeEmbeddingJobs = new Set();

async function processEmbeddingJob(jobId) {
  if (activeEmbeddingJobs.has(jobId)) return;
  activeEmbeddingJobs.add(jobId);
  try {
    const claimed = await write(
      `
      MATCH (j:EmbeddingJob {id: $jobId, status: "queued"})
      SET j.status = "processing", j.error = "", j.updatedAt = $timestamp
      RETURN j
      `,
      { jobId, timestamp: now() }
    );
    if (!claimed.length) return;
    const job = claimed[0].get("j").properties;
    const profileRecords = await read(
      "MATCH (p:ModelProfile {id: $profileId, ownerId: $ownerId}) RETURN p",
      { profileId: job.profileId, ownerId: job.ownerId }
    );
    if (!profileRecords.length) throw new Error("模型配置不存在");
    const profileNode = profileRecords[0].get("p");
    const profile = modelProfileFromNode(profileNode);
    if (!profile.embeddingModel) throw new Error("模型配置没有 Embedding 模型");
    const countRecords = await read(
      `
      MATCH (c:TextChunk {ownerId: $ownerId})
      WHERE c.embedding IS NULL OR c.embeddingModel <> $embeddingModel
      RETURN count(c) AS total
      `,
      { ownerId: job.ownerId, embeddingModel: profile.embeddingModel }
    );
    const total = countRecords[0].get("total").toNumber();
    let processed = 0;
    await write(
      "MATCH (j:EmbeddingJob {id: $jobId}) SET j.total = $total, j.processed = 0, j.updatedAt = $timestamp",
      { jobId, total, timestamp: now() }
    );
    while (processed < total) {
      const chunkRecords = await read(
        `
        MATCH (c:TextChunk {ownerId: $ownerId})
        WHERE c.embedding IS NULL OR c.embeddingModel <> $embeddingModel
        RETURN c.id AS id, c.text AS text
        ORDER BY c.createdAt
        LIMIT 32
        `,
        { ownerId: job.ownerId, embeddingModel: profile.embeddingModel }
      );
      if (!chunkRecords.length) break;
      const chunks = chunkRecords.map((record) => ({
        id: record.get("id"),
        text: record.get("text")
      }));
      const metered = await meteredEmbedding({
        ownerId: job.ownerId,
        profile,
        profileNode,
        texts: chunks.map((chunk) => chunk.text)
      });
      const embeddings = metered.result;
      if (embeddings.length !== chunks.length) throw new Error("Embedding 返回数量与分块数量不一致");
      await write(
        `
        UNWIND $rows AS row
        MATCH (c:TextChunk {id: row.id, ownerId: $ownerId})
        SET c.embedding = row.embedding, c.embeddingModel = $embeddingModel
        `,
        {
          ownerId: job.ownerId,
          embeddingModel: profile.embeddingModel,
          rows: chunks.map((chunk, index) => ({ id: chunk.id, embedding: embeddings[index] }))
        }
      );
      processed += chunks.length;
      await write(
        "MATCH (j:EmbeddingJob {id: $jobId}) SET j.processed = $processed, j.updatedAt = $timestamp",
        { jobId, processed, timestamp: now() }
      );
    }
    await write(
      `
      MATCH (j:EmbeddingJob {id: $jobId})
      SET j.status = "completed", j.processed = j.total, j.updatedAt = $timestamp, j.completedAt = $timestamp
      `,
      { jobId, timestamp: now() }
    );
  } catch (error) {
    await write(
      `
      MATCH (j:EmbeddingJob {id: $jobId})
      SET j.status = "failed", j.error = $error, j.updatedAt = $timestamp
      `,
      { jobId, error: String(error.message || error).slice(0, 2000), timestamp: now() }
    ).catch(() => {});
  } finally {
    activeEmbeddingJobs.delete(jobId);
  }
}

function scheduleEmbeddingJob(jobId) {
  setTimeout(() => processEmbeddingJob(jobId), 0);
}

app.post("/api/embedding-jobs", asyncRoute(async (req, res) => {
  const input = z.object({ profileId: z.string().trim().min(1).max(80) }).parse(req.body);
  const profileRecords = await read(
    "MATCH (p:ModelProfile {id: $profileId, ownerId: $ownerId}) RETURN p",
    { profileId: input.profileId, ownerId: req.user.id }
  );
  if (!profileRecords.length) return res.status(404).json({ error: "模型配置不存在" });
  const profile = modelProfileFromNode(profileRecords[0].get("p"));
  if (!profile.embeddingModel) return res.status(400).json({ error: "请先填写 Embedding 模型 ID" });
  const running = await read(
    `
    MATCH (j:EmbeddingJob {ownerId: $ownerId})
    WHERE j.status IN ["queued", "processing"]
    RETURN j
    LIMIT 1
    `,
    { ownerId: req.user.id }
  );
  if (running.length) return res.status(409).json({ error: "已有向量重建任务正在运行" });
  const id = crypto.randomUUID();
  const timestamp = now();
  const records = await write(
    `
    CREATE (j:EmbeddingJob {
      id: $id,
      ownerId: $ownerId,
      profileId: $profileId,
      embeddingModel: $embeddingModel,
      status: "queued",
      processed: 0,
      total: 0,
      error: "",
      createdAt: $timestamp,
      updatedAt: $timestamp
    })
    RETURN j
    `,
    {
      id,
      ownerId: req.user.id,
      profileId: input.profileId,
      embeddingModel: profile.embeddingModel,
      timestamp
    }
  );
  scheduleEmbeddingJob(id);
  res.status(202).json({ job: embeddingJobFromNode(records[0].get("j")) });
}));

app.get("/api/embedding-jobs", asyncRoute(async (req, res) => {
  const records = await read(
    `
    MATCH (j:EmbeddingJob {ownerId: $ownerId})
    RETURN j
    ORDER BY j.createdAt DESC
    LIMIT 30
    `,
    { ownerId: req.user.id }
  );
  res.json({ jobs: records.map((record) => embeddingJobFromNode(record.get("j"))) });
}));

app.get("/api/embedding-jobs/:id", asyncRoute(async (req, res) => {
  const records = await read(
    "MATCH (j:EmbeddingJob {id: $id, ownerId: $ownerId}) RETURN j",
    { id: req.params.id, ownerId: req.user.id }
  );
  if (!records.length) return res.status(404).json({ error: "向量任务不存在" });
  res.json({ job: embeddingJobFromNode(records[0].get("j")) });
}));

app.post("/api/embedding-jobs/:id/retry", asyncRoute(async (req, res) => {
  const records = await write(
    `
    MATCH (j:EmbeddingJob {id: $id, ownerId: $ownerId, status: "failed"})
    SET j.status = "queued", j.error = "", j.processed = 0, j.updatedAt = $timestamp
    RETURN j
    `,
    { id: req.params.id, ownerId: req.user.id, timestamp: now() }
  );
  if (!records.length) return res.status(409).json({ error: "只有失败任务可以重试" });
  scheduleEmbeddingJob(req.params.id);
  res.json({ job: embeddingJobFromNode(records[0].get("j")) });
}));

app.post("/api/extract/commit", asyncRoute(async (req, res) => {
  const input = z.object({
    source: z.string().trim().max(300).optional().default("extract"),
    text: z.string().trim().min(20).max(60000),
    profileId: z.string().trim().max(80).optional().default(""),
    assets: z.array(z.object({
      id: z.string().uuid(),
      name: z.string().trim().min(1).max(300),
      mimeType: z.string().trim().min(1).max(160),
      size: z.number().int().nonnegative().max(12 * 1024 * 1024),
      storedName: z.string().trim().regex(/^[a-f0-9-]{36}(?:\.[a-zA-Z0-9]{1,10})?$/)
    })).max(6).optional().default([]),
    graph: extractionGraphSchema
  }).parse(req.body);
  const compiled = compileKnowledgeDraft({
    graph: input.graph,
    sourceText: input.text,
    allowVisualEvidence: input.assets.some((asset) => asset.mimeType.startsWith("image/"))
  });
  if (compiled.workflow.status !== "ready") {
    return res.status(422).json({
      error: "知识编译未通过，不能写入图谱",
      workflow: compiled.workflow
    });
  }
  const compiledGraph = compiled.graph;
  const timestamp = now();
  const workspace = await ensureDefaultWorkspace(req.user.id);
  const hash = contentHash(input.text);
  const duplicate = await read(
    "MATCH (n:Note {ownerId: $ownerId, workspaceId: $workspaceId, contentHash: $hash}) RETURN n.id AS id LIMIT 1",
    { ownerId: req.user.id, workspaceId: workspace.id, hash }
  );
  if (duplicate.length) {
    return res.json({
      created: { nodes: 0, facts: 0, links: 0, chunks: 0 },
      documentId: duplicate[0].get("id"),
      changed: false
    });
  }
  const titleToId = new Map();
  const profileRecords = input.profileId
    ? await read(
      "MATCH (p:ModelProfile {id: $profileId, ownerId: $ownerId}) RETURN p",
      { profileId: input.profileId, ownerId: req.user.id }
    )
    : [];
  const profile = profileRecords[0] ? modelProfileFromNode(profileRecords[0].get("p")) : null;
  const documentId = crypto.randomUUID();
  const chunks = chunkMarkdown(input.text);
  const chunkIds = new Map();
  await write(
    `
    MATCH (w:Workspace {id: $workspaceId, ownerId: $ownerId})
    CREATE (d:Note:SourceDocument {
      id: $id,
      ownerId: $ownerId,
      workspaceId: $workspaceId,
      title: $title,
      abstract: $abstract,
      content: $content,
      contentHash: $contentHash,
      totalTokens: $totalTokens,
      tags: [],
      sourceType: $sourceType,
      assetCount: $assetCount,
      modelProfileId: $modelProfileId,
      model: $model,
      createdAt: $timestamp
    })
    CREATE (w)-[:CONTAINS]->(d)
    `,
    {
      id: documentId,
      ownerId: req.user.id,
      workspaceId: workspace.id,
      title: input.source || "extract",
      abstract: input.text.replace(/^#{1,6}\s+.+$/gm, "").trim().slice(0, 800),
      content: input.text,
      contentHash: hash,
      totalTokens: estimateTokens(input.text),
      sourceType: input.assets.some((asset) => asset.mimeType.startsWith("image/"))
        ? (input.assets.length === 1 ? "image" : "mixed")
        : input.assets.length ? "file" : "text",
      modelProfileId: input.profileId,
      model: profile?.model || "",
      assetCount: input.assets.length,
      timestamp
    }
  );
  for (const asset of input.assets) {
    const storagePath = path.resolve(uploadRoot, req.user.id, asset.storedName);
    const ownerAssetRoot = path.resolve(uploadRoot, req.user.id);
    if (!storagePath.startsWith(`${ownerAssetRoot}${path.sep}`)) continue;
    await write(
      `
      MATCH (d:SourceDocument {id: $documentId, ownerId: $ownerId})
      CREATE (d)-[:HAS_ASSET]->(a:SourceAsset {
        id: $id,
        ownerId: $ownerId,
        documentId: $documentId,
        name: $name,
        mimeType: $mimeType,
        size: $size,
        storagePath: $storagePath,
        createdAt: $timestamp
      })
      `,
      { ...asset, documentId, ownerId: req.user.id, storagePath, timestamp }
    );
  }
  for (const chunk of chunks) {
    const chunkId = crypto.randomUUID();
    chunkIds.set(chunk.index, chunkId);
    await write(
      `
      MATCH (d:SourceDocument {id: $documentId, ownerId: $ownerId})
      CREATE (d)-[:HAS_CHUNK]->(c:Chunk:TextChunk {
        id: $id,
        ownerId: $ownerId,
        workspaceId: $workspaceId,
        documentId: $documentId,
        noteId: $documentId,
        index: $index,
        start: $start,
        end: $end,
        text: $text,
        tokenCount: $tokenCount,
        heading: $heading,
        headingPath: $headingPath,
        createdAt: $timestamp
      })
      `,
      { ...chunk, id: chunkId, documentId, workspaceId: workspace.id, ownerId: req.user.id, timestamp }
    );
  }

  if (profile?.embeddingModel && chunks.length) {
    try {
      const metered = await meteredEmbedding({
        ownerId: req.user.id,
        profile,
        profileNode: profileRecords[0].get("p"),
        texts: chunks.map((chunk) => chunk.text)
      });
      const embeddings = metered.result;
      for (let index = 0; index < Math.min(chunks.length, embeddings.length); index += 1) {
        await write(
          `
          MATCH (c:TextChunk {id: $chunkId, ownerId: $ownerId})
          SET c.embedding = $embedding, c.embeddingModel = $embeddingModel
          `,
          {
            chunkId: chunkIds.get(chunks[index].index),
            ownerId: req.user.id,
            embedding: embeddings[index],
            embeddingModel: profile.embeddingModel
          }
        );
      }
    } catch (error) {
      await write(
        "MATCH (d:SourceDocument {id: $documentId}) SET d.embeddingError = $error",
        { documentId, error: String(error.message || error).slice(0, 1000) }
      );
    }
  }

  for (const node of compiledGraph.nodes) {
    const id = crypto.randomUUID();
    const attributeProperties = attributesToProperties(node.attributes);
    const records = await write(
      `
      MERGE (n:KnowledgeItem:Entity {ownerId: $ownerId, title: $title})
      ON CREATE SET n.id = $id,
                    n.createdAt = $timestamp
      SET n.kind = $kind,
          n.summary = $summary,
          n.content = $content,
          n.tags = $tags,
          n.source = $source,
          n.attributesJson = $attributesJson,
          n += $attributeProperties,
          n.updatedAt = $timestamp
      RETURN n.id AS id, n.title AS title
      `,
      {
        ...node,
        id,
        ownerId: req.user.id,
        source: node.source || input.source,
        attributesJson: JSON.stringify(node.attributes),
        attributeProperties,
        timestamp
      }
    );
    const nodeId = records[0].get("id");
    titleToId.set(records[0].get("title"), nodeId);
    const evidenceChunk = findEvidenceChunk(chunks, node.evidence);
    if (evidenceChunk) {
      await write(
        `
        MATCH (d:Note {id: $documentId, ownerId: $ownerId})
        MATCH (n:Entity {id: $targetId, ownerId: $ownerId})
        MERGE (d)-[r:MENTIONS {evidenceChunkId: $chunkId}]->(n)
        SET r.source = "llm",
            r.confidence = 0.75,
            r.model = $model,
            r.createdAt = coalesce(r.createdAt, $timestamp)
        `,
        {
          ownerId: req.user.id,
          documentId,
          targetId: nodeId,
          chunkId: chunkIds.get(evidenceChunk.index),
          model: profile?.model || "",
          timestamp
        }
      );
      await write(
        `
        MATCH (c:TextChunk {id: $chunkId, ownerId: $ownerId})
        CREATE (e:Evidence {
          id: $id,
          ownerId: $ownerId,
          targetType: "item",
          targetId: $targetId,
          documentId: $documentId,
          quote: $quote,
          modelProfileId: $modelProfileId,
          model: $model,
          createdAt: $timestamp
        })-[:FROM_CHUNK]->(c)
        `,
        {
          id: crypto.randomUUID(),
          ownerId: req.user.id,
          targetId: nodeId,
          documentId,
          chunkId: chunkIds.get(evidenceChunk.index),
          quote: node.evidence || evidenceChunk.text.slice(0, 500),
          modelProfileId: input.profileId,
          model: profile?.model || "",
          timestamp
        }
      );
    }
  }

  let factCount = 0;
  for (const fact of compiledGraph.facts) {
    const evidenceChunk = findEvidenceChunk(chunks, fact.evidence);
    if (!evidenceChunk) continue;
    const factId = crypto.randomUUID();
    await write(
      `
      MATCH (c:TextChunk {id: $chunkId, ownerId: $ownerId})
      CREATE (f:Fact {
        id: $id,
        ownerId: $ownerId,
        statement: $statement,
        quote: $quote,
        confidence: $confidence,
        status: "candidate",
        documentId: $documentId,
        documentTitle: $documentTitle,
        chunkId: $chunkId,
        chunkIndex: $chunkIndex,
        modelProfileId: $modelProfileId,
        model: $model,
        createdAt: $timestamp,
        updatedAt: $timestamp
      })-[:FROM_CHUNK]->(c)
      `,
      {
        id: factId,
        ownerId: req.user.id,
        statement: fact.statement,
        quote: fact.evidence,
        confidence: fact.confidence,
        documentId,
        documentTitle: input.source || "extract",
        chunkId: chunkIds.get(evidenceChunk.index),
        chunkIndex: evidenceChunk.index,
        modelProfileId: input.profileId,
        model: profile?.model || "",
        timestamp
      }
    );
    const entityIds = fact.entityTitles.map((title) => titleToId.get(title)).filter(Boolean);
    if (entityIds.length) {
      await write(
        `
        MATCH (f:Fact {id: $factId, ownerId: $ownerId})
        MATCH (n:KnowledgeItem {ownerId: $ownerId})
        WHERE n.id IN $entityIds
        MERGE (f)-[:ABOUT]->(n)
        `,
        { factId, ownerId: req.user.id, entityIds }
      );
    }
    factCount += 1;
  }

  let linkCount = 0;
  for (const link of compiledGraph.links) {
    const sourceId = titleToId.get(link.sourceTitle);
    const targetId = titleToId.get(link.targetTitle);
    if (!sourceId || !targetId || sourceId === targetId) continue;
    const evidenceChunk = findEvidenceChunk(chunks, link.evidence);
    const linkRecords = await write(
      `
      MATCH (source:KnowledgeItem {id: $sourceId, ownerId: $ownerId})
      MATCH (target:KnowledgeItem {id: $targetId, ownerId: $ownerId})
      MERGE (source)-[r:RELATED_TO {ownerId: $ownerId, type: $type, source: "llm"}]->(target)
      ON CREATE SET r.id = $id,
                    r.createdAt = $timestamp
      SET r.note = $note,
          r.confidence = 0.65,
          r.model = $model,
          r.evidenceChunkId = $evidenceChunkId
      RETURN r.id AS id
      `,
      {
        ...link,
        id: crypto.randomUUID(),
        ownerId: req.user.id,
        sourceId,
        targetId,
        model: profile?.model || "",
        evidenceChunkId: evidenceChunk ? chunkIds.get(evidenceChunk.index) : "",
        timestamp
      }
    );
    const linkId = linkRecords[0]?.get("id");
    if (linkId && evidenceChunk) {
      await write(
        `
        MATCH (c:TextChunk {id: $chunkId, ownerId: $ownerId})
        CREATE (e:Evidence {
          id: $id,
          ownerId: $ownerId,
          targetType: "link",
          targetId: $targetId,
          documentId: $documentId,
          quote: $quote,
          modelProfileId: $modelProfileId,
          model: $model,
          createdAt: $timestamp
        })-[:FROM_CHUNK]->(c)
        `,
        {
          id: crypto.randomUUID(),
          ownerId: req.user.id,
          targetId: linkId,
          documentId,
          chunkId: chunkIds.get(evidenceChunk.index),
          quote: link.evidence || evidenceChunk.text.slice(0, 500),
          modelProfileId: input.profileId,
          model: profile?.model || "",
          timestamp
        }
      );
    }
    linkCount += 1;
  }

  res.status(201).json({
    created: { nodes: titleToId.size, facts: factCount, links: linkCount, chunks: chunks.length },
    documentId,
    workflow: compiled.workflow
  });
}));

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE: "单个文件不能超过 12MB",
      LIMIT_FILE_COUNT: "一次最多上传 6 个文件",
      LIMIT_FIELD_VALUE: "输入文字过长"
    };
    return res.status(400).json({ error: messages[error.code] || `文件上传失败：${error.message}` });
  }
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: "请求参数无效", issues: error.issues });
  }
  if (error.code === "Neo.ClientError.Schema.ConstraintValidationFailed") {
    return res.status(409).json({ error: "邮箱或唯一字段已存在" });
  }
  if (error instanceof QuotaExceededError) {
    return res.status(402).json({
      error: "Token 额度不足",
      availableTokens: error.available,
      requiredTokens: error.required
    });
  }
  if (error.statusCode) {
    return res.status(error.statusCode).json({ error: error.message, code: error.code || "request_failed" });
  }
  console.error(error);
  res.status(500).json({ error: "Internal server error" });
});

initializeTokenLedger()
  .then(() => releaseExpiredReservations())
  .then(() => ensureSchema())
  .then(async () => {
    await write(
      'MATCH (j:IngestJob {status: "processing"}) SET j.status = "queued", j.updatedAt = $timestamp',
      { timestamp: now() }
    );
    await write(
      'MATCH (j:EmbeddingJob {status: "processing"}) SET j.status = "queued", j.updatedAt = $timestamp',
      { timestamp: now() }
    );
    const queuedJobs = await read('MATCH (j:IngestJob {status: "queued"}) RETURN j.id AS id ORDER BY j.createdAt');
    const queuedEmbeddingJobs = await read('MATCH (j:EmbeddingJob {status: "queued"}) RETURN j.id AS id ORDER BY j.createdAt');
    app.listen(port, () => {
      console.log(`SuperBrain API listening on http://localhost:${port}`);
      const reservationTimer = setInterval(() => {
        releaseExpiredReservations().catch((error) => console.error("Reservation cleanup failed", error));
      }, 60000);
      reservationTimer.unref();
      queuedJobs.forEach((record) => scheduleIngestJob(record.get("id")));
      queuedEmbeddingJobs.forEach((record) => scheduleEmbeddingJob(record.get("id")));
    });
  })
  .catch((error) => {
    console.error("Failed to initialize database", error);
    process.exit(1);
  });

process.on("SIGTERM", async () => {
  await Promise.all([closeDriver(), closeTokenLedger()]);
  process.exit(0);
});

import crypto from "node:crypto";
import { read, write } from "./db.js";

const appSecret = process.env.APP_SECRET || "dev-secret-change-me";
const tokenTtlSeconds = Number(process.env.SESSION_TTL_SECONDS || 60 * 60 * 24 * 7);

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(value) {
  return crypto.createHmac("sha256", appSecret).update(value).digest("base64url");
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 210000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const candidate = hashPassword(password, salt).split(":")[1];
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
}

export function createSessionToken(user) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    sub: user.id,
    email: user.email,
    role: user.role,
    displayName: user.displayName,
    exp: Math.floor(Date.now() / 1000) + tokenTtlSeconds
  }));
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign(unsigned)}`;
}

export function verifySessionToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const unsigned = `${header}.${payload}`;
  const expected = sign(unsigned);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims;
}

export function encryptSecret(secret) {
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash("sha256").update(appSecret).digest();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(value) {
  if (!value) return "";
  const [ivText, tagText, encryptedText] = value.split(".");
  const key = crypto.createHash("sha256").update(appSecret).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function userFromNode(node) {
  const props = node.properties;
  return {
    id: props.id,
    email: props.email,
    displayName: props.displayName || props.email,
    avatarUrl: props.avatarUrl || "",
    role: props.role || "member",
    emailVerified: props.emailVerified !== false,
    createdVia: props.createdVia || "legacy",
    createdById: props.createdById || "",
    hasOpenAiKey: Boolean(props.openAiKeyCipher),
    createdAt: props.createdAt,
    updatedAt: props.updatedAt
  };
}

export async function ensureAdminUser() {
  const timestamp = new Date().toISOString();
  const adminEmail = process.env.ADMIN_EMAIL || "admin@ryewonderchild.com";
  const adminPassword = process.env.ADMIN_PASSWORD || "ChangeMeNow_2026!";
  const adminId = process.env.ADMIN_USER_ID || "admin";
  await write("CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE");
  await write("CREATE CONSTRAINT user_email IF NOT EXISTS FOR (u:User) REQUIRE u.email IS UNIQUE");
  await write(
    `
    MERGE (u:User {id: $adminId})
    ON CREATE SET u.email = $adminEmail,
                  u.displayName = "Admin",
                  u.avatarUrl = "",
                  u.passwordHash = $passwordHash,
                  u.role = "admin",
                  u.emailVerified = true,
                  u.createdVia = "system",
                  u.createdAt = $timestamp
    SET u.emailVerified = true,
        u.updatedAt = coalesce(u.updatedAt, $timestamp)
    `,
    { adminId, adminEmail, passwordHash: hashPassword(adminPassword), timestamp }
  );
  await write("MATCH (n:KnowledgeItem) WHERE n.ownerId IS NULL SET n.ownerId = $adminId", { adminId });
  await write("MATCH ()-[r:RELATED_TO]->() WHERE r.ownerId IS NULL SET r.ownerId = $adminId", { adminId });
  return { id: adminId, email: adminEmail };
}

export async function getUserByEmail(email) {
  const records = await read("MATCH (u:User {email: $email}) RETURN u", { email });
  return records[0]?.get("u") || null;
}

export async function getUserById(id) {
  const records = await read("MATCH (u:User {id: $id}) RETURN u", { id });
  return records[0]?.get("u") || null;
}

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const claims = verifySessionToken(token);
    if (!claims) return res.status(401).json({ error: "Unauthorized" });
    const userNode = await getUserById(claims.sub);
    if (!userNode) return res.status(401).json({ error: "Unauthorized" });
    req.user = userFromNode(userNode);
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}

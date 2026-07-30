import crypto from "node:crypto";
import { closeDriver, write } from "../src/db.js";

const baseUrl = process.env.VERIFY_BASE_URL || "http://localhost:4000";
const temporaryUserId = `verify-${crypto.randomUUID()}`;
const temporaryEmail = `${temporaryUserId}@example.com`;
const verificationToken = crypto.randomBytes(32).toString("base64url");
const verificationTokenHash = crypto.createHash("sha256").update(verificationToken).digest("hex");
let sessionToken = "";
let profileId = "";

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {})
    },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${response.status} ${payload.error || ""}`);
  return payload;
}

try {
  const login = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD
    })
  });
  sessionToken = login.token;

  const created = await request("/api/model-profiles", {
    method: "POST",
    body: JSON.stringify({
      label: "GPT-5.6 Sol verification",
      protocol: "openai-compatible",
      baseUrl: "https://api.openai.com",
      model: "gpt-5.6-sol",
      apiKey: "verification-only-key",
      autoConfigure: true
    })
  });
  profileId = created.profile.id;
  if (
    created.profile.apiMode !== "responses"
    || created.profile.contextWindow !== 1_050_000
    || created.profile.promptBudgetTokens !== 128_000
    || created.profile.maxOutputTokens !== 16_384
  ) {
    throw new Error(`Unexpected Sol profile: ${JSON.stringify(created.profile)}`);
  }

  await write(
    `
    CREATE (:User {
      id: $id,
      email: $email,
      displayName: "Verification",
      passwordHash: "unused",
      role: "member",
      emailVerified: false,
      verificationTokenHash: $verificationTokenHash,
      verificationExpiresAt: $verificationExpiresAt,
      createdAt: $timestamp,
      updatedAt: $timestamp
    })
    `,
    {
      id: temporaryUserId,
      email: temporaryEmail,
      verificationTokenHash,
      verificationExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      timestamp: new Date().toISOString()
    }
  );
  sessionToken = "";
  const verified = await request("/api/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ token: verificationToken })
  });
  if (!verified.token || verified.user.emailVerified !== true) {
    throw new Error("Email verification did not activate the user");
  }

  console.log(JSON.stringify({
    solProfile: {
      apiMode: created.profile.apiMode,
      contextWindow: created.profile.contextWindow,
      promptBudgetTokens: created.profile.promptBudgetTokens,
      maxOutputTokens: created.profile.maxOutputTokens
    },
    emailVerification: "passed"
  }));
} finally {
  if (profileId) {
    await write("MATCH (p:ModelProfile {id: $profileId}) DETACH DELETE p", { profileId });
  }
  await write("MATCH (u:User {id: $temporaryUserId}) DETACH DELETE u", { temporaryUserId });
  await closeDriver();
}

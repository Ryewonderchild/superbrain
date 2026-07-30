import crypto from "node:crypto";
import pg from "pg";
import { createClient } from "redis";

const { Pool } = pg;
const defaultMonthlyQuota = Number(process.env.DEFAULT_MONTHLY_TOKEN_QUOTA || 1000000);
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || "postgres://superbrain:superbrain@localhost:5432/superbrain",
  max: Number(process.env.POSTGRES_POOL_SIZE || 10)
});
const redis = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });
redis.on("error", (error) => console.error("Redis error", error.message));

export class QuotaExceededError extends Error {
  constructor(available, required) {
    super(`Token quota insufficient: ${available} available, ${required} required`);
    this.name = "QuotaExceededError";
    this.available = available;
    this.required = required;
    this.statusCode = 402;
  }
}

function nextMonth() {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

export async function initializeTokenLedger() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS token_accounts (
      user_id TEXT PRIMARY KEY,
      monthly_quota BIGINT NOT NULL CHECK (monthly_quota >= 0),
      consumed_tokens BIGINT NOT NULL DEFAULT 0 CHECK (consumed_tokens >= 0),
      reserved_tokens BIGINT NOT NULL DEFAULT 0 CHECK (reserved_tokens >= 0),
      reset_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS token_reservations (
      id UUID PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES token_accounts(user_id),
      workspace_id TEXT,
      operation TEXT NOT NULL,
      model TEXT NOT NULL,
      reserved_tokens BIGINT NOT NULL CHECK (reserved_tokens > 0),
      status TEXT NOT NULL CHECK (status IN ('reserved', 'settled', 'released')),
      request_id TEXT UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      settled_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS token_usage_events (
      id UUID PRIMARY KEY,
      reservation_id UUID NOT NULL UNIQUE REFERENCES token_reservations(id),
      user_id TEXT NOT NULL,
      workspace_id TEXT,
      operation TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens BIGINT NOT NULL DEFAULT 0,
      output_tokens BIGINT NOT NULL DEFAULT 0,
      cached_tokens BIGINT NOT NULL DEFAULT 0,
      cache_miss_tokens BIGINT NOT NULL DEFAULT 0,
      reasoning_tokens BIGINT NOT NULL DEFAULT 0,
      estimated_cost NUMERIC(18, 8),
      actual_cost NUMERIC(18, 8),
      request_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS token_usage_user_created_idx
      ON token_usage_events(user_id, created_at DESC);
    ALTER TABLE token_usage_events
      ADD COLUMN IF NOT EXISTS cache_miss_tokens BIGINT NOT NULL DEFAULT 0;
    CREATE INDEX IF NOT EXISTS token_reservation_expiry_idx
      ON token_reservations(status, expires_at);
    CREATE OR REPLACE FUNCTION reject_token_usage_mutation()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'token_usage_events is append-only';
    END;
    $$;
    DROP TRIGGER IF EXISTS token_usage_events_immutable ON token_usage_events;
    CREATE TRIGGER token_usage_events_immutable
      BEFORE UPDATE OR DELETE ON token_usage_events
      FOR EACH ROW EXECUTE FUNCTION reject_token_usage_mutation();
  `);
  if (!redis.isOpen) await redis.connect();
}

export async function checkTokenLedger() {
  await pool.query("SELECT 1");
  if (!redis.isOpen) await redis.connect();
  const pong = await redis.ping();
  return { postgres: "ok", redis: pong === "PONG" ? "ok" : "error" };
}

export async function ensureTokenAccount(userId, monthlyQuota = defaultMonthlyQuota) {
  await pool.query(
    `INSERT INTO token_accounts(user_id, monthly_quota, reset_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, monthlyQuota, nextMonth()]
  );
}

async function resetIfDue(client, userId) {
  await client.query(
    `UPDATE token_accounts
     SET consumed_tokens = 0, reserved_tokens = 0, reset_at = $2, updated_at = now()
     WHERE user_id = $1 AND reset_at <= now()`,
    [userId, nextMonth()]
  );
}

export async function reserveTokens({
  userId,
  workspaceId = null,
  operation,
  model,
  tokens,
  requestId = crypto.randomUUID(),
  ttlSeconds = 600
}) {
  const amount = Math.max(1, Math.ceil(tokens));
  await ensureTokenAccount(userId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await resetIfDue(client, userId);
    const accountResult = await client.query(
      "SELECT * FROM token_accounts WHERE user_id = $1 FOR UPDATE",
      [userId]
    );
    const account = accountResult.rows[0];
    const available = Number(account.monthly_quota) - Number(account.consumed_tokens) - Number(account.reserved_tokens);
    if (available < amount) throw new QuotaExceededError(available, amount);
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO token_reservations
       (id, user_id, workspace_id, operation, model, reserved_tokens, status, request_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'reserved', $7, now() + ($8 * interval '1 second'))`,
      [id, userId, workspaceId, operation, model, amount, requestId, ttlSeconds]
    );
    await client.query(
      "UPDATE token_accounts SET reserved_tokens = reserved_tokens + $2, updated_at = now() WHERE user_id = $1",
      [userId, amount]
    );
    await client.query("COMMIT");
    await redis.set(`token-reservation:${id}`, String(amount), { EX: ttlSeconds });
    return { id, requestId, reservedTokens: amount };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function settleTokens(reservationId, usage = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT * FROM token_reservations WHERE id = $1 FOR UPDATE",
      [reservationId]
    );
    const reservation = result.rows[0];
    if (!reservation) throw new Error("Token reservation not found");
    if (reservation.status !== "reserved") {
      await client.query("ROLLBACK");
      return { settled: false, status: reservation.status };
    }
    const inputTokens = Math.max(0, Number(usage.inputTokens || 0));
    const outputTokens = Math.max(0, Number(usage.outputTokens || 0));
    const actualTokens = inputTokens + outputTokens;
    await client.query(
      `UPDATE token_accounts
       SET reserved_tokens = GREATEST(0, reserved_tokens - $2),
           consumed_tokens = consumed_tokens + $3,
           updated_at = now()
       WHERE user_id = $1`,
      [reservation.user_id, reservation.reserved_tokens, actualTokens]
    );
    await client.query(
      "UPDATE token_reservations SET status = 'settled', settled_at = now() WHERE id = $1",
      [reservationId]
    );
    await client.query(
      `INSERT INTO token_usage_events
       (id, reservation_id, user_id, workspace_id, operation, model,
        input_tokens, output_tokens, cached_tokens, cache_miss_tokens, reasoning_tokens,
        estimated_cost, actual_cost, request_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        crypto.randomUUID(), reservationId, reservation.user_id, reservation.workspace_id,
        reservation.operation, reservation.model, inputTokens, outputTokens,
        Math.max(0, Number(usage.cachedTokens || 0)),
        Math.max(0, Number(usage.cacheMissTokens ?? inputTokens - Number(usage.cachedTokens || 0))),
        Math.max(0, Number(usage.reasoningTokens || 0)),
        usage.estimatedCost ?? null, usage.actualCost ?? null, reservation.request_id
      ]
    );
    await client.query("COMMIT");
    await redis.del(`token-reservation:${reservationId}`);
    return {
      settled: true,
      reservedTokens: Number(reservation.reserved_tokens),
      actualTokens,
      returnedTokens: Math.max(0, Number(reservation.reserved_tokens) - actualTokens)
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function releaseTokens(reservationId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT * FROM token_reservations WHERE id = $1 FOR UPDATE",
      [reservationId]
    );
    const reservation = result.rows[0];
    if (!reservation || reservation.status !== "reserved") {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(
      "UPDATE token_accounts SET reserved_tokens = GREATEST(0, reserved_tokens - $2), updated_at = now() WHERE user_id = $1",
      [reservation.user_id, reservation.reserved_tokens]
    );
    await client.query(
      "UPDATE token_reservations SET status = 'released', settled_at = now() WHERE id = $1",
      [reservationId]
    );
    await client.query("COMMIT");
    await redis.del(`token-reservation:${reservationId}`);
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getTokenAccount(userId) {
  await ensureTokenAccount(userId);
  const result = await pool.query(
    `SELECT user_id, monthly_quota, consumed_tokens, reserved_tokens, reset_at,
            monthly_quota - consumed_tokens - reserved_tokens AS available_tokens
     FROM token_accounts WHERE user_id = $1`,
    [userId]
  );
  const row = result.rows[0];
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    /quota|tokens/.test(key) ? Number(value) : value
  ]));
}

export async function listTokenUsage(userId, limit = 100) {
  const result = await pool.query(
    `SELECT * FROM token_usage_events WHERE user_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [userId, Math.min(500, Math.max(1, limit))]
  );
  return result.rows;
}

export async function releaseExpiredReservations() {
  const result = await pool.query(
    "SELECT id FROM token_reservations WHERE status = 'reserved' AND expires_at <= now() LIMIT 500"
  );
  for (const row of result.rows) await releaseTokens(row.id);
  return result.rowCount;
}

export async function closeTokenLedger() {
  if (redis.isOpen) await redis.quit();
  await pool.end();
}

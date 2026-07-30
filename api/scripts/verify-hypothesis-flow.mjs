import crypto from "node:crypto";
import { closeDriver, read, write } from "../src/db.js";
import { createSessionToken, userFromNode } from "../src/auth.js";

const apiBase = `http://127.0.0.1:${process.env.API_PORT || 4000}`;
const adminId = process.env.ADMIN_USER_ID || "admin";
const marker = `SB_HYPOTHESIS_VERIFY_${crypto.randomUUID()}`;
const factId = crypto.randomUUID();
let hypothesisId = "";
let axiomId = "";

async function api(path, token, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers
    }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(payload)}`);
  return payload;
}

try {
  const users = await read("MATCH (u:User {id: $adminId}) RETURN u", { adminId });
  const user = userFromNode(users[0].get("u"));
  const token = createSessionToken(user);
  const timestamp = new Date().toISOString();
  await write(
    `
    CREATE (:PublicFact {
      id: $id,
      title: $marker,
      statement: "隔离验收事实可以支持一个待验证假设。",
      evidence: "该事实只在验收期间存在。",
      confidence: 1.0,
      status: "published",
      sourceTitle: $marker,
      authorId: $adminId,
      authorName: "System",
      createdAt: $timestamp,
      updatedAt: $timestamp
    })
    `,
    { id: factId, marker, adminId, timestamp }
  );

  const created = await api("/api/hypotheses", token, {
    method: "POST",
    body: JSON.stringify({
      title: marker,
      claim: "有证据边界的假设能够被独立验证后再提升为公理。",
      rationale: "前提事实与待验证结论被不同节点类型表示。",
      alternativeExplanation: "也可以仅通过状态字段区分，但边界较弱。",
      falsificationCriteria: "如果假设可以在没有任何公共事实时提升，则该假设失败。",
      confidence: 0.8,
      publicFactIds: [factId],
      challengeFactIds: []
    })
  });
  hypothesisId = created.hypothesis.id;
  const supported = await api(`/api/hypotheses/${hypothesisId}/status`, token, {
    method: "PATCH",
    body: JSON.stringify({ status: "supported" })
  });
  const promoted = await api(`/api/hypotheses/${hypothesisId}/promote`, token, {
    method: "POST",
    body: JSON.stringify({})
  });
  axiomId = promoted.axiom.id;
  const detail = await api(`/api/hypotheses/${hypothesisId}`, token);
  const relationRecords = await read(
    `
    MATCH (h:Hypothesis {id: $hypothesisId})-[:BASED_ON]->(f:PublicFact {id: $factId})
    MATCH (h)-[:PROMOTED_TO]->(a:Axiom {id: $axiomId})-[:SUPPORTED_BY]->(f)
    RETURN count(*) AS count
    `,
    { hypothesisId, factId, axiomId }
  );
  const result = {
    createdStatus: created.hypothesis.status,
    reviewedStatus: supported.hypothesis.status,
    finalStatus: detail.hypothesis.status,
    premiseCount: detail.premises.length,
    promotedAxiom: detail.axiom?.id === axiomId,
    completeRelationChain: relationRecords[0].get("count").toNumber() === 1
  };
  if (
    result.createdStatus !== "proposed"
    || result.reviewedStatus !== "supported"
    || result.finalStatus !== "promoted"
    || result.premiseCount !== 1
    || !result.promotedAxiom
    || !result.completeRelationChain
  ) {
    throw new Error(`Hypothesis flow verification failed: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result));
} finally {
  await write(
    `
    MATCH (event:AuditEvent)
    WHERE event.entityId IN $ids
    DETACH DELETE event
    `,
    { ids: [hypothesisId, axiomId].filter(Boolean) }
  );
  await write(
    `
    MATCH (node)
    WHERE node.id IN $ids
    DETACH DELETE node
    `,
    { ids: [factId, hypothesisId, axiomId].filter(Boolean) }
  );
  await closeDriver();
}

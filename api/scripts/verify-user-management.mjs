import crypto from "node:crypto";
import { closeDriver, read, write } from "../src/db.js";
import { createSessionToken, hashPassword, userFromNode } from "../src/auth.js";

const apiBase = `http://127.0.0.1:${process.env.API_PORT || 4000}`;
const adminId = process.env.ADMIN_USER_ID || "admin";
const targetId = crypto.randomUUID();
const publicId = crypto.randomUUID();
const privateId = crypto.randomUUID();

try {
  const adminRecords = await read("MATCH (u:User {id: $adminId}) RETURN u", { adminId });
  if (!adminRecords.length) throw new Error("Admin user not found");
  const admin = userFromNode(adminRecords[0].get("u"));
  const timestamp = new Date().toISOString();

  await write(
    `
    CREATE (:User {
      id: $targetId,
      email: $email,
      displayName: "User Management Verifier",
      avatarUrl: "",
      passwordHash: $passwordHash,
      role: "member",
      createdVia: "admin",
      createdById: $adminId,
      createdAt: $timestamp,
      updatedAt: $timestamp
    })
    CREATE (:KnowledgeItem {
      id: $privateId,
      ownerId: $targetId,
      title: "Temporary private item",
      kind: "Concept",
      createdAt: $timestamp,
      updatedAt: $timestamp
    })
    CREATE (:Axiom {
      id: $publicId,
      authorId: $targetId,
      authorName: "User Management Verifier",
      title: "Temporary public axiom",
      statement: "Temporary verification statement",
      status: "observing",
      createdAt: $timestamp,
      updatedAt: $timestamp
    })
    `,
    {
      targetId,
      privateId,
      publicId,
      adminId,
      email: `user-management-${targetId}@example.com`,
      passwordHash: hashPassword("user-management-verifier-password"),
      timestamp
    }
  );

  const headers = { Authorization: `Bearer ${createSessionToken(admin)}` };
  const listResponse = await fetch(`${apiBase}/api/auth/users`, { headers });
  const list = await listResponse.json();
  const listedUser = list.users?.find((user) => user.id === targetId);
  if (!listResponse.ok || !listedUser?.canDelete) {
    throw new Error(`User list verification failed: ${JSON.stringify(list)}`);
  }

  const deleteResponse = await fetch(`${apiBase}/api/auth/users/${targetId}`, {
    method: "DELETE",
    headers
  });
  const deleted = await deleteResponse.json();
  if (!deleteResponse.ok) throw new Error(`User deletion failed: ${JSON.stringify(deleted)}`);

  const state = await read(
    `
    OPTIONAL MATCH (u:User {id: $targetId})
    OPTIONAL MATCH (privateNode {ownerId: $targetId})
    OPTIONAL MATCH (publicNode:Axiom {id: $publicId})
    RETURN count(DISTINCT u) AS users,
           count(DISTINCT privateNode) AS privateNodes,
           publicNode.authorId AS publicAuthorId,
           publicNode.authorName AS publicAuthorName
    `,
    { targetId, publicId }
  );
  const record = state[0];
  const result = {
    listed: true,
    deletable: listedUser.canDelete,
    usersRemaining: record.get("users").toNumber(),
    privateNodesRemaining: record.get("privateNodes").toNumber(),
    publicAuthorId: record.get("publicAuthorId"),
    publicAuthorName: record.get("publicAuthorName")
  };
  if (
    result.usersRemaining !== 0
    || result.privateNodesRemaining !== 0
    || result.publicAuthorId !== ""
    || result.publicAuthorName !== "已删除用户"
  ) {
    throw new Error(`User deletion state failed: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result));
} finally {
  await write("MATCH (n) WHERE n.id IN [$targetId, $privateId, $publicId] DETACH DELETE n", {
    targetId,
    privateId,
    publicId
  });
  await closeDriver();
}

import { unlink } from "node:fs/promises";
import { read, write } from "../src/db.js";
import { ensureDefaultWorkspace } from "../src/notes.js";

const adminId = process.env.ADMIN_USER_ID || "admin";
const assets = await read(
  "MATCH (a:SourceAsset {ownerId: $adminId}) RETURN a.storagePath AS storagePath",
  { adminId }
);

for (const record of assets) {
  const storagePath = record.get("storagePath");
  if (storagePath) await unlink(storagePath).catch(() => {});
}

await write(
  `
  MATCH (n {ownerId: $adminId})
  WHERE NOT n:User AND NOT n:ModelProfile
  DETACH DELETE n
  `,
  { adminId }
);
await ensureDefaultWorkspace(adminId);

await import("./rebuild-public-system-seed.mjs");

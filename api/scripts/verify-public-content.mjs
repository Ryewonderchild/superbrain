import { closeDriver, read } from "../src/db.js";
import { createSessionToken, userFromNode } from "../src/auth.js";

const apiBase = `http://127.0.0.1:${process.env.API_PORT || 4000}`;
const adminId = process.env.ADMIN_USER_ID || "admin";
const users = await read("MATCH (u:User {id: $adminId}) RETURN u", { adminId });
if (!users.length) throw new Error("Admin user not found");
const user = userFromNode(users[0].get("u"));
const headers = { Authorization: `Bearer ${createSessionToken(user)}` };

try {
  const graphResponse = await fetch(`${apiBase}/api/public/graph`, { headers });
  const graph = await graphResponse.json();
  if (!graphResponse.ok) throw new Error(`Public graph failed: ${JSON.stringify(graph)}`);
  const publicEntities = graph.nodes.filter((node) => node.publicEntity);
  const superbrain = publicEntities.find((node) => node.publicEntity.canonicalKey === "superbrain");
  const publicFacts = graph.nodes.filter((node) => node.kind === "PublicFact");
  const hypotheses = graph.nodes.filter((node) => node.kind === "Hypothesis");
  const axioms = graph.nodes.filter((node) => node.kind === "Axiom" && node.axiom?.sourceTitle === "超级大脑代码库");
  const supportedBy = graph.links.filter((link) => link.type === "SUPPORTED_BY");
  const entityIds = new Set(publicEntities.map((entity) => entity.id));
  const entityRelationships = graph.links.filter((link) => entityIds.has(link.sourceId) && entityIds.has(link.targetId));
  const about = graph.links.filter((link) => link.type === "ABOUT");
  const superbrainConnections = graph.links.filter(
    (link) => link.sourceId === superbrain?.id || link.targetId === superbrain?.id
  );
  const describedSuperbrainRelations = superbrainConnections.filter(
    (link) => link.type !== "ABOUT" && link.description && link.evidenceFactId
  );
  const basedOn = graph.links.filter((link) => link.type === "BASED_ON");

  const axiomResponse = await fetch(`${apiBase}/api/axioms/${axioms[0]?.id}`, { headers });
  const axiomDetail = await axiomResponse.json();
  const hypothesisResponse = await fetch(`${apiBase}/api/hypotheses/${hypotheses[0]?.id}`, { headers });
  const hypothesisDetail = await hypothesisResponse.json();
  const semanticResponse = await fetch(`${apiBase}/api/semantic-model`, { headers });
  const semanticModel = await semanticResponse.json();
  const privateRecords = await read(
    `
    MATCH (n {ownerId: $adminId})
    WHERE NOT n:User AND NOT n:ModelProfile AND NOT n:Workspace
    RETURN count(n) AS count
    `,
    { adminId }
  );
  const result = {
    publicEntities: publicEntities.length,
    publicFacts: publicFacts.length,
    hypotheses: hypotheses.length,
    axioms: axioms.length,
    supportedBy: supportedBy.length,
    entityRelationships: entityRelationships.length,
    about: about.length,
    superbrainConnections: superbrainConnections.length,
    describedSuperbrainRelations: describedSuperbrainRelations.length,
    basedOn: basedOn.length,
    detailFacts: axiomDetail.facts?.length || 0,
    hypothesisPremises: hypothesisDetail.premises?.length || 0,
    semanticTypes: semanticModel.types?.length || 0,
    adminPrivateContent: privateRecords[0].get("count").toNumber()
  };
  if (
    result.publicEntities !== 12
    || result.publicFacts !== 8
    || result.hypotheses !== 2
    || result.axioms !== 2
    || result.supportedBy !== 3
    || result.entityRelationships !== 14
    || result.about !== 24
    || result.superbrainConnections !== 9
    || result.describedSuperbrainRelations !== 6
    || result.basedOn !== 3
    || result.detailFacts < 1
    || result.hypothesisPremises < 1
    || result.semanticTypes !== 12
    || result.adminPrivateContent !== 0
  ) {
    throw new Error(`Public content verification failed: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result));
} finally {
  await closeDriver();
}

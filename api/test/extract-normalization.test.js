import assert from "node:assert/strict";
import test from "node:test";
import { normalizeExtractionGraph } from "../src/extract.js";

function validNode() {
  return {
    title: "超级大脑",
    kind: "System",
    summary: "知识管理系统",
    evidence: "超级大脑是知识管理系统。",
    attributes: [],
    tags: []
  };
}

test("isolates an incomplete relation without losing valid entities and facts", () => {
  const result = normalizeExtractionGraph({
    nodes: [validNode()],
    facts: [{
      statement: "超级大脑是知识管理系统。",
      evidence: "超级大脑是知识管理系统。",
      confidence: "0.9",
      entityTitles: ["超级大脑"]
    }],
    links: [{
      sourceTitle: "超级大脑",
      targetTitle: null
    }]
  });
  assert.equal(result.graph.nodes.length, 1);
  assert.equal(result.graph.facts.length, 1);
  assert.equal(result.graph.facts[0].confidence, 0.9);
  assert.equal(result.graph.links.length, 0);
  assert.equal(result.issues[0].code, "MALFORMED_MODEL_RELATION_DROPPED");
  assert.equal(result.issues[0].path, "modelOutput.links[0]");
});

test("repairs nullable optional fields but keeps semantic validation strict", () => {
  const result = normalizeExtractionGraph({
    nodes: [{
      ...validNode(),
      summary: null,
      evidence: null,
      attributes: null,
      tags: null
    }],
    links: [],
    facts: []
  });
  assert.equal(result.issues.length, 0);
  assert.equal(result.graph.nodes[0].summary, "");
  assert.equal(result.graph.nodes[0].evidence, "");
  assert.deepEqual(result.graph.nodes[0].attributes, []);
});

test("isolates malformed top-level collections", () => {
  const result = normalizeExtractionGraph({
    nodes: [validNode()],
    links: { sourceTitle: "bad" },
    facts: null
  });
  assert.equal(result.graph.nodes.length, 1);
  assert.deepEqual(result.graph.links, []);
  assert.equal(result.issues[0].path, "modelOutput.links");
});

test("folds reified descriptions into their ontology entity", () => {
  const result = normalizeExtractionGraph({
    nodes: [
      {
        ...validNode(),
        title: "内在价值",
        summary: "一种价值概念。"
      },
      {
        ...validNode(),
        title: "内在价值的描述",
        summary: "资产未来现金流折现后的估计价值。",
        tags: ["估值"]
      }
    ],
    facts: [{
      statement: "内在价值是一种估计价值。",
      evidence: "内在价值是一种估计价值。",
      entityTitles: ["内在价值的描述"]
    }],
    links: [{
      sourceTitle: "内在价值的描述",
      targetTitle: "内在价值",
      type: "DESCRIBES",
      note: "描述该概念",
      evidence: "内在价值是一种估计价值。"
    }]
  });

  assert.equal(result.graph.nodes.length, 1);
  assert.equal(result.graph.nodes[0].title, "内在价值");
  assert.match(result.graph.nodes[0].summary, /资产未来现金流/);
  assert.deepEqual(result.graph.facts[0].entityTitles, ["内在价值"]);
  assert.equal(result.graph.links.length, 0);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  attributesToProperties,
  compileKnowledgeDraft,
  discardInvalidKnowledgeParts
} from "../src/knowledge-compiler.js";

const sourceText = "DeepSeek V4 Pro 支持一百万 Token 上下文。超级大脑使用 DeepSeek V4 Pro 进行知识问答。";

function validGraph() {
  return {
    nodes: [
      {
        title: "DeepSeek V4 Pro",
        kind: "Model",
        summary: "用于模型推理的 DeepSeek 模型。",
        content: "",
        tags: [],
        source: "",
        evidence: "DeepSeek V4 Pro 支持一百万 Token 上下文。",
        attributes: [{
          key: "contextWindow",
          value: "1000000",
          evidence: "DeepSeek V4 Pro 支持一百万 Token 上下文。"
        }]
      },
      {
        title: "超级大脑",
        kind: "System",
        summary: "知识管理系统。",
        content: "",
        tags: [],
        source: "",
        evidence: "超级大脑使用 DeepSeek V4 Pro 进行知识问答。",
        attributes: []
      }
    ],
    facts: [{
      statement: "DeepSeek V4 Pro 支持一百万 Token 上下文。",
      evidence: "DeepSeek V4 Pro 支持一百万 Token 上下文。",
      confidence: 0.98,
      entityTitles: ["DeepSeek V4 Pro"]
    }],
    links: [{
      sourceTitle: "超级大脑",
      targetTitle: "DeepSeek V4 Pro",
      type: "USES_MODEL",
      note: "超级大脑使用该模型进行知识问答。",
      evidence: "超级大脑使用 DeepSeek V4 Pro 进行知识问答。"
    }]
  };
}

test("accepts a fully evidenced knowledge draft", () => {
  const result = compileKnowledgeDraft({ graph: validGraph(), sourceText });
  assert.equal(result.workflow.status, "ready");
  assert.equal(result.workflow.stats.errors, 0);
  assert.deepEqual(attributesToProperties(result.graph.nodes[0].attributes), {
    contextWindow: "1000000"
  });
});

test("accepts research citations and omitted spans when every quoted segment exists", () => {
  const sourceText = [
    "中国共产主义青年团是中国共产党领导的先进青年的群团组织。",
    "中国共产主义青年团是中国共产党的助手和后备军。"
  ].join("\n");
  const graph = {
    nodes: [{
      title: "中国共产主义青年团",
      kind: "Organization",
      summary: "青年群团组织",
      content: "",
      tags: [],
      source: "research",
      evidence: "[W1] 中国共产主义青年团是中国共产党领导的先进青年的群团组织。…[W2] 中国共产主义青年团是中国共产党的助手和后备军。",
      attributes: []
    }],
    facts: [],
    links: []
  };

  const result = compileKnowledgeDraft({ graph, sourceText });

  assert.equal(result.workflow.status, "ready");
  assert.equal(result.workflow.issues.length, 0);
});

test("accepts Chinese attribute keys", () => {
  const graph = validGraph();
  graph.nodes[0].attributes[0].key = "核心组成";
  const result = compileKnowledgeDraft({ graph, sourceText });
  assert.equal(result.workflow.status, "ready");
  assert.deepEqual(attributesToProperties(result.graph.nodes[0].attributes), {
    核心组成: "1000000"
  });
});

test("blocks propositions disguised as entities and unsupported relationships", () => {
  const graph = validGraph();
  graph.nodes[0].kind = "Fact";
  graph.links[0].targetTitle = "不存在的实体";
  graph.links[0].note = "";
  graph.facts[0].statement = "DeepSeek V4 Pro 可能更适合知识问答。";
  const result = compileKnowledgeDraft({ graph, sourceText });
  assert.equal(result.workflow.status, "review_required");
  assert.ok(result.workflow.issues.some((entry) => entry.code === "INVALID_ENTITY_KIND"));
  assert.ok(result.workflow.issues.some((entry) => entry.code === "UNKNOWN_RELATION_TARGET"));
  assert.ok(result.workflow.issues.some((entry) => entry.code === "MISSING_RELATION_DESCRIPTION"));
  assert.ok(result.workflow.issues.some((entry) => entry.code === "FACT_LOOKS_LIKE_HYPOTHESIS"));
});

test("classifies judgment phrases as facts instead of entities", () => {
  const graph = validGraph();
  graph.nodes[0].title = "风险防范高于追求回报";
  const result = compileKnowledgeDraft({ graph, sourceText });
  assert.ok(result.workflow.issues.some((entry) => (
    entry.code === "PROPOSITION_AS_ENTITY"
    && entry.message.includes("应当作为 Fact")
  )));
});

test("rejects a description field reified as an entity", () => {
  const graph = validGraph();
  graph.nodes[0].title = "内在价值的描述";
  const result = compileKnowledgeDraft({ graph, sourceText });
  assert.ok(result.workflow.issues.some((entry) => entry.code === "REIFIED_DESCRIPTION_ENTITY"));
});

test("can discard invalid parts without retaining dangling references", () => {
  const graph = validGraph();
  graph.nodes[1].title = "风险防范高于追求回报";
  graph.links[0].sourceTitle = graph.nodes[1].title;
  const compiled = compileKnowledgeDraft({ graph, sourceText });
  const repaired = discardInvalidKnowledgeParts(compiled);
  assert.equal(repaired.discarded.nodes, 1);
  assert.equal(repaired.graph.nodes.length, 1);
  assert.equal(repaired.graph.links.length, 0);
});

test("does not expose reserved node fields as extracted attributes", () => {
  assert.deepEqual(attributesToProperties([
    { key: "ownerId", value: "attacker" },
    { key: "releaseYear", value: "2026" },
    { key: "核心组成", value: "八条线" },
    { key: "bad-key", value: "ignored" }
  ]), { releaseYear: "2026", 核心组成: "八条线" });
});

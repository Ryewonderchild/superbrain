import assert from "node:assert/strict";
import test from "node:test";
import {
  completeWithProfile,
  extractWithProfile,
  InvalidModelOutputError,
  parseJsonObject
} from "../src/providers.js";

async function withMockResponses(handler) {
  let received;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    received = { url: new URL(url).pathname, body: JSON.parse(options.body) };
    const output = received.body.text?.format
      ? JSON.stringify({ nodes: [], facts: [], links: [] })
      : "answer";
    return new Response(JSON.stringify({
      output_text: output,
      usage: {
        input_tokens: 120,
        output_tokens: 30,
        input_tokens_details: { cached_tokens: 20 },
        output_tokens_details: { reasoning_tokens: 10 }
      }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    await handler("https://api.openai.com");
    return received;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("GPT Sol-compatible profiles use Responses API parameters and usage", { concurrency: false }, async () => {
  let usage;
  const received = await withMockResponses(async (baseUrl) => {
    const answer = await completeWithProfile({
      profile: {
        protocol: "openai-compatible",
        apiMode: "responses",
        baseUrl,
        model: "gpt-5.6-sol",
        reasoningEffort: "xhigh",
        reasoningMode: "pro",
        textVerbosity: "high"
      },
      apiKey: "test-key",
      system: "system",
      user: "question",
      maxOutputTokens: 16384,
      providerUserId: "user@example.com",
      thinking: true,
      onUsage: (value) => { usage = value; }
    });
    assert.equal(answer, "answer");
  });
  assert.equal(received.url, "/v1/responses");
  assert.equal(received.body.max_output_tokens, 16384);
  assert.deepEqual(received.body.reasoning, { effort: "xhigh", mode: "pro" });
  assert.deepEqual(received.body.text, { verbosity: "high" });
  assert.equal(received.body.safety_identifier, "user-example-com");
  assert.equal(received.body.store, false);
  assert.deepEqual(usage, {
    inputTokens: 120,
    outputTokens: 30,
    cachedTokens: 20,
    cacheMissTokens: 100,
    reasoningTokens: 10
  });
});

test("Responses extraction requests strict structured output", { concurrency: false }, async () => {
  const received = await withMockResponses(async (baseUrl) => {
    const graph = await extractWithProfile({
      profile: {
        protocol: "openai-compatible",
        apiMode: "responses",
        baseUrl,
        model: "gpt-5.6-sol",
        maxOutputTokens: 16384
      },
      apiKey: "test-key",
      source: "test",
      text: "测试文本",
      providerUserId: "user-1"
    });
    assert.deepEqual(graph, { nodes: [], facts: [], links: [] });
  });
  assert.equal(received.body.max_output_tokens, 8192);
  assert.equal(received.body.reasoning.effort, "low");
  assert.equal(received.body.text.format.type, "json_schema");
  assert.equal(received.body.text.format.strict, true);
});

test("repairs common malformed model JSON without another model call", () => {
  assert.deepEqual(
    parseJsonObject('```json\n{"nodes":[{"title":"A" "kind":"Concept",}], "facts":[], "links":[]}\n```'),
    {
      nodes: [{ title: "A", kind: "Concept" }],
      facts: [],
      links: []
    }
  );
});

test("hides raw parser positions when model JSON cannot be repaired", () => {
  assert.throws(
    () => parseJsonObject("not json at all"),
    (error) => (
      error instanceof InvalidModelOutputError
      && error.code === "INVALID_MODEL_OUTPUT"
      && !/position \d+/i.test(error.message)
    )
  );
});

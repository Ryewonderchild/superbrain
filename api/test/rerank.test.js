import assert from "node:assert/strict";
import test from "node:test";
import { rerankWithProfile } from "../src/providers.js";

test("reranks candidates using the configured model", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          ranking: [
            { index: 1, score: 0.96 },
            { index: 0, score: 0.35 }
          ]
        })
      }
    }]
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  const candidates = [
    { chunkId: "a", documentTitle: "A", text: "unrelated" },
    { chunkId: "b", documentTitle: "B", text: "relevant" }
  ];
  const result = await rerankWithProfile({
    profile: {
      protocol: "openai-compatible",
      baseUrl: "https://provider.example",
      model: "chat",
      rerankModel: "reranker"
    },
    apiKey: "test-key",
    query: "relevant",
    candidates
  });

  assert.deepEqual(result.map((item) => item.chunkId), ["b", "a"]);
  assert.equal(result[0].rerankScore, 0.96);
});

test("disables thinking and isolates users for DeepSeek reranking", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"ranking":[{"index":0,"score":1},{"index":1,"score":0}]}' } }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_cache_hit_tokens: 80,
        prompt_cache_miss_tokens: 20
      }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  await rerankWithProfile({
    profile: {
      protocol: "openai-compatible",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro",
      rerankModel: "deepseek-v4-pro"
    },
    apiKey: "test-key",
    providerUserId: "user@example.com",
    query: "relevant",
    candidates: [
      { chunkId: "a", documentTitle: "A", text: "relevant" },
      { chunkId: "b", documentTitle: "B", text: "unrelated" }
    ]
  });

  assert.equal(requestBody.user_id, "user-example-com");
  assert.deepEqual(requestBody.thinking, { type: "disabled" });
  assert.equal(requestBody.reasoning_effort, undefined);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateModelCost,
  deepSeekRequestOptions,
  isGpt56SolProfile,
  isDeepSeekV4Profile,
  normalizeProviderUserId,
  resolveModelCapabilities,
  resolveRuntimeModelProfile
} from "../src/model-policy.js";

const profile = {
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-pro",
  reasoningEffort: "high"
};

test("recognizes only official DeepSeek V4 profiles", () => {
  assert.equal(isDeepSeekV4Profile(profile), true);
  assert.equal(isDeepSeekV4Profile({ ...profile, baseUrl: "https://proxy.example" }), false);
  assert.equal(isDeepSeekV4Profile({ ...profile, model: "deepseek-chat" }), false);
});

test("builds isolated DeepSeek thinking options", () => {
  assert.equal(normalizeProviderUserId("user@example.com"), "user-example-com");
  assert.deepEqual(deepSeekRequestOptions(profile, {
    userId: "user@example.com",
    thinking: true
  }), {
    user_id: "user-example-com",
    thinking: { type: "enabled" },
    reasoning_effort: "high"
  });
  assert.deepEqual(deepSeekRequestOptions(profile, { thinking: false }), {
    thinking: { type: "disabled" }
  });
});

test("calculates DSV4 Pro cost from cache hit, miss and output tokens", () => {
  const cost = calculateModelCost("deepseek-v4-pro", {
    inputTokens: 1_000_000,
    cachedTokens: 800_000,
    cacheMissTokens: 200_000,
    outputTokens: 100_000
  });
  assert.equal(cost, 0.1769);
  assert.equal(calculateModelCost("other-model", { inputTokens: 100 }), null);
});

test("recognizes and auto-configures official GPT-5.6 Sol", () => {
  const sol = {
    baseUrl: "https://api.openai.com",
    model: "gpt-5.6-sol",
    autoConfigure: true
  };
  assert.equal(isGpt56SolProfile(sol), true);
  assert.equal(isGpt56SolProfile({ ...sol, baseUrl: "https://proxy.example" }), false);
  assert.equal(resolveModelCapabilities(sol).contextWindow, 1_050_000);
  const runtime = resolveRuntimeModelProfile(sol);
  assert.equal(runtime.apiMode, "responses");
  assert.equal(runtime.promptBudgetTokens, 128_000);
  assert.equal(runtime.maxOutputTokens, 16_384);
});

test("applies GPT-5.6 Sol long-context pricing multiplier", () => {
  const normal = calculateModelCost("gpt-5.6-sol", {
    inputTokens: 200_000,
    cachedTokens: 100_000,
    outputTokens: 10_000
  });
  const long = calculateModelCost("gpt-5.6-sol", {
    inputTokens: 300_000,
    cachedTokens: 100_000,
    outputTokens: 10_000
  });
  assert.equal(normal, 0.85);
  assert.equal(long, 2.55);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createTokenBudget, estimateReservation, estimateTokens, selectWithinTokenBudget } from "../src/token-budget.js";

test("estimates CJK and ASCII tokens conservatively", () => {
  assert.equal(estimateTokens("知识图谱"), 4);
  assert.equal(estimateTokens("12345678"), 2);
});

test("reserves output and safety margins from prompt budget", () => {
  const budget = createTokenBudget({
    contextWindow: 1000,
    maxOutputTokens: 200,
    safetyTokens: 100,
    question: "12345678"
  });
  assert.equal(budget.promptLimit, 700);
  assert.equal(budget.retrievalTokens, 698);
});

test("keeps an explicit prompt budget separate from the model context window", () => {
  const budget = createTokenBudget({
    contextWindow: 1_050_000,
    promptBudgetTokens: 128_000,
    maxOutputTokens: 16_384,
    safetyTokens: 8_192
  });
  assert.equal(budget.promptLimit, 128_000);
  assert.equal(budget.retrievalTokens, 128_000);
});

test("selects complete chunks instead of truncating strings", () => {
  const result = selectWithinTokenBudget(
    [{ text: "a".repeat(40) }, { text: "b".repeat(400) }, { text: "c".repeat(40) }],
    25
  );
  assert.deepEqual(result.items.map((item) => item.text[0]), ["a", "c"]);
  assert.ok(estimateReservation({ input: "hello", maxOutputTokens: 10 }) >= 12);
});

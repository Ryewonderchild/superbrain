const DEFAULT_CONTEXT_WINDOW = 32000;
const DEFAULT_OUTPUT_TOKENS = 3000;
const DEFAULT_SAFETY_TOKENS = 3000;

export function estimateTokens(value) {
  const text = String(value || "");
  if (!text) return 0;
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const remainingBytes = Math.max(0, Buffer.byteLength(text, "utf8") - cjk * 3);
  return cjk + Math.ceil(remainingBytes / 4);
}

export function createTokenBudget({
  contextWindow = DEFAULT_CONTEXT_WINDOW,
  promptBudgetTokens = null,
  maxOutputTokens = DEFAULT_OUTPUT_TOKENS,
  safetyTokens = DEFAULT_SAFETY_TOKENS,
  system = "",
  history = "",
  question = ""
} = {}) {
  const fixed = estimateTokens(system) + estimateTokens(history) + estimateTokens(question);
  const contextPromptLimit = Math.max(0, contextWindow - maxOutputTokens - safetyTokens);
  const promptLimit = Math.min(
    contextPromptLimit,
    Math.max(0, Number(promptBudgetTokens ?? contextPromptLimit))
  );
  return {
    contextWindow,
    maxOutputTokens,
    safetyTokens,
    fixedTokens: fixed,
    promptLimit,
    retrievalTokens: Math.max(0, promptLimit - fixed)
  };
}

export function selectWithinTokenBudget(items, budget, {
  minItems = 0,
  maxItems = 12,
  text = (item) => item.text || ""
} = {}) {
  const selected = [];
  let usedTokens = 0;
  for (const item of items) {
    if (selected.length >= maxItems) break;
    const tokens = Math.max(1, estimateTokens(text(item)));
    if (selected.length >= minItems && usedTokens + tokens > budget) continue;
    if (usedTokens + tokens > budget && selected.length < minItems) {
      selected.push({ ...item, budgetTokens: tokens });
      usedTokens += tokens;
      continue;
    }
    selected.push({ ...item, budgetTokens: tokens });
    usedTokens += tokens;
  }
  return { items: selected, usedTokens, remainingTokens: Math.max(0, budget - usedTokens) };
}

export function estimateReservation({ input = "", maxOutputTokens = 0, multiplier = 1.15 } = {}) {
  return Math.max(1, Math.ceil((estimateTokens(input) + Number(maxOutputTokens || 0)) * multiplier));
}

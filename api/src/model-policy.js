const DEEPSEEK_V4_PRO_PRICING = {
  cacheHitInputPerMillion: 0.003625,
  cacheMissInputPerMillion: 0.435,
  outputPerMillion: 0.87
};
const GPT_56_SOL_PRICING = {
  inputPerMillion: 5,
  cachedInputPerMillion: 0.5,
  outputPerMillion: 30,
  longContextThreshold: 272000
};

const DEFAULT_CAPABILITIES = {
  contextWindow: 32000,
  promptBudgetTokens: 24000,
  maxOutputTokens: 3000,
  providerMaxOutputTokens: 3000,
  safetyTokens: 3000,
  apiMode: "chat",
  reasoningEffort: "none",
  reasoningMode: "standard",
  textVerbosity: "medium"
};

export function isDeepSeekV4Profile(profile = {}) {
  const model = String(profile.model || "").toLowerCase();
  const baseUrl = String(profile.baseUrl || "").toLowerCase();
  return model.startsWith("deepseek-v4") && baseUrl.includes("api.deepseek.com");
}

export function isGpt56SolProfile(profile = {}) {
  const model = String(profile.model || "").toLowerCase();
  const baseUrl = String(profile.baseUrl || "").toLowerCase();
  return ["gpt-5.6", "gpt-5.6-sol"].includes(model)
    && baseUrl.includes("api.openai.com");
}

export function resolveModelCapabilities(profile = {}) {
  if (isGpt56SolProfile(profile)) {
    return {
      contextWindow: 1050000,
      promptBudgetTokens: 128000,
      maxOutputTokens: 16384,
      providerMaxOutputTokens: 128000,
      safetyTokens: 8192,
      apiMode: "responses",
      reasoningEffort: "medium",
      reasoningMode: "standard",
      textVerbosity: "medium",
      longContextThreshold: GPT_56_SOL_PRICING.longContextThreshold
    };
  }
  if (isDeepSeekV4Profile(profile)) {
    return {
      contextWindow: 1000000,
      promptBudgetTokens: 32000,
      maxOutputTokens: 4096,
      providerMaxOutputTokens: 384000,
      safetyTokens: 4096,
      apiMode: "chat",
      reasoningEffort: "high",
      reasoningMode: "standard",
      textVerbosity: "medium",
      longContextThreshold: null
    };
  }
  return {
    ...DEFAULT_CAPABILITIES,
    longContextThreshold: null
  };
}

export function resolveRuntimeModelProfile(profile = {}) {
  const capabilities = resolveModelCapabilities(profile);
  const auto = profile.autoConfigure === true;
  const contextWindow = Math.min(
    capabilities.contextWindow,
    Math.max(4096, Number(auto ? capabilities.contextWindow : profile.contextWindow || capabilities.contextWindow))
  );
  const maxOutputTokens = Math.min(
    capabilities.providerMaxOutputTokens,
    Math.max(128, Number(auto ? capabilities.maxOutputTokens : profile.maxOutputTokens || capabilities.maxOutputTokens))
  );
  const safetyTokens = Math.max(
    2048,
    Number(profile.safetyTokens || capabilities.safetyTokens)
  );
  const maxPromptByContext = Math.max(0, contextWindow - maxOutputTokens - safetyTokens);
  const requestedPrompt = Number(
    auto ? capabilities.promptBudgetTokens : profile.promptBudgetTokens || capabilities.promptBudgetTokens
  );
  const promptBudgetTokens = Math.min(maxPromptByContext, Math.max(4096, requestedPrompt));
  return {
    ...profile,
    contextWindow,
    promptBudgetTokens,
    maxOutputTokens,
    safetyTokens,
    apiMode: auto ? capabilities.apiMode : profile.apiMode || capabilities.apiMode,
    reasoningEffort: profile.reasoningEffort || capabilities.reasoningEffort,
    reasoningMode: profile.reasoningMode || capabilities.reasoningMode,
    textVerbosity: profile.textVerbosity || capabilities.textVerbosity,
    providerMaxOutputTokens: capabilities.providerMaxOutputTokens,
    longContextThreshold: capabilities.longContextThreshold
  };
}

export function normalizeProviderUserId(userId) {
  return String(userId || "")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 512);
}

export function deepSeekRequestOptions(profile, {
  userId = "",
  thinking = false
} = {}) {
  if (!isDeepSeekV4Profile(profile)) return {};
  const normalizedUserId = normalizeProviderUserId(userId);
  return {
    ...(normalizedUserId ? { user_id: normalizedUserId } : {}),
    thinking: { type: thinking ? "enabled" : "disabled" },
    ...(thinking ? { reasoning_effort: profile.reasoningEffort || "high" } : {})
  };
}

export function calculateModelCost(model, usage = {}) {
  const normalizedModel = String(model || "").toLowerCase();
  const inputTokens = Math.max(0, Number(usage.inputTokens || 0));
  const cachedTokens = Math.min(inputTokens, Math.max(0, Number(usage.cachedTokens || 0)));
  const cacheMissTokens = Math.max(0, Number(usage.cacheMissTokens ?? inputTokens - cachedTokens));
  const outputTokens = Math.max(0, Number(usage.outputTokens || 0));
  if (["gpt-5.6", "gpt-5.6-sol"].includes(normalizedModel)) {
    const longContextMultiplier = inputTokens > GPT_56_SOL_PRICING.longContextThreshold ? 2 : 1;
    const outputMultiplier = inputTokens > GPT_56_SOL_PRICING.longContextThreshold ? 1.5 : 1;
    return (
      cachedTokens * GPT_56_SOL_PRICING.cachedInputPerMillion * longContextMultiplier
      + cacheMissTokens * GPT_56_SOL_PRICING.inputPerMillion * longContextMultiplier
      + outputTokens * GPT_56_SOL_PRICING.outputPerMillion * outputMultiplier
    ) / 1_000_000;
  }
  if (!normalizedModel.startsWith("deepseek-v4-pro")) return null;
  return (
    cachedTokens * DEEPSEEK_V4_PRO_PRICING.cacheHitInputPerMillion
    + cacheMissTokens * DEEPSEEK_V4_PRO_PRICING.cacheMissInputPerMillion
    + outputTokens * DEEPSEEK_V4_PRO_PRICING.outputPerMillion
  ) / 1_000_000;
}

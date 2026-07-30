import {
  deepSeekRequestOptions,
  isDeepSeekV4Profile,
  isGpt56SolProfile,
  normalizeProviderUserId
} from "./model-policy.js";
import { jsonrepair } from "jsonrepair";

export const graphJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    nodes: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          kind: { type: "string" },
          summary: { type: "string" },
          evidence: { type: "string" },
          attributes: {
            type: "array",
            maxItems: 12,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                key: { type: "string" },
                value: { type: "string" },
                evidence: { type: "string" }
              },
              required: ["key", "value", "evidence"]
            }
          },
          tags: { type: "array", items: { type: "string" }, maxItems: 8 }
        },
        required: ["title", "kind", "summary", "attributes", "tags", "evidence"]
      }
    },
    facts: {
      type: "array",
      maxItems: 60,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          statement: { type: "string" },
          evidence: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          entityTitles: { type: "array", items: { type: "string" }, maxItems: 12 }
        },
        required: ["statement", "evidence", "confidence", "entityTitles"]
      }
    },
    links: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sourceTitle: { type: "string" },
          targetTitle: { type: "string" },
          type: { type: "string" },
          note: { type: "string" },
          evidence: { type: "string" }
        },
        required: ["sourceTitle", "targetTitle", "type", "note", "evidence"]
      }
    }
  },
  required: ["nodes", "facts", "links"]
};

const systemPrompt = `你是 Knowledge Compiler Agent。严格按“实体归一化 → 属性归属 → 关系建模 → 命题分层 → 证据定位”的顺序编译知识。
实体必须是可独立识别和复用的名词对象，例如人物、组织、产品、技术、地点、制度或主题。
完整判断不能作为实体标题。标题中出现“高于、低于、等于、应该、需要、能够、可以、支持、包含、属于、导致、影响、提升、降低”等判断结构时，应把整句话放入 facts，并只把其中可复用的名词对象放入 nodes。
例如“风险防范高于追求回报”是 Fact，不是 Entity；可识别的 Entity 是“风险防范”和“投资回报”等名词对象。
描述、属性、关系、Fact、Hypothesis、Axiom 都不能伪装成实体。
禁止为描述或定义单独创建实体，例如已有“内在价值”时，不得再创建“内在价值的描述”“内在价值定义”等节点；描述必须写入“内在价值”的 summary 或 content。
必须区分对象身份与相关概念：别名指向同一对象，应归一化为一个实体；方法、过程和结果具有不同身份，可以分别建模，但关系必须准确。例如“未来现金流折现”是估值方法，“内在价值”是估值结果时，应使用 CALCULATES 或 CALCULATED_BY，不能使用 EQUIVALENT_TO。
属性必须归属于一个实体，关系必须连接两个已定义实体并提供自然语言说明。
每条事实只能表达一个命题，evidence 必须是原文中直接支持它的一段连续逐字引文；推测、建议和观点不能伪装成事实。
所有实体、属性、关系和 Fact 都必须提供能在原文中定位的 evidence。evidence 中不要包含 [W1] 等引用编号，不要使用省略号拼接多个片段，也不要改写原文。关系 type 使用英文大写蛇形命名。
只返回一个 JSON 对象，不要使用 Markdown 代码块或补充说明。
返回内容必须符合以下 JSON Schema：
${JSON.stringify(graphJsonSchema)}`;

function buildUserPrompt(source, text, semanticContext = "") {
  const anchor = semanticContext
    ? `当前知识系统的语义类型与约束：\n${semanticContext}\n\n抽取结果必须遵守这些类型边界。\n\n`
    : "";
  return `${anchor}来源：${source}\n\n请从以下内容抽取知识图谱节点、关系和原子事实：\n\n${text}`;
}

function imageDataUrl(image) {
  return `data:${image.mimeType};base64,${image.data.toString("base64")}`;
}

function endpoint(baseUrl, path) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  if (!base) throw new Error("模型配置缺少 Base URL");
  if (path.startsWith("/v1/") && /\/v1$/i.test(base)) return `${base}${path.slice(3)}`;
  return `${base}${path}`;
}

export class InvalidModelOutputError extends Error {
  constructor(cause) {
    super("模型返回的知识结构不是有效 JSON，自动修复后仍无法解析");
    this.name = "InvalidModelOutputError";
    this.code = "INVALID_MODEL_OUTPUT";
    this.cause = cause;
  }
}

export function parseJsonObject(value) {
  const text = String(value || "").trim();
  if (!text) throw new Error("模型没有返回抽取结果");
  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i)?.[1]?.trim();
  if (fenced && fenced !== text) candidates.push(fenced);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0) {
    const objectText = end > start ? text.slice(start, end + 1) : text.slice(start);
    if (!candidates.includes(objectText)) candidates.push(objectText);
  }

  let lastError;
  for (const candidate of candidates) {
    for (const input of [candidate, (() => {
      try {
        return jsonrepair(candidate);
      } catch (error) {
        lastError = error;
        return "";
      }
    })()]) {
      if (!input) continue;
      try {
        const parsed = JSON.parse(input);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
          throw new TypeError("Expected a JSON object");
        }
        return parsed;
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw new InvalidModelOutputError(lastError);
}

function responseOutputText(payload) {
  if (payload.output_text) return String(payload.output_text);
  return String(
    payload.output
      ?.flatMap((item) => item.content || [])
      .filter((item) => item.type === "output_text")
      .map((item) => item.text || "")
      .join("")
    || ""
  ).trim();
}

async function readPayload(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || payload.message || `模型请求失败 (${response.status})`);
  }
  return payload;
}

function usageFromPayload(payload, protocol) {
  if (protocol === "openai-responses") {
    const inputTokens = Number(payload.usage?.input_tokens || 0);
    const cachedTokens = Number(payload.usage?.input_tokens_details?.cached_tokens || 0);
    return {
      inputTokens,
      outputTokens: Number(payload.usage?.output_tokens || 0),
      cachedTokens,
      cacheMissTokens: Math.max(0, inputTokens - cachedTokens),
      reasoningTokens: Number(payload.usage?.output_tokens_details?.reasoning_tokens || 0)
    };
  }
  if (protocol === "openai-compatible") {
    const inputTokens = Number(payload.usage?.prompt_tokens || 0);
    const cachedTokens = Number(
      payload.usage?.prompt_cache_hit_tokens
      ?? payload.usage?.prompt_tokens_details?.cached_tokens
      ?? 0
    );
    return {
      inputTokens,
      outputTokens: Number(payload.usage?.completion_tokens || 0),
      cachedTokens,
      cacheMissTokens: Number(payload.usage?.prompt_cache_miss_tokens ?? Math.max(0, inputTokens - cachedTokens)),
      reasoningTokens: Number(payload.usage?.completion_tokens_details?.reasoning_tokens || 0)
    };
  }
  if (protocol === "anthropic") {
    return {
      inputTokens: Number(payload.usage?.input_tokens || 0),
      outputTokens: Number(payload.usage?.output_tokens || 0),
      cachedTokens: Number(payload.usage?.cache_read_input_tokens || 0),
      cacheMissTokens: Number(payload.usage?.cache_creation_input_tokens || 0),
      reasoningTokens: 0
    };
  }
  return {
    inputTokens: Number(payload.usageMetadata?.promptTokenCount || 0),
    outputTokens: Number(payload.usageMetadata?.candidatesTokenCount || 0),
    cachedTokens: Number(payload.usageMetadata?.cachedContentTokenCount || 0),
    cacheMissTokens: Math.max(
      0,
      Number(payload.usageMetadata?.promptTokenCount || 0)
        - Number(payload.usageMetadata?.cachedContentTokenCount || 0)
    ),
    reasoningTokens: Number(payload.usageMetadata?.thoughtsTokenCount || 0)
  };
}

function reportUsage(onUsage, payload, protocol) {
  if (onUsage) onUsage(usageFromPayload(payload, protocol));
}

async function callOpenAiCompatible({
  apiKey,
  baseUrl,
  model,
  source,
  text,
  images = [],
  semanticContext = "",
  providerUserId = "",
  onUsage
}) {
  const profile = { baseUrl, model };
  const userContent = images.length
    ? [
      { type: "text", text: buildUserPrompt(source, text || "请分析附件图片中的可见内容。", semanticContext) },
      ...images.map((image) => ({ type: "image_url", image_url: { url: imageDataUrl(image) } }))
    ]
    : buildUserPrompt(source, text, semanticContext);
  const response = await fetch(endpoint(baseUrl, "/v1/chat/completions"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 4096,
      ...deepSeekRequestOptions(profile, { userId: providerUserId, thinking: false }),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ]
    })
  });
  const payload = await readPayload(response);
  reportUsage(onUsage, payload, "openai-compatible");
  return parseJsonObject(payload.choices?.[0]?.message?.content);
}

async function callOpenAiResponses({
  apiKey,
  baseUrl,
  model,
  system,
  user,
  images = [],
  maxOutputTokens,
  reasoningEffort = "medium",
  reasoningMode = "standard",
  textVerbosity = "medium",
  jsonSchema = null,
  providerUserId = "",
  onUsage
}) {
  const input = images.length
    ? [{
      role: "user",
      content: [
        { type: "input_text", text: user },
        ...images.map((image) => ({ type: "input_image", image_url: imageDataUrl(image), detail: "auto" }))
      ]
    }]
    : user;
  const response = await fetch(endpoint(baseUrl, "/v1/responses"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      instructions: system,
      input,
      max_output_tokens: maxOutputTokens,
      reasoning: {
        effort: reasoningEffort,
        ...(reasoningMode === "pro" ? { mode: "pro" } : {})
      },
      text: {
        verbosity: textVerbosity,
        ...(jsonSchema ? {
          format: {
            type: "json_schema",
            name: "knowledge_graph_extraction",
            strict: true,
            schema: jsonSchema
          }
        } : {})
      },
      safety_identifier: normalizeProviderUserId(providerUserId),
      store: false
    })
  });
  const payload = await readPayload(response);
  reportUsage(onUsage, payload, "openai-responses");
  const output = responseOutputText(payload);
  if (!output) throw new Error("模型没有返回结果");
  return jsonSchema ? parseJsonObject(output) : output;
}

async function callAnthropic({ apiKey, baseUrl, model, source, text, images = [], semanticContext = "", onUsage }) {
  const userContent = images.length
    ? [
      ...images.map((image) => ({
        type: "image",
        source: { type: "base64", media_type: image.mimeType, data: image.data.toString("base64") }
      })),
      { type: "text", text: buildUserPrompt(source, text || "请分析附件图片中的可见内容。", semanticContext) }
    ]
    : buildUserPrompt(source, text, semanticContext);
  const response = await fetch(endpoint(baseUrl, "/v1/messages"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: 0.1,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }]
    })
  });
  const payload = await readPayload(response);
  reportUsage(onUsage, payload, "anthropic");
  return parseJsonObject(payload.content?.find((item) => item.type === "text")?.text);
}

async function callGoogle({ apiKey, baseUrl, model, source, text, images = [], semanticContext = "", onUsage }) {
  const response = await fetch(endpoint(baseUrl, `/v1beta/models/${encodeURIComponent(model)}:generateContent`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{
        role: "user",
        parts: [
          { text: buildUserPrompt(source, text || "请分析附件图片中的可见内容。", semanticContext) },
          ...images.map((image) => ({
            inlineData: { mimeType: image.mimeType, data: image.data.toString("base64") }
          }))
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
        responseSchema: graphJsonSchema
      }
    })
  });
  const payload = await readPayload(response);
  reportUsage(onUsage, payload, "google");
  return parseJsonObject(payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join(""));
}

export async function extractWithProfile({
  profile,
  apiKey,
  text,
  source,
  images = [],
  semanticContext = "",
  providerUserId = "",
  onUsage
}) {
  if (profile.protocol === "openai-compatible" && (profile.apiMode === "responses" || isGpt56SolProfile(profile))) {
    return callOpenAiResponses({
      apiKey,
      baseUrl: profile.baseUrl,
      model: profile.model,
      system: systemPrompt,
      user: buildUserPrompt(source, text || "请分析附件图片中的可见内容。", semanticContext),
      images,
      maxOutputTokens: Math.min(8192, profile.maxOutputTokens || 8192),
      reasoningEffort: "low",
      reasoningMode: "standard",
      textVerbosity: "low",
      jsonSchema: graphJsonSchema,
      providerUserId,
      onUsage
    });
  }
  const options = {
    apiKey,
    baseUrl: profile.baseUrl,
    model: profile.model,
    text,
    source,
    images,
    semanticContext,
    providerUserId,
    onUsage
  };
  if (profile.protocol === "openai-compatible") return callOpenAiCompatible(options);
  if (profile.protocol === "anthropic") return callAnthropic(options);
  if (profile.protocol === "google") return callGoogle(options);
  throw new Error(`暂不支持模型协议：${profile.protocol}`);
}

export async function completeWithProfile({
  profile,
  apiKey,
  system,
  user,
  maxOutputTokens = 3000,
  providerUserId = "",
  thinking = false,
  onUsage
}) {
  if (profile.protocol === "openai-compatible") {
    if (profile.apiMode === "responses" || isGpt56SolProfile(profile)) {
      return callOpenAiResponses({
        apiKey,
        baseUrl: profile.baseUrl,
        model: profile.model,
        system,
        user,
        maxOutputTokens,
        reasoningEffort: thinking ? profile.reasoningEffort || "medium" : "none",
        reasoningMode: thinking ? profile.reasoningMode || "standard" : "standard",
        textVerbosity: profile.textVerbosity || "medium",
        providerUserId,
        onUsage
      });
    }
    const deepSeek = isDeepSeekV4Profile(profile);
    const payload = await readPayload(await fetch(endpoint(profile.baseUrl, "/v1/chat/completions"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: profile.model,
        ...(!deepSeek || !thinking ? { temperature: 0.2 } : {}),
        max_tokens: maxOutputTokens,
        ...deepSeekRequestOptions(profile, { userId: providerUserId, thinking }),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    }));
    reportUsage(onUsage, payload, "openai-compatible");
    return String(payload.choices?.[0]?.message?.content || "").trim();
  }
  if (profile.protocol === "anthropic") {
    const payload = await readPayload(await fetch(endpoint(profile.baseUrl, "/v1/messages"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: profile.model,
        max_tokens: maxOutputTokens,
        temperature: 0.2,
        system,
        messages: [{ role: "user", content: user }]
      })
    }));
    reportUsage(onUsage, payload, "anthropic");
    return String(payload.content?.find((item) => item.type === "text")?.text || "").trim();
  }
  if (profile.protocol === "google") {
    const payload = await readPayload(await fetch(endpoint(profile.baseUrl, `/v1beta/models/${encodeURIComponent(profile.model)}:generateContent`), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens }
      })
    }));
    reportUsage(onUsage, payload, "google");
    return String(payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "").trim();
  }
  throw new Error(`暂不支持模型协议：${profile.protocol}`);
}

export async function embedWithProfile({ profile, apiKey, texts, onUsage }) {
  if (!profile.embeddingModel) throw new Error("模型配置没有 Embedding 模型");
  if (profile.protocol === "openai-compatible") {
    const payload = await readPayload(await fetch(endpoint(profile.baseUrl, "/v1/embeddings"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: profile.embeddingModel, input: texts })
    }));
    reportUsage(onUsage, payload, "openai-compatible");
    return (payload.data || [])
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }
  if (profile.protocol === "google") {
    const model = profile.embeddingModel.replace(/^models\//, "");
    const payload = await readPayload(await fetch(endpoint(profile.baseUrl, `/v1beta/models/${encodeURIComponent(model)}:batchEmbedContents`), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${model}`,
          content: { parts: [{ text }] }
        }))
      })
    }));
    reportUsage(onUsage, payload, "google");
    return (payload.embeddings || []).map((item) => item.values);
  }
  throw new Error(`Provider ${profile.protocol} 不支持 Embedding`);
}

export async function rerankWithProfile({
  profile,
  apiKey,
  query,
  candidates,
  maxOutputTokens = 1200,
  providerUserId = "",
  onUsage
}) {
  if (!profile.rerankModel || candidates.length < 2) return candidates;
  const payload = candidates.map((candidate, index) => ({
    index,
    title: candidate.documentTitle,
    text: candidate.text.slice(0, 1200)
  }));
  const output = await completeWithProfile({
    profile: { ...profile, model: profile.rerankModel },
    apiKey,
    onUsage,
    maxOutputTokens,
    providerUserId,
    thinking: false,
    system: `你是检索重排器。根据问题判断候选资料的相关性，只返回 JSON：
{"ranking":[{"index":0,"score":0.95}]}
ranking 必须包含每个候选 index 恰好一次，score 范围 0 到 1，按相关性从高到低排列。不要输出 Markdown。`,
    user: `问题：${query}\n\n候选：\n${JSON.stringify(payload)}`
  });
  const parsed = parseJsonObject(output);
  const ranking = Array.isArray(parsed.ranking) ? parsed.ranking : [];
  const seen = new Set();
  const result = [];
  for (const entry of ranking) {
    const index = Number(entry.index);
    if (!Number.isInteger(index) || index < 0 || index >= candidates.length || seen.has(index)) continue;
    seen.add(index);
    result.push({ ...candidates[index], rerankScore: Math.max(0, Math.min(1, Number(entry.score) || 0)) });
  }
  candidates.forEach((candidate, index) => {
    if (!seen.has(index)) result.push({ ...candidate, rerankScore: null });
  });
  return result;
}

export async function discoverProfileModels({ profile, apiKey }) {
  let url;
  const headers = { Accept: "application/json" };
  if (profile.protocol === "google") {
    url = endpoint(profile.baseUrl, "/v1beta/models");
    headers["x-goog-api-key"] = apiKey;
  } else {
    url = endpoint(profile.baseUrl, "/v1/models");
    if (profile.protocol === "anthropic") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers.Authorization = `Bearer ${apiKey}`;
    }
  }

  const payload = await readPayload(await fetch(url, { headers }));
  const rawModels = payload.data || payload.models || [];
  return rawModels
    .map((item) => String(item.id || item.name || "").replace(/^models\//, ""))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 300);
}

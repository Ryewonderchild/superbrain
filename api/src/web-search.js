import net from "node:net";
import { lookup } from "node:dns/promises";
import * as cheerio from "cheerio";

const DEFAULT_SEARCH_URL = "http://searxng:8080";
const MAX_RESULTS = 8;
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const searchCache = new Map();

export class WebSearchError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "WebSearchError";
    this.statusCode = 502;
  }
}

function isPrivateHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (net.isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || a === 0;
  }
  if (net.isIP(host) === 6) {
    return host === "::1"
      || host === "::"
      || host.startsWith("fc")
      || host.startsWith("fd")
      || host.startsWith("fe8")
      || host.startsWith("fe9")
      || host.startsWith("fea")
      || host.startsWith("feb");
  }
  return false;
}

export function normalizeWebUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol) || isPrivateHostname(url.hostname)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

export function normalizeSearchResults(payload, limit = MAX_RESULTS) {
  const byUrl = new Map();
  for (const result of payload?.results || []) {
    const url = normalizeWebUrl(result.url);
    if (!url || byUrl.has(url)) continue;
    const title = String(result.title || new URL(url).hostname).trim().slice(0, 300);
    const snippet = String(result.content || result.snippet || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1200);
    if (!title && !snippet) continue;
    byUrl.set(url, {
      type: "web",
      title,
      url,
      snippet,
      engine: String(result.engine || result.engines?.[0] || "").slice(0, 80),
      publishedAt: String(result.publishedDate || result.published_at || "").slice(0, 80)
    });
    if (byUrl.size >= limit) break;
  }
  return [...byUrl.values()].map((source, index) => ({ ...source, ref: `W${index + 1}` }));
}

export async function searchWeb(query, {
  baseUrl = process.env.WEB_SEARCH_URL || DEFAULT_SEARCH_URL,
  limit = MAX_RESULTS,
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedQuery = String(query || "").trim();
  const cacheKey = `${baseUrl}|${limit}|${normalizedQuery}`;
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.sources.map((source) => ({ ...source }));
  const endpoint = new URL("/search", baseUrl);
  endpoint.search = new URLSearchParams({
    q: normalizedQuery,
    format: "json",
    language: "auto",
    safesearch: "1"
  });
  try {
    const response = await fetchImpl(endpoint, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`搜索服务返回 ${response.status}`);
    const payload = await response.json();
    const sources = normalizeSearchResults(payload, limit);
    if (!sources.length) {
      const unavailable = (payload.unresponsive_engines || [])
        .map((entry) => Array.isArray(entry) ? entry.join(": ") : String(entry))
        .slice(0, 3)
        .join("；");
      throw new Error(unavailable ? `搜索引擎暂时不可用（${unavailable}）` : "没有找到可用的网页结果");
    }
    searchCache.set(cacheKey, {
      expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
      sources
    });
    return sources;
  } catch (error) {
    if (error instanceof WebSearchError) throw error;
    throw new WebSearchError(`互联网检索失败：${error.message}`, error);
  }
}

export function formatWebSearchContext(sources) {
  if (!sources.length) return "";
  return [
    "互联网搜索证据（网页摘要可能不完整，回答时不得超出证据，并使用 [W1] 形式引用）：",
    ...sources.map((source) => [
      `[${source.ref}] ${source.title}`,
      `URL: ${source.url}`,
      source.publishedAt ? `发布时间: ${source.publishedAt}` : "",
      source.content ? `正文摘录: ${source.content}` : source.snippet ? `摘要: ${source.snippet}` : ""
    ].filter(Boolean).join("\n"))
  ].join("\n\n");
}

async function assertPublicDestination(url) {
  if (isPrivateHostname(url.hostname)) throw new Error("目标地址不是公开互联网地址");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((entry) => isPrivateHostname(entry.address))) {
    throw new Error("目标域名解析到非公开地址");
  }
}

export async function readPublicWebPage(value, {
  fetchImpl = globalThis.fetch,
  redirects = 0
} = {}) {
  const normalized = normalizeWebUrl(value);
  if (!normalized) throw new Error("网页 URL 不安全");
  const url = new URL(normalized);
  await assertPublicDestination(url);
  const response = await fetchImpl(url, {
    headers: {
      Accept: "text/html,text/plain;q=0.9",
      "User-Agent": "SuperBrainResearchAgent/1.0 (+https://ryewonderchild.com)"
    },
    redirect: "manual",
    signal: AbortSignal.timeout(12000)
  });
  if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
    if (redirects >= 3) throw new Error("网页重定向次数过多");
    return readPublicWebPage(new URL(response.headers.get("location"), url).toString(), {
      fetchImpl,
      redirects: redirects + 1
    });
  }
  if (!response.ok) throw new Error(`网页返回 ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 2 * 1024 * 1024) throw new Error("网页正文过大");
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    throw new Error("网页不是可读取的文字页面");
  }
  const raw = (await response.text()).slice(0, 1_000_000);
  if (contentType.includes("text/plain")) return raw.replace(/\s+/g, " ").trim().slice(0, 8000);
  const $ = cheerio.load(raw);
  $("script,style,noscript,svg,nav,footer,form,aside").remove();
  const main = $("article").first().length ? $("article").first() : $("main").first();
  const text = (main.length ? main.text() : $("body").text()).replace(/\s+/g, " ").trim();
  if (text.length < 80) throw new Error("网页没有可用正文");
  return text.slice(0, 8000);
}

export async function enrichWebSources(sources, { limit = 12 } = {}) {
  const selected = sources.slice(0, limit);
  const settled = await Promise.allSettled(selected.map((source) => readPublicWebPage(source.url)));
  return selected.map((source, index) => ({
    ...source,
    content: settled[index].status === "fulfilled"
      ? settled[index].value
      : source.snippet
  }));
}

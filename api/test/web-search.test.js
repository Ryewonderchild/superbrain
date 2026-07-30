import assert from "node:assert/strict";
import test from "node:test";
import {
  formatWebSearchContext,
  normalizeSearchResults,
  normalizeWebUrl,
  readPublicWebPage,
  searchWeb,
  WebSearchError
} from "../src/web-search.js";

test("normalizes, deduplicates and numbers public search results", () => {
  const results = normalizeSearchResults({
    results: [
      { title: "One", url: "https://example.com/a#section", content: " first   result " },
      { title: "Duplicate", url: "https://example.com/a", content: "duplicate" },
      { title: "Private", url: "http://127.0.0.1/admin", content: "secret" },
      { title: "Two", url: "https://example.org/b", content: "second result", engine: "test" }
    ]
  });
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((item) => item.ref), ["W1", "W2"]);
  assert.equal(results[0].snippet, "first result");
  assert.equal(results[1].engine, "test");
});

test("rejects unsafe and non-web result URLs", () => {
  assert.equal(normalizeWebUrl("file:///etc/passwd"), "");
  assert.equal(normalizeWebUrl("http://localhost/private"), "");
  assert.equal(normalizeWebUrl("http://192.168.1.2/private"), "");
  assert.equal(normalizeWebUrl("https://example.com/page#part"), "https://example.com/page");
});

test("searches the shared broker and formats evidence for any model", async () => {
  let requestedUrl;
  const sources = await searchWeb("图数据库", {
    baseUrl: "http://search.internal:8080",
    fetchImpl: async (url) => {
      requestedUrl = url;
      return new Response(JSON.stringify({
        results: [{ title: "Neo4j", url: "https://neo4j.com/", content: "Graph database" }]
      }), { status: 200 });
    }
  });
  assert.equal(requestedUrl.searchParams.get("q"), "图数据库");
  assert.equal(requestedUrl.searchParams.get("format"), "json");
  assert.match(formatWebSearchContext(sources), /\[W1\] Neo4j/);
});

test("returns a user-facing search error", async () => {
  await assert.rejects(
    () => searchWeb("query", {
      fetchImpl: async () => new Response("down", { status: 503 })
    }),
    (error) => error instanceof WebSearchError && error.statusCode === 502
  );
});

test("caches successful searches to avoid upstream rate bursts", async () => {
  let calls = 0;
  const options = {
    baseUrl: "http://cache-search.internal:8080",
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({
        results: [{ title: "Cached", url: "https://example.com/cached", content: "result" }]
      }), { status: 200 });
    }
  };
  await searchWeb("unique cache query", options);
  await searchWeb("unique cache query", options);
  assert.equal(calls, 1);
});

test("reports upstream engine failures instead of claiming the topic has no sources", async () => {
  await assert.rejects(
    () => searchWeb("limited query", {
      baseUrl: "http://limited-search.internal:8080",
      fetchImpl: async () => new Response(JSON.stringify({
        results: [],
        unresponsive_engines: [["brave", "too many requests"], ["duckduckgo", "CAPTCHA"]]
      }), { status: 200 })
    }),
    /搜索引擎暂时不可用/
  );
});

test("refuses to read private network pages", async () => {
  await assert.rejects(
    () => readPublicWebPage("http://127.0.0.1/admin"),
    /URL 不安全/
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { chunkMarkdown, contentHash, parseMarkdown } from "../src/markdown.js";

test("parses wiki links, tags and heading paths without an LLM", () => {
  const parsed = parseMarkdown("# Alpha\nSee [[Beta|B]] and [[Gamma#Part]]. #research\n## Detail\nText");
  assert.deepEqual(parsed.links.map(({ target, alias }) => ({ target, alias })), [
    { target: "Beta", alias: "B" },
    { target: "Gamma", alias: "" }
  ]);
  assert.deepEqual(parsed.tags, ["research"]);
  assert.deepEqual(parsed.headings[1].path, ["Alpha", "Detail"]);
});

test("chunks preserve heading metadata and token counts", () => {
  const text = `# Root\n${"knowledge ".repeat(900)}\n## Child\n${"evidence ".repeat(900)}`;
  const chunks = chunkMarkdown(text);
  assert.ok(chunks.length >= 3);
  assert.equal(chunks[0].heading, "Root");
  assert.ok(chunks.every((chunk) => chunk.tokenCount > 0 && chunk.end > chunk.start));
});

test("content hashes normalize line endings", () => {
  assert.equal(contentHash("a\r\nb"), contentHash("a\nb"));
});

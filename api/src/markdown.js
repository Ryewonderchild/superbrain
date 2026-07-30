import crypto from "node:crypto";
import { estimateTokens } from "./token-budget.js";

const WIKI_LINK = /(?<!!)\[\[([^\]\n|#]+)(?:#[^\]\n|]+)?(?:\|([^\]\n]+))?\]\]/g;
const TAG = /(^|[\s(])#([\p{L}\p{N}_/-]+)/gu;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

export function contentHash(content) {
  return crypto.createHash("sha256").update(String(content || "").replace(/\r\n/g, "\n")).digest("hex");
}

export function parseMarkdown(content) {
  const text = String(content || "").replace(/\r\n/g, "\n");
  const links = [];
  for (const match of text.matchAll(WIKI_LINK)) {
    links.push({
      target: match[1].trim(),
      alias: String(match[2] || "").trim(),
      index: match.index
    });
  }
  const tags = [...new Set([...text.matchAll(TAG)].map((match) => match[2]))];
  const headings = [];
  const stack = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const match = line.match(HEADING);
    if (match) {
      const level = match[1].length;
      const title = match[2].trim();
      stack.length = level - 1;
      stack[level - 1] = title;
      headings.push({ level, title, path: stack.filter(Boolean), start: offset });
    }
    offset += line.length + 1;
  }
  return { links, tags, headings };
}

function headingAt(headings, position) {
  let current = null;
  for (const heading of headings) {
    if (heading.start > position) break;
    current = heading;
  }
  return current;
}

function chooseEnd(text, start, targetEnd, minimumEnd) {
  if (targetEnd >= text.length) return text.length;
  const candidates = [
    text.lastIndexOf("\n\n", targetEnd),
    text.lastIndexOf("\n", targetEnd),
    text.lastIndexOf("。", targetEnd),
    text.lastIndexOf(". ", targetEnd)
  ].filter((position) => position >= minimumEnd);
  return candidates.length ? Math.max(...candidates) + 1 : targetEnd;
}

export function chunkMarkdown(content, {
  targetTokens = 450,
  minTokens = 300,
  maxTokens = 600,
  overlapTokens = 75
} = {}) {
  const text = String(content || "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  const { headings } = parseMarkdown(text);
  const charsPerToken = Math.max(1, text.length / Math.max(1, estimateTokens(text)));
  const targetChars = Math.max(200, Math.round(targetTokens * charsPerToken));
  const minChars = Math.max(100, Math.round(minTokens * charsPerToken));
  const maxChars = Math.max(targetChars, Math.round(maxTokens * charsPerToken));
  const overlapChars = Math.max(0, Math.round(overlapTokens * charsPerToken));
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const desiredEnd = Math.min(text.length, start + targetChars);
    let end = chooseEnd(text, start, Math.min(text.length, start + maxChars), Math.min(text.length, start + minChars));
    if (end > desiredEnd) {
      const preferred = chooseEnd(text, start, desiredEnd, Math.min(text.length, start + minChars));
      if (preferred >= start + minChars) end = preferred;
    }
    if (end <= start) end = Math.min(text.length, start + maxChars);
    const value = text.slice(start, end).trim();
    const heading = headingAt(headings, start);
    if (value) {
      chunks.push({
        index: chunks.length,
        start,
        end,
        text: value,
        tokenCount: estimateTokens(value),
        heading: heading?.title || "",
        headingPath: heading?.path || []
      });
    }
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlapChars);
  }
  return chunks;
}

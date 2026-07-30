export function chunkText(text, maxLength = 1400, overlap = 180) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const chunks = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + maxLength, normalized.length);
    if (end < normalized.length) {
      const candidates = [
        normalized.lastIndexOf("\n\n", end),
        normalized.lastIndexOf("\n", end),
        normalized.lastIndexOf("。", end),
        normalized.lastIndexOf(". ", end)
      ].filter((position) => position > start + Math.floor(maxLength * 0.55));
      if (candidates.length) end = Math.max(...candidates) + 1;
    }
    const value = normalized.slice(start, end).trim();
    if (value) chunks.push({ index: chunks.length, start, end, text: value });
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

export function findEvidenceChunk(chunks, quote) {
  const normalizedQuote = String(quote || "").trim();
  if (!chunks.length) return null;
  if (!normalizedQuote) return chunks[0];
  const exact = chunks.find((chunk) => chunk.text.includes(normalizedQuote));
  if (exact) return exact;

  const words = normalizedQuote.toLowerCase().split(/\s+/).filter((word) => word.length > 1);
  let best = chunks[0];
  let bestScore = -1;
  for (const chunk of chunks) {
    const lower = chunk.text.toLowerCase();
    const score = words.reduce((total, word) => total + (lower.includes(word) ? 1 : 0), 0);
    if (score > bestScore) {
      best = chunk;
      bestScore = score;
    }
  }
  return best;
}

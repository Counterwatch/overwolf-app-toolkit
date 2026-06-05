// Collapses repetitive log lines into distinct clusters, so "757 errors" becomes
// "here are the 6 distinct errors, most frequent first". Normalization strips the
// variable bits (timestamps, numbers, ids, quoted values, paths) so lines that
// differ only in those collapse to one cluster. Pure, no I/O.

// Order matters: strip the most specific/variable tokens first.
const NORMALIZE_RULES = [
  [/\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}([.,]\d+)?\b/g, "<ts>"],
  [/[A-Za-z]:\\[^\s"']+/g, "<path>"],
  [/\b[a-z]+:\/\/[^\s"')]+/gi, "<url>"],
  [/\/[^\s"']*\/[^\s"']+/g, "<path>"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>"],
  [/\b0x[0-9a-f]+\b/gi, "<hex>"],
  [/\b[0-9a-f]{16,}\b/gi, "<hash>"],
  [/"[^"]*"|'[^']*'/g, "<str>"],
  // No \b: numbers are often glued to units/ids ("1000ms", "RTX5060"), and we
  // want those to collapse too. Runs after the specific id/hex/hash rules above.
  [/\d+(?:\.\d+)?/g, "<n>"],
];

/** Strip the leading source/component noise from a log message; keep one line. */
export function stripPrefix(message) {
  let m = String(message).split("\n")[0];
  m = m.replace(/^\s*\[\d+\](?:\[\d+\])?\s*(?:<[^>]*>\s*)?/, ""); // [pid] <mem> (OW traces)
  m = m.replace(/^\s*\S+\s+\(:?\d*\)\s*-\s*/, ""); // source.js (:123) -
  m = m.replace(/^\s*\[[^\]]+\]\s*/, ""); // [Component/fn]
  m = m.replace(/^\s*[A-Z][A-Za-z0-9]{2,}\s+-\s+/, ""); // CamelComponent -
  return m.trim();
}

/** Reduce a message to a structural key so near-identical lines collapse. */
export function normalizeMessage(message) {
  let m = stripPrefix(message);
  for (const [re, rep] of NORMALIZE_RULES) m = m.replace(re, rep);
  return m.replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * Group items by their normalized message.
 * @param {{message: string, level?: string, ts?: number, file?: string}[]} items
 * @param {number} limit
 * @returns {{normalized: string, sample: string, count: number, level: string, firstTs: number|null, lastTs: number|null, file: string|null}[]}
 */
export function clusterMessages(items, limit = 8) {
  /** @type {Map<string, any>} */
  const map = new Map();
  for (const it of items) {
    const key = normalizeMessage(it.message);
    if (!key) continue;
    let c = map.get(key);
    if (!c) {
      c = { normalized: key, sample: stripPrefix(it.message).slice(0, 200), count: 0, level: it.level ?? "—", firstTs: null, lastTs: null, file: it.file ?? null };
      map.set(key, c);
    }
    c.count++;
    if (typeof it.ts === "number") {
      if (c.firstTs == null || it.ts < c.firstTs) c.firstTs = it.ts;
      if (c.lastTs == null || it.ts > c.lastTs) c.lastTs = it.ts;
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

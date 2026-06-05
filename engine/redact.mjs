// PII masking for anything that might be shared outside the developer's machine
// (e.g. pasted into a support ticket). Replaces personal identifiers with stable
// placeholders so the same value maps to the same token throughout the output.
//
// This is best-effort defense-in-depth, not a guarantee. Always eyeball redacted
// text before sharing it.

/**
 * Ordered rules. Earlier rules win on overlapping matches (e.g. a JWT is caught
 * before a generic token). Each rule has a category used for placeholder names.
 * @type {{category: string, re: RegExp}[]}
 */
const RULES = [
  { category: "jwt", re: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g },
  { category: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { category: "uuid", re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi },
  // Overwolf user identifiers, e.g. "OW_7f5a..." returned by getCurrentUser.
  { category: "userid", re: /\bOW_[A-Za-z0-9_-]{6,}\b/g },
  // BattleTag / Riot-style game handles: Name#1234. No spaces in the class — a space
  // would let the greedy match swallow preceding words before the "#NNNN".
  { category: "gamertag", re: /\b[A-Za-z][A-Za-z0-9._-]{1,30}#\d{3,6}\b/g },
  { category: "ip", re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
];

// HTTP auth schemes and Windows/Unix home paths use a replacer that keeps a prefix.
const BEARER_RE = /\b(bearer\s+)[A-Za-z0-9._~+/-]{8,}=*/gi;
const BASIC_RE = /\b(basic\s+)[A-Za-z0-9+/]{8,}=*/gi;
const WIN_HOME_RE = /([A-Za-z]:\\Users\\)[^\\/\r\n"']+/g;
const NIX_HOME_RE = /(\/(?:home|Users)\/)[^/\r\n"']+/g;

/** A reusable redactor that keeps a consistent value→placeholder map. */
export function createRedactor() {
  /** @type {Map<string, string>} */
  const seen = new Map();
  const counters = /** @type {Record<string, number>} */ ({});

  const placeholderFor = (category, value) => {
    const key = category + ":" + value.toLowerCase();
    const existing = seen.get(key);
    if (existing) return existing;
    counters[category] = (counters[category] ?? 0) + 1;
    const token = `<${category}#${counters[category]}>`;
    seen.set(key, token);
    return token;
  };

  /** @param {string} input */
  const redact = (input) => {
    if (typeof input !== "string" || input.length === 0) return input;
    let out = input;
    for (const { category, re } of RULES) {
      out = out.replace(re, (match) => placeholderFor(category, match));
    }
    out = out.replace(BEARER_RE, (_m, prefix) => prefix + "<token>");
    out = out.replace(BASIC_RE, (_m, prefix) => prefix + "<token>");
    out = out.replace(WIN_HOME_RE, (_m, prefix) => prefix + "<user>");
    out = out.replace(NIX_HOME_RE, (_m, prefix) => prefix + "<user>");
    return out;
  };

  /** Deep-redact every string in a JSON-like value. */
  const redactDeep = (value) => {
    if (typeof value === "string") return redact(value);
    if (Array.isArray(value)) return value.map(redactDeep);
    if (value && typeof value === "object") {
      /** @type {Record<string, unknown>} */
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v);
      return out;
    }
    return value;
  };

  return { redact, redactDeep };
}

/** One-shot helpers for convenience. */
export function redactText(input) {
  return createRedactor().redact(input);
}
export function redactDeep(value) {
  return createRedactor().redactDeep(value);
}

// The generic detector registry — the main extension point of the toolkit.
//
// IMPORTANT (privacy/scope): detectors here match only GENERIC, PUBLIC concepts
// (industry-standard keywords and documented Overwolf-platform terms). They must
// never encode any single app's proprietary log strings. App-specific patterns
// belong in an external rule pack loaded at runtime (see --rules / loadRulePack
// and references/extending-detectors.md).
//
// A detector is a small object:
//   {
//     id, title, category, severity,           // identity + default severity
//     scope: "any" | "app" | "overwolf",       // which logs it applies to
//     match: (entry, ctx) => boolean,          // does this line match?
//     summarize?: (entries, ctx) => object,    // optional rollup data
//   }
// `entry` is a parsed LogEntry (see logline.mjs); `ctx` is { file } where file
// carries { category, app, window, system }.

/** Severity ordering, low → high. */
export const SEVERITY_ORDER = ["info", "notice", "warn", "error", "critical"];

/** @returns {number} index for comparing severities. */
export function severityRank(s) {
  const i = SEVERITY_ORDER.indexOf(s);
  return i === -1 ? 0 : i;
}

/** Map a log level to a severity floor, so an ERROR line lifts its signal. */
export function levelSeverity(level) {
  if (level === "ERROR" || level === "FATAL") return "error";
  if (level === "WARN") return "warn";
  return "info";
}

const isErrorish = (e) => e.level === "ERROR" || e.level === "FATAL";

/** @type {Array<import("./types.js").Detector>} */
export const DETECTORS = [
  {
    id: "app-exception",
    title: "Unhandled exception / error in app logs",
    category: "crash",
    severity: "error",
    scope: "app",
    match: (e) =>
      isErrorish(e) ||
      /\b(exception|unhandled|uncaught|stack trace|cannot read propert(?:y|ies)|is not a function|is not defined|null reference)\b/i.test(
        e.message ?? "",
      ),
  },
  {
    id: "error-line",
    title: "Errors logged",
    category: "error",
    severity: "error",
    scope: "any",
    match: (e) => isErrorish(e),
  },
  {
    id: "warning-line",
    title: "Warnings logged",
    category: "warning",
    severity: "warn",
    scope: "any",
    match: (e) => e.level === "WARN",
  },
  {
    id: "gep-health",
    title: "Game Events Provider (GEP) health issues",
    category: "game-events",
    severity: "warn",
    scope: "any",
    match: (e) => {
      const m = e.message ?? "";
      const aboutGep = /\b(gep|game ?events? ?provider|gephealth)\b/i.test(m);
      const bad = e.level === "WARN" || isErrorish(e) || /\b(not working|unavailable|fail|timeout|unhealthy|retry)\b/i.test(m);
      return aboutGep && bad;
    },
  },
  {
    id: "auth-signal",
    title: "Authentication / session activity",
    category: "auth",
    severity: "notice",
    scope: "any",
    match: (e) =>
      /\b(auth|login|log ?in|logout|log ?out|sign(?:ed)?[ _-]?in|sign(?:ed)?[ _-]?out|\botp\b|token|session|unauthor|credential|\b401\b|\b403\b)\b/i.test(
        e.message ?? "",
      ),
  },
  {
    id: "sync-signal",
    title: "Data sync / replication activity",
    category: "sync",
    severity: "notice",
    scope: "any",
    match: (e) =>
      /\b(sync|synced|syncing|replicat|backfill|checkpoint|push(?:ed|ing)?|pull(?:ed|ing)?|upload(?:ed|ing)?|offline|realtime|websocket|conflict|pending (?:changes|writes|docs|documents))\b/i.test(
        e.message ?? "",
      ),
    // Generic rollup: how many records were pushed/synced, and was a "complete"
    // state ever reached. Patterns are generic English, not app-specific.
    summarize: (entries) => {
      let lastPushed = null;
      let lastPushedTs;
      let sawComplete = false;
      let lastCompleteTs;
      // Process in chronological order so "last result" is the latest by time,
      // not by filesystem enumeration order (which is not guaranteed stable).
      const ordered = [...entries].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
      for (const e of ordered) {
        const m = e.message ?? "";
        const num = m.match(/(\d+)\s+(?:docs|documents|records|items|changes|rows)\s+(?:pushed|synced|uploaded|sent)/i)
          || m.match(/(?:pushed|synced|uploaded|sent)\D{0,12}?(\d+)\s+(?:docs|documents|records|items|changes|rows)/i)
          || m.match(/\b(?:total\w*?(?:pushed|synced|uploaded))\D{0,6}?(\d+)\b/i);
        if (num) {
          lastPushed = Number(num[1]);
          lastPushedTs = e.ts;
        }
        if (/\b(fully synced|sync(?:hronization)? complete|up to date|all collections (?:fully )?synced)\b/i.test(m)) {
          sawComplete = true;
          lastCompleteTs = e.ts;
        }
      }
      return { lastPushed, lastPushedTs, sawComplete, lastCompleteTs };
    },
  },
  {
    id: "network-signal",
    title: "Network / connectivity errors",
    category: "network",
    severity: "warn",
    scope: "any",
    match: (e) =>
      /\b(ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|net::ERR|fetch failed|network error|timed? ?out|socket hang ?up|connection (?:refused|reset|closed|lost)|websocket (?:closed|error|disconnect)|disconnected|http[ _]?(?:4|5)\d\d|status[ _]?(?:4|5)\d\d)\b/i.test(
        e.message ?? "",
      ),
  },
  {
    id: "updater-issue",
    title: "Overwolf updater problems",
    category: "updater",
    severity: "warn",
    scope: "overwolf",
    match: (e, ctx) =>
      ctx?.file?.category === "updater" && (isErrorish(e) || e.level === "WARN" || /\b(fail|error|retry|could not|unable)\b/i.test(e.message ?? "")),
  },
  {
    id: "permissions-csp",
    title: "Content-Security-Policy / permissions violations",
    category: "permissions",
    severity: "notice",
    scope: "any",
    match: (e) =>
      /\b(content security policy|permissions policy|\bcsp\b|not allowed (?:to|by)|blocked the loading|refused to (?:load|connect|frame)|violat)\b/i.test(
        e.message ?? "",
      ),
  },
  {
    id: "game-detection",
    title: "Game detection & event features",
    category: "game",
    severity: "info",
    scope: "any",
    match: (e) =>
      /\b(game (?:started|stopped|detected|launched|running|closed|exited)|setRequiredFeatures|required features|gep_internal|match (?:started|ended|info)|player (?:changed|presence)|presence (?:updated|registered))\b/i.test(
        e.message ?? "",
      ),
  },
];

/**
 * Load an external rule pack: a JS/JSON module exporting either a default array
 * of detectors, or a named `detectors` array. Returns the detectors (validated
 * shape only — match() is the contributor's responsibility).
 * @param {string} specifier  file path or module specifier
 * @returns {Promise<Array<object>>}
 */
export async function loadRulePack(specifier) {
  const mod = await import(specifier);
  const list = mod.detectors ?? mod.default;
  if (!Array.isArray(list)) {
    throw new Error(
      `Rule pack "${specifier}" must export an array as \`detectors\` or default. ` +
        `See references/extending-detectors.md.`,
    );
  }
  for (const d of list) {
    if (!d || typeof d.id !== "string" || typeof d.match !== "function") {
      throw new Error(`Rule pack "${specifier}" has a detector missing a string id or match() function.`);
    }
  }
  return list;
}

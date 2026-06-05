// Parser for the Overwolf logger line format, shared by every Overwolf app:
//
//   2026-01-01 12:00:00,123 (INFO) Source.js (:42) - [Component/fn] Message
//
// The leading timestamp + (LEVEL) are reliable; everything after varies between
// apps, so we keep the whole remainder as `message` and best-effort lift a
// leading [Component] tag for grouping. Lines that don't match a header (e.g.
// stack-trace continuations) fold into the previous entry. Pure, no I/O.

/** @typedef {"INFO"|"WARN"|"ERROR"|"DEBUG"|"TRACE"|"FATAL"|"UNKNOWN"} LogLevel */

/**
 * @typedef {Object} LogEntry
 * @property {string} raw            Full original text (with folded continuations).
 * @property {string} [tsRaw]        Timestamp exactly as it appeared.
 * @property {number} [ts]           Epoch ms (NaN-safe; undefined if unparseable).
 * @property {LogLevel} [level]      Normalized level.
 * @property {string|null} [component] Best-effort `[Component]` tag.
 * @property {string} [message]      Everything after the level.
 * @property {boolean} [marker]      True for a "new session" boundary line.
 */

const LINE_RE =
  /^(?<ts>\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}[.,]\d{1,3})\s+\((?<level>[A-Za-z]+)\)\s*(?<rest>.*)$/;

const MARKER_RE = /=+\s*new session\s*=+/i;

/** @param {string} level @returns {LogLevel} */
function normalizeLevel(level) {
  const up = level.toUpperCase();
  if (up === "WARNING") return "WARN";
  if (up === "ERR") return "ERROR";
  if (["INFO", "WARN", "ERROR", "DEBUG", "TRACE", "FATAL"].includes(up)) {
    return /** @type {LogLevel} */ (up);
  }
  return "UNKNOWN";
}

/** Parse the OW timestamp ("2026-01-01 12:00:00,123") to epoch ms, or NaN. */
function toEpoch(tsRaw) {
  return Date.parse(tsRaw.replace(" ", "T").replace(",", "."));
}

/**
 * Best-effort component tag: the first `[...]` near the start whose content
 * looks like a name (has a letter, isn't a pure timestamp/thread number).
 * @param {string} rest
 * @returns {string|null}
 */
function extractComponent(rest) {
  const m = rest.match(/\[([^\]]{1,80})\]/);
  if (!m) return null;
  const inner = m[1].trim();
  if (!/[A-Za-z]/.test(inner)) return null;
  if (/^\d+(:\d+)*$/.test(inner)) return null; // [10:20], [12345]
  return inner;
}

/** Parse a single physical line into a header entry, or null if it's not one. */
function parseHeader(line) {
  const m = LINE_RE.exec(line);
  if (!m || !m.groups) return null;
  const { ts, level, rest } = m.groups;
  const epoch = toEpoch(ts);
  return {
    raw: line,
    tsRaw: ts,
    ...(Number.isNaN(epoch) ? {} : { ts: epoch }),
    level: normalizeLevel(level),
    component: extractComponent(rest),
    message: rest.trim(),
  };
}

/**
 * Parse a whole log file's text into entries. Continuation lines (stack traces,
 * pretty-printed JSON) fold into the preceding entry's `message`/`raw`.
 * @param {string} text
 * @returns {LogEntry[]}
 */
export function parseLines(text) {
  /** @type {LogEntry[]} */
  const out = [];
  for (const rawLine of String(text).split(/\n/)) {
    const line = rawLine.replace(/\r$/, "");
    if (MARKER_RE.test(line)) {
      out.push({ raw: line, marker: true });
      continue;
    }
    const header = parseHeader(line);
    if (header) {
      out.push(header);
      continue;
    }
    const last = out[out.length - 1];
    if (last && !last.marker && last.message !== undefined) {
      last.message += "\n" + line;
      last.raw += "\n" + line;
    } else if (line.trim().length > 0) {
      out.push({ raw: line });
    }
  }
  return out;
}

/**
 * Split entries into sessions on "new session" markers. Each session is the run
 * of entries between two markers (markers themselves are dropped).
 * @param {LogEntry[]} entries
 * @returns {LogEntry[][]}
 */
export function splitSessions(entries) {
  /** @type {LogEntry[][]} */
  const sessions = [];
  /** @type {LogEntry[]} */
  let cur = [];
  for (const e of entries) {
    if (e.marker) {
      if (cur.length) sessions.push(cur);
      cur = [];
      continue;
    }
    cur.push(e);
  }
  if (cur.length) sessions.push(cur);
  return sessions;
}

/** First/last parseable timestamps in a list of entries. */
export function timeSpan(entries) {
  let start;
  let end;
  for (const e of entries) {
    if (typeof e.ts !== "number") continue;
    if (start === undefined || e.ts < start) start = e.ts;
    if (end === undefined || e.ts > end) end = e.ts;
  }
  return { start, end };
}

// Reconstructs what Overwolf's Game Events Provider (GEP) actually delivered, per
// game session, from GEP's OWN logs (Apps/Overwolf General GameEvents Provider/).
//
// Those logs record every value GEP forwards to apps (`[GEP] info update {…}`,
// `[GEP] New Event {…}`), what its native game plugin produced (`[Plugin] …`), the
// GEP version, and — when the game closes — the keys it never produced
// (`Missing feature (info) - gameId: N (Game) - key`). That turns "the app never got
// X" from a guess about the app into a count of what GEP sent, and comparing a
// game's sessions shows the key that STOPPED arriving (typically after a GEP or game
// update), which is the evidence Overwolf needs in a GEP bug report.
//
// The end-of-game "Missing feature" list alone is a weak signal: GEP lists keys that
// are routinely absent for every user (per-slot keys, mode-specific keys) there too.
// A key that carried values in one session and none in a comparable later session of
// the same game is the strong one. Pure, no I/O.

/** @typedef {import("./logline.mjs").LogEntry} LogEntry */

/**
 * @typedef {Object} KeyStat
 * @property {number} updates  Lines that carried this key (including null/empty values).
 * @property {number} values   Lines that carried a real value (not null/empty) — what "delivered" means.
 */

/**
 * @typedef {Object} GepSession
 * @property {string|null} gameId
 * @property {string|null} gameName
 * @property {string|null} gepVersion
 * @property {number|null} start
 * @property {number|null} end
 * @property {string} file
 * @property {boolean} ended          Saw GEP's own game-ended/handler-stopped line.
 * @property {Record<string, KeyStat>} info     `[GEP] info update`, keyed "feature.key".
 * @property {Record<string, number>} events    `[GEP] New Event`, keyed "feature.key".
 * @property {Record<string, KeyStat>} plugin   `[Plugin] info update`, keyed "category.key".
 * @property {{kind: string, key: string}[]} missing  GEP's end-of-game "Missing feature" list.
 * @property {number} activeKeys      Distinct info keys with values + distinct events.
 */

/**
 * @typedef {Object} GepDropout
 * @property {string|null} gameId
 * @property {string|null} gameName
 * @property {string} key            "feature.key" as apps receive it.
 * @property {"info"|"event"} kind
 * @property {{start: number|null, gepVersion: string|null, file: string, values: number, pluginValues: number|null}} before
 * @property {{start: number|null, gepVersion: string|null, file: string, values: 0, updates: number, pluginValues: number|null}} after
 * @property {boolean} flaggedMissing  GEP itself listed the key as a missing feature at game close.
 */

// The GEP version, in the shapes the provider logs it (newest first). `local_version`
// also rides the gep_internal info update apps receive.
const VERSION_RES = [
  /\bDetected Gep Version\s+(\d+(?:\.\d+){1,3})/i,
  /\bGame Service Initialized v(\d+(?:\.\d+){1,3})/i,
  /\[GEP\]\s+Running version\s+(\d+(?:\.\d+){1,3})/i,
  /\blocal_version\D{1,6}(\d+(?:\.\d+){1,3})/i,
];
// A game session opens on any of these (GEP logs several in a burst for one launch).
const START_RES = [
  /\bRunning Game Id detected\W+gameId\W+(\d+)/i,
  /\bgame launched detected\W+(\d+)/i,
  /\blaunching game handler\s+(\d+)/i,
];
const END_RES = [/\bSupported game ended\s+(\d+)/i, /\bStopping Game Handler\s+(\d+)/i];
const MISSING_RE = /\bMissing feature \((info|event)\)\s*-\s*gameId:?\s*(\d+)\s*(?:\(([^)]*)\))?\s*-\s*(\S+)/i;
const TITLE_RE = /"title"\s*:\s*"([^"]+)"/;
const CLASS_ID_RE = /"classId"\s*:\s*(\d+)/;

// A key has to have carried at least this many values in the earlier session before
// its absence later counts: one stray value in a mode the user left is not a pattern.
const MIN_BASELINE_VALUES = 2;
// Two sessions are only comparable when their breadth of delivered keys is similar;
// otherwise a short menu-only session "drops" every in-match key.
const COMPARABLE_RATIO = 0.6;

function firstCapture(text, regexes) {
  for (const re of regexes) {
    const m = re.exec(text);
    if (m) return m[1];
  }
  return undefined;
}

/** Parse the JSON object that follows `marker` on the line, or undefined. */
function payload(message, marker) {
  const i = message.indexOf(marker);
  if (i === -1) return undefined;
  const j = message.indexOf("{", i + marker.length);
  if (j === -1) return undefined;
  try {
    const v = JSON.parse(message.slice(j));
    return v && typeof v === "object" ? v : undefined;
  } catch {
    return undefined;
  }
}

function hasValue(v) {
  return v !== null && v !== undefined && v !== "" && v !== "null";
}

// Per-slot keys (roster_0 … roster_11, ability_cooldown_5) collapse to one row each,
// so a lobby of a different size doesn't read as keys appearing and vanishing.
function groupKey(key) {
  return String(key).replace(/_\d+$/, "_*");
}

function bump(map, key, value) {
  const s = map[key] ?? (map[key] = { updates: 0, values: 0 });
  s.updates++;
  if (hasValue(value)) s.values++;
}

function newSession(gameId, entry, file, version) {
  /** @type {GepSession} */
  const s = {
    gameId: gameId ?? null,
    gameName: null,
    gepVersion: version ?? null,
    start: entry.ts ?? null,
    end: entry.ts ?? null,
    file,
    ended: false,
    info: {},
    events: {},
    plugin: {},
    missing: [],
    activeKeys: 0,
  };
  return s;
}

function isDataLine(msg) {
  return msg.includes("[GEP] info update") || msg.includes("[GEP] New Event") || msg.includes("[Plugin] info update");
}

function activeKeys(s) {
  return Object.values(s.info).filter((st) => st.values > 0).length + Object.keys(s.events).length;
}

/** Sum a key's plugin-level values across categories, matching on the key name only. */
function pluginValues(s, key) {
  const name = key.split(".").pop();
  let total = 0;
  let seen = false;
  for (const [k, st] of Object.entries(s.plugin)) {
    if (k.split(".").pop() !== name) continue;
    seen = true;
    total += st.values;
  }
  return seen ? total : Object.keys(s.plugin).length ? 0 : null;
}

/**
 * Split GEP provider logs into per-game sessions and count what GEP delivered in each.
 * @param {{label: string, entries: LogEntry[]}[]} files  GEP provider log files, parsed
 *   (markers included, so provider restarts split sessions).
 * @returns {{versions: {version: string, firstTs: number|null, lastTs: number|null}[], sessions: GepSession[], dropouts: GepDropout[]}}
 */
export function analyzeGep(files) {
  /** @type {GepSession[]} */
  const sessions = [];
  /** @type {Map<string, {version: string, firstTs: number|null, lastTs: number|null}>} */
  const versions = new Map();

  for (const { label, entries } of files) {
    /** @type {string|null} */
    let version = null;
    /** @type {GepSession|null} */
    let cur = null;
    const close = () => {
      if (cur && (cur.gameId || isActive(cur))) sessions.push(cur);
      cur = null;
    };

    for (const e of entries) {
      if (e.marker) {
        close();
        version = null;
        continue;
      }
      const msg = String(e.message ?? "").split("\n")[0];
      if (!msg) continue;

      const v = firstCapture(msg, VERSION_RES);
      if (v) {
        version = v;
        noteVersion(versions, v, e.ts);
        if (cur && !cur.gepVersion) cur.gepVersion = v;
      }

      const startId = firstCapture(msg, START_RES);
      if (startId) {
        if (!cur || cur.ended || (cur.gameId && cur.gameId !== startId)) {
          close();
          cur = newSession(startId, e, label, version);
        } else if (!cur.gameId) {
          cur.gameId = startId;
        }
        continue;
      }

      if (!cur) {
        // Older provider logs can carry deliveries without an explicit launch line:
        // open an anonymous session so they still count.
        if (!isDataLine(msg)) continue;
        cur = newSession(null, e, label, version);
      }
      if (typeof e.ts === "number") {
        if (cur.start == null || e.ts < cur.start) cur.start = e.ts;
        if (cur.end == null || e.ts > cur.end) cur.end = e.ts;
      }

      const endId = firstCapture(msg, END_RES);
      if (endId) {
        cur.ended = true;
        if (!cur.gameId) cur.gameId = endId;
      }
      if (!cur.gameName) {
        const t = TITLE_RE.exec(msg);
        const c = CLASS_ID_RE.exec(msg);
        if (t && (!c || !cur.gameId || c[1] === cur.gameId)) cur.gameName = t[1];
      }

      const miss = MISSING_RE.exec(msg);
      if (miss) {
        const [, kind, gid, name, key] = miss;
        if (!cur.gameId) cur.gameId = gid;
        if (name && !cur.gameName) cur.gameName = name.trim();
        if (!cur.missing.some((m) => m.kind === kind.toLowerCase() && m.key === key)) {
          cur.missing.push({ kind: kind.toLowerCase(), key });
        }
        continue;
      }

      if (msg.includes("[GEP] info update")) {
        const p = payload(msg, "[GEP] info update");
        if (p && p.key) bump(cur.info, `${p.featureName ?? p.categoryName ?? "?"}.${groupKey(p.key)}`, p.value);
      } else if (msg.includes("[GEP] New Event")) {
        const p = payload(msg, "[GEP] New Event");
        if (p && p.key) {
          const k = `${p.feature ?? "?"}.${groupKey(p.key)}`;
          cur.events[k] = (cur.events[k] ?? 0) + 1;
          if (!cur.gameId && p.gameId != null) cur.gameId = String(p.gameId);
        }
      } else if (msg.includes("[Plugin] info update")) {
        const p = payload(msg, "[Plugin] info update");
        if (p && p.key) bump(cur.plugin, `${p.category ?? "?"}.${groupKey(p.key)}`, p.value);
      }
    }
    close();
  }

  sessions.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  for (const s of sessions) s.activeKeys = activeKeys(s);

  return {
    versions: [...versions.values()].sort((a, b) => (a.firstTs ?? 0) - (b.firstTs ?? 0)),
    sessions,
    dropouts: findDropouts(sessions),
  };
}

function isActive(s) {
  return Object.keys(s.info).length > 0 || Object.keys(s.events).length > 0 || Object.keys(s.plugin).length > 0 || s.missing.length > 0;
}

function noteVersion(map, version, ts) {
  const cur = map.get(version) ?? { version, firstTs: null, lastTs: null };
  if (typeof ts === "number") {
    if (cur.firstTs == null || ts < cur.firstTs) cur.firstTs = ts;
    if (cur.lastTs == null || ts > cur.lastTs) cur.lastTs = ts;
  }
  map.set(version, cur);
}

function comparable(a, b) {
  const x = a.activeKeys;
  const y = b.activeKeys;
  if (x === 0 || y === 0) return false;
  return Math.min(x, y) / Math.max(x, y) >= COMPARABLE_RATIO;
}

/**
 * Keys a game's session stopped receiving: delivered (≥ MIN_BASELINE_VALUES) in the
 * nearest earlier comparable session of the same game, never delivered in this one.
 * Each session is compared with its own nearest comparable predecessor, so a key
 * that stays gone is reported once, at the session where it first went missing.
 * @param {GepSession[]} sessions  chronological
 * @returns {GepDropout[]}
 */
export function findDropouts(sessions) {
  /** @type {GepDropout[]} */
  const out = [];
  /** @type {Map<string, GepSession[]>} */
  const byGame = new Map();
  for (const s of sessions) {
    const k = s.gameId ?? "?";
    byGame.set(k, [...(byGame.get(k) ?? []), s]);
  }
  for (const list of byGame.values()) {
    for (let i = 1; i < list.length; i++) {
      const cur = list[i];
      let base;
      for (let j = i - 1; j >= 0; j--) {
        if (comparable(list[j], cur)) {
          base = list[j];
          break;
        }
      }
      if (!base) continue;
      const flagged = (key) => cur.missing.some((m) => m.key === key.split(".").pop());
      const at = (s, values, extra) => ({ start: s.start, gepVersion: s.gepVersion, file: s.file, values, ...extra });

      for (const [key, st] of Object.entries(base.info)) {
        if (st.values < MIN_BASELINE_VALUES || (cur.info[key]?.values ?? 0) > 0) continue;
        out.push({
          gameId: cur.gameId,
          gameName: cur.gameName ?? base.gameName,
          key,
          kind: "info",
          before: at(base, st.values, { pluginValues: pluginValues(base, key) }),
          after: at(cur, 0, { updates: cur.info[key]?.updates ?? 0, pluginValues: pluginValues(cur, key) }),
          flaggedMissing: flagged(key),
        });
      }
      for (const [key, n] of Object.entries(base.events)) {
        if (n < MIN_BASELINE_VALUES || (cur.events[key] ?? 0) > 0) continue;
        out.push({
          gameId: cur.gameId,
          gameName: cur.gameName ?? base.gameName,
          key,
          kind: "event",
          before: at(base, n, { pluginValues: null }),
          after: at(cur, 0, { updates: 0, pluginValues: null }),
          flaggedMissing: flagged(key),
        });
      }
    }
  }
  return out;
}

/** True when a session delivered `gepKey` ("feature.key" or a bare "key"). */
function matchesKey(sessionKey, gepKey) {
  const want = groupKey(gepKey);
  if (sessionKey === want) return true;
  // A bare key matches it under any feature; a qualified one only exactly.
  return !want.includes(".") && sessionKey.split(".").pop() === want;
}

/**
 * For an app symptom that depends on specific GEP keys, place each hit in the GEP
 * session it happened in and report what GEP delivered for those keys there.
 * A session with hits and ZERO values means GEP never sent the data — the symptom
 * is upstream, not the app's.
 * @param {GepSession[]} sessions
 * @param {string[]} gepKeys  "feature.key" or bare "key"
 * @param {(number|undefined)[]} hitTimestamps
 * @param {number} [graceMs]  how long after GEP's last line in a session a hit still
 *   belongs to it (apps often finish a match's bookkeeping just after the game closes)
 */
export function correlateGepKeys(sessions, gepKeys, hitTimestamps, graceMs = 5 * 60 * 1000) {
  const rows = new Map();
  let unplaced = 0;
  for (const ts of hitTimestamps) {
    if (typeof ts !== "number") {
      unplaced++;
      continue;
    }
    const s = sessions.find((x) => x.start != null && x.end != null && ts >= x.start && ts <= x.end + graceMs);
    if (!s) {
      unplaced++;
      continue;
    }
    const row = rows.get(s) ?? { start: s.start, end: s.end, gameName: s.gameName, gepVersion: s.gepVersion, hits: 0, values: countValues(s, gepKeys) };
    row.hits++;
    rows.set(s, row);
  }
  const out = [...rows.values()].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  for (const r of out) r.gepSentNone = Object.values(r.values).every((n) => n === 0);
  return { keys: gepKeys, sessions: out, unplaced };
}

function countValues(s, gepKeys) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const k of gepKeys) {
    let n = 0;
    for (const [sk, st] of Object.entries(s.info)) if (matchesKey(sk, k)) n += st.values;
    for (const [sk, c] of Object.entries(s.events)) if (matchesKey(sk, k)) n += c;
    out[k] = n;
  }
  return out;
}

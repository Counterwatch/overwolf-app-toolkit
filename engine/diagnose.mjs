// Orchestrates a full diagnosis of an extracted Overwolf log bundle:
//   read bundle → parse logs → extract environment → run detectors →
//   correlate activity-vs-sync → build timeline → return one plain object.
// The returned object is what the overwolf-log-doctor skill consumes.

import { readFileSync } from "node:fs";

import { readBundle, fileLabel, isPlatformApp, isGepProviderApp } from "./bundle.mjs";
import { parseLines, splitSessions, timeSpan } from "./logline.mjs";
import { DETECTORS, levelSeverity, severityRank } from "./detectors.mjs";
import { clusterMessages, distinctCount } from "./cluster.mjs";

const PARSE_CATEGORIES = new Set(["platform-trace", "updater", "app-log", "system-app-log", "browser-crash"]);
const MAX_READ_BYTES = 8 * 1024 * 1024;
const MAX_EVIDENCE = 8;
const MAX_TIMELINE = 80;

/**
 * Which files a detector's scope applies to.
 *  - "app":      the developer app's own logs only.
 *  - "overwolf": the Overwolf platform's own files (traces, updater, service) —
 *                NOT the developer app and NOT Overwolf's bundled system apps.
 *  - "any":      everything.
 * @param {string} scope @param {string} cat
 */
function inScope(scope, cat) {
  if (scope === "app") return cat === "app-log";
  if (scope === "overwolf") return cat !== "app-log" && cat !== "system-app-log";
  return true;
}

/**
 * Decide which app is the developer's. A bundle usually contains several apps
 * (the dev's app, Overwolf's own helper apps, and other third-party apps); the
 * developer only cares about their own app and the Overwolf platform.
 * @returns {{name: string|null, requested: string|null, inferred: boolean, matched: boolean}}
 */
function resolveOwnedApp(inventory, requested) {
  const names = inventory.apps.map((a) => a.name);
  if (requested) {
    const r = String(requested).toLowerCase();
    const hit =
      names.find((n) => n.toLowerCase() === r) ??
      names.find((n) => n.toLowerCase().includes(r) || r.includes(n.toLowerCase()));
    return { name: hit ?? null, requested, inferred: false, matched: Boolean(hit) };
  }
  return { name: inventory.primaryApp, requested: null, inferred: true, matched: Boolean(inventory.primaryApp) };
}

/** Classify a file as the developer's app, the Overwolf platform, or another app. */
function fileRole(category, app, ownedName) {
  if (!app) return "platform"; // root traces, updater, crash, etc.
  if (ownedName && app.toLowerCase() === ownedName.toLowerCase()) return "owned";
  if (category === "system-app-log" || isPlatformApp(app)) return "platform";
  return "other";
}

/** Diagnostic weight by window: the background/main window holds the business logic. */
function windowWeight(window) {
  if (!window) return 1;
  if (/^(background|main|index|controller|service|kernel)/i.test(window)) return 3;
  if (/^(in_?game|overlay)/i.test(window)) return 1.5;
  return 1;
}

function safeRead(path, size) {
  if (size > MAX_READ_BYTES) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function firstMatch(text, re) {
  const m = re.exec(text);
  return m ? (m[1] ?? m[0]).trim() : undefined;
}

// Leading "YYYY-MM-DD HH:MM:SS,mmm" timestamp of a log line — used to order
// matches by recency via lexicographic compare (valid because Overwolf zero-pads
// to fixed width). Approximates logline.mjs's LINE_RE <ts> group but is
// intentionally looser (optional/variable-width fraction, no level token) so it
// still anchors lines the full parser would reject.
const TS_PREFIX = /^\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}[.,]?\d*)/;

/**
 * Like firstMatch, but returns the capture from the matching line bearing the
 * GREATEST leading timestamp — the value the user is on NOW, not the oldest in a
 * months-spanning bundle of rotated logs. Pass MULTIPLE patterns to locate the
 * SAME fact several ways (e.g. an Overwolf version via "CurrentVersion:" or its
 * install path): the globally-latest line matching ANY pattern wins, so a newer
 * session isn't missed just because it used a different locator. Ties and
 * untimestamped matches keep the first occurrence (the ts compare is strict).
 */
function latestMatch(text, ...regexes) {
  const compiled = regexes.map((re) => new RegExp(re.source, re.flags.replace(/g/, "")));
  let best;
  let bestTs = "";
  for (const line of text.split("\n")) {
    let captured;
    for (const re of compiled) {
      const m = re.exec(line);
      if (m) {
        captured = (m[1] ?? m[0]).trim();
        break;
      }
    }
    if (captured === undefined) continue;
    const ts = (TS_PREFIX.exec(line) || ["", ""])[1];
    if (best === undefined || ts > bestTs) {
      best = captured;
      bestTs = ts;
    }
  }
  return best;
}

/** Pull environment facts from platform traces + crash files + app logs. */
function extractEnvironment(platformText, appText, gepText = "") {
  const all = platformText + "\n" + appText;
  const env = {
    // app / Overwolf / GEP versions all auto-update over a months-spanning bundle,
    // so report the MOST RECENT occurrence (latestMatch); firstMatch would return a
    // stale version the user upgraded away from.
    // The app's own version: the authoritative boot line wins when present (even
    // over a later "App version:" line, which may be an analytics/telemetry value);
    // else fall back to "App version:". Both from the dev app's logs (appText).
    appVersion: latestMatch(appText, /\bbooting version\s+([\w.]+)/i) ?? latestMatch(appText, /\bapp version[:=]?\s*([\w.]+)/i),
    // Overwolf client version is a PLATFORM fact (in the traces), so read it from
    // platformText only — app logs would pollute it with their own "App version".
    // All three locators require Overwolf's 4-segment client version (CurrentVersion:,
    // the install path ...\Overwolf\X, or "Overwolf <ver>"). The 4-segment shape is
    // what makes global-latest safe: loose 2-3 segment component versions (e.g.
    // "LevelDB version: 1.22", the app's "2.46.0", an "Overwolf 2.x" product string)
    // can't win, so latestMatch may take the globally-latest across the three.
    overwolfVersion: latestMatch(
      platformText,
      /\bCurrentVersion\D{1,4}(\d+\.\d+\.\d+\.\d+)\b/i,
      /\bOverwolf[\\/](\d+\.\d+\.\d+\.\d+)\b/i,
      /\bOverwolf(?:\.exe)?\s+v?(\d+\.\d+\.\d+\.\d+)\b/i
    ),
    // GEP version is an app-agnostic fact from Overwolf's own GameEvents Provider
    // logs ("[GEP] Running version X", or a "local_version" event), via gepText.
    gepVersion: latestMatch(
      gepText,
      /\[GEP\]\s+Running version\s+(\d+(?:\.\d+){1,3})/i,
      /local_version\D{1,6}(\d+(?:\.\d+){1,3})/i
    ),
    // os/gpu/timezone are user-constant within a bundle, so first === latest; keep
    // firstMatch (their regexes are loose, and the first hit is the authoritative
    // trace-header identification line, not an incidental later mention).
    os: firstMatch(all, /\b(Windows\s+\d+[^\n,(]*)/i),
    gpu: firstMatch(all, /\b((?:NVIDIA|AMD|Intel|Radeon|GeForce)[^\n,]{0,40})/i),
    timezone: firstMatch(all, /\bTimeZone[:=]?\s*([^\n,]{2,40})/i) ?? firstMatch(all, /\b(UTC[+-]\d{1,2}(?::\d{2})?)/i),
  };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return env;
}

/** Read and parse Crash.json / ExceptionDetails.txt into a crash signal, if any. */
function crashSignal(files) {
  const crashJson = files.find((f) => /crash\.json$/i.test(f.name));
  const details = files.find((f) => /exceptiondetails\.txt$/i.test(f.name));
  if (!crashJson && !details) return null;

  /** @type {any} */
  let info = {};
  if (crashJson) {
    const txt = safeRead(crashJson.path, crashJson.size);
    try {
      info = JSON.parse(txt ?? "{}");
    } catch {
      info = {};
    }
  }
  // The "send logs" action itself records a Crash.json entry — that is telemetry
  // for the upload, NOT an app crash. Classify it gently so we don't cry wolf.
  const subsystem = String(info.SubSystem ?? info.Process ?? "");
  const isLogUpload = /\blogs?\b/i.test(subsystem) || /send logs/i.test(String(info.MessageAndStack ?? ""));
  const message = String(info.MessageAndStack ?? info.Message ?? (details ? "Captured exception details present" : "")).split(/\r?\n/)[0];

  return {
    id: "crash-report",
    title: isLogUpload ? "Crash telemetry present (log-upload, not an app crash)" : "Crash / exception captured",
    category: "crash",
    severity: isLogUpload ? "info" : "error",
    count: 1,
    evidence: [
      {
        file: fileLabel(crashJson ?? details),
        ts: Date.parse(String(info.ExceptionDate ?? "")) || null,
        level: isLogUpload ? "INFO" : "ERROR",
        message: message.slice(0, 300),
      },
    ],
    data: {
      version: info.Version,
      date: info.ExceptionDate,
      subsystem: info.SubSystem,
      isLogUpload,
      hasExceptionDetails: Boolean(details),
    },
  };
}

/**
 * Run the full diagnosis.
 * @param {string} dir  extracted bundle directory
 * @param {{ extraDetectors?: object[] }} [opts]
 */
export function diagnose(dir, opts = {}) {
  const inventory = readBundle(dir);
  const detectors = [...DETECTORS, ...(opts.extraDetectors ?? [])];
  const ownedApp = resolveOwnedApp(inventory, opts.ownedApp);

  // Parse every log file we care about, tagging each entry with its file ctx.
  /** @type {{entry: any, ctx: {file: any}, label: string}[]} */
  const tagged = [];
  let platformText = "";
  let appText = "";
  let gepText = ""; // Overwolf's GameEvents Provider logs — source of the GEP version
  const sessionsByFile = [];

  for (const f of inventory.files) {
    if (!PARSE_CATEGORIES.has(f.category)) continue;
    const text = safeRead(f.path, f.size);
    if (text == null) continue;
    const role = fileRole(f.category, f.app, ownedApp.name);
    if (f.category === "platform-trace") platformText += "\n" + text;
    if (role === "owned") appText += "\n" + text; // env facts come from the dev's own app
    if (isGepProviderApp(f.app)) gepText += "\n" + text;

    const entries = parseLines(text);
    const ctx = { file: { category: f.category, app: f.app, window: f.window, role, system: role === "platform" && Boolean(f.app) } };
    const label = fileLabel(f);
    for (const e of entries) tagged.push({ entry: e, ctx, label });

    if (f.category === "app-log" && f.rotation === 0) {
      const sessions = splitSessions(entries);
      sessionsByFile.push({
        file: label,
        window: f.window,
        sessions: sessions.map((s) => {
          const span = timeSpan(s);
          return { entries: s.length, start: span.start ?? null, end: span.end ?? null };
        }),
      });
    }
  }

  // Run detectors. Each detector collects its matching entries as evidence.
  /** @type {import("./types.js").Signal[]} */
  const signals = [];
  const matchedById = new Map();
  for (const d of detectors) {
    const matches = [];
    for (const { entry, ctx, label } of tagged) {
      if (entry.message === undefined && entry.level === undefined) continue;
      if (ctx.file.role === "other") continue; // not the developer's app or Overwolf — ignore
      if (!inScope(d.scope ?? "any", ctx.file.category)) continue;
      let ok = false;
      try {
        ok = d.match(entry, ctx);
      } catch {
        ok = false;
      }
      if (ok) matches.push({ entry, label });
    }
    if (matches.length === 0) continue;
    matchedById.set(d.id, matches);

    // Effective severity = max of the detector's floor and its evidence levels —
    // EXCEPT for informational "activity" detectors (auth/sync/game), which stay at
    // their floor so a single error line doesn't paint the whole category red.
    let sev = d.severity ?? "notice";
    if (!d.informational) {
      for (const m of matches) {
        const ls = levelSeverity(m.entry.level);
        if (severityRank(ls) > severityRank(sev)) sev = ls;
      }
    }

    const evidence = matches
      .slice()
      .sort((a, b) => {
        const s = severityRank(levelSeverity(b.entry.level)) - severityRank(levelSeverity(a.entry.level));
        if (s !== 0) return s;
        return (b.entry.ts ?? 0) - (a.entry.ts ?? 0);
      })
      .slice(0, MAX_EVIDENCE)
      .map((m) => ({
        file: m.label,
        ts: m.entry.ts ?? null,
        level: m.entry.level ?? "—",
        message: String(m.entry.message ?? m.entry.raw ?? "").slice(0, 300),
      }));

    /** @type {import("./types.js").Signal} */
    const signal = { id: d.id, title: d.title, category: d.category, severity: sev, count: matches.length, evidence };
    if (typeof d.summarize === "function") {
      try {
        signal.data = d.summarize(matches.map((m) => m.entry));
      } catch {
        /* ignore summarize errors */
      }
    }
    signals.push(signal);
  }

  const crash = crashSignal(inventory.files);
  if (crash) signals.push(crash);

  // Correlation: activity recorded after the last successful sync.
  const correlations = [];
  const syncData = signals.find((s) => s.id === "sync-signal")?.data;
  const gameMatches = matchedById.get("game-detection") ?? [];
  const lastActivityTs = gameMatches.reduce((max, m) => Math.max(max, m.entry.ts ?? 0), 0) || null;
  const lastSyncTs = syncData?.lastCompleteTs ?? syncData?.lastPushedTs ?? null;

  // Only flag a meaningful gap (>60s) — a few seconds of activity after the last
  // sync is the normal end-of-session pattern and isn't worth surfacing.
  if (lastActivityTs && lastSyncTs && lastActivityTs > lastSyncTs + 60000) {
    correlations.push({
      id: "activity-after-sync",
      severity: "notice",
      message:
        "Game/app activity was recorded well after the last successful sync — if the user reports " +
        "missing data, check whether anything generated after that point reached the server.",
      data: { lastActivityTs, lastSyncTs },
    });
  }
  if (syncData && syncData.sawComplete && syncData.lastPushed === 0 && lastActivityTs) {
    correlations.push({
      id: "synced-but-zero-pushed",
      severity: "info",
      message:
        'Observation: sync reached a "complete/fully synced" state but the last result pushed 0 ' +
        "records. Usually benign (nothing new to push); only relevant if the complaint is about data not saving.",
      data: { lastPushed: syncData.lastPushed, lastActivityTs },
    });
  }

  // Timeline: warnings/errors plus notable detector hits, chronological.
  const notableIds = new Set(["sync-signal", "auth-signal", "gep-health", "game-detection", "network-signal"]);
  const timelineSet = new Map();
  for (const { entry, label } of tagged) {
    const isLevel = entry.level === "WARN" || entry.level === "ERROR" || entry.level === "FATAL";
    if (!isLevel) continue;
    timelineSet.set(entry, { ts: entry.ts ?? null, level: entry.level, file: label, message: String(entry.message ?? "").slice(0, 200) });
  }
  for (const id of notableIds) {
    for (const m of matchedById.get(id) ?? []) {
      if (timelineSet.has(m.entry)) continue;
      timelineSet.set(m.entry, { ts: m.entry.ts ?? null, level: m.entry.level ?? "INFO", file: m.label, message: String(m.entry.message ?? "").slice(0, 200), signal: id });
    }
  }
  const timeline = [...timelineSet.values()]
    .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
    .slice(0, MAX_TIMELINE);

  // Cluster the actual error/warning messages, split by who owns the log:
  //  - owned:    the developer's app  → topErrors / topWarnings (the headline)
  //  - platform: Overwolf itself      → platformErrors (could be the source)
  //  - other:    third-party apps     → counted only, not detailed (not the dev's bug)
  const ownedErr = [];
  const ownedWarn = [];
  const platformErr = [];
  let platformWarnLines = 0;
  const otherErr = new Map();
  const otherWarn = new Map();
  for (const { entry, ctx, label } of tagged) {
    const isErr = entry.level === "ERROR" || entry.level === "FATAL";
    const isWarn = entry.level === "WARN";
    if (!isErr && !isWarn) continue;
    const item = { message: entry.message ?? entry.raw, level: entry.level, ts: entry.ts, file: label, window: ctx.file.window };
    if (ctx.file.role === "owned") (isErr ? ownedErr : ownedWarn).push(item);
    else if (ctx.file.role === "platform") {
      if (isErr) platformErr.push(item);
      else platformWarnLines++;
    } else {
      const m = isErr ? otherErr : otherWarn;
      m.set(ctx.file.app, (m.get(ctx.file.app) ?? 0) + 1);
    }
  }
  // Section caps — overridable with --limit for apps that spam errors/warnings.
  const lim = (n) => (Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : n);
  // Rank owned errors so the background/main window (where business logic lives,
  // per Overwolf best practice) floats up over noisy UI-window errors.
  const topErrors = clusterMessages(ownedErr, { limit: lim(8), score: (c) => c.count * windowWeight(c.window) });
  const topWarnings = clusterMessages(ownedWarn, { limit: lim(5) });
  const platformErrors = clusterMessages(platformErr, { limit: lim(6) });
  const otherApps = [...new Set([...otherErr.keys(), ...otherWarn.keys()])]
    .map((name) => ({ name, errors: otherErr.get(name) ?? 0, warnings: otherWarn.get(name) ?? 0 }))
    .sort((a, b) => b.errors - a.errors);

  // Volume totals so a reader can see (and throttle) spam: raw lines vs. distinct.
  const volume = {
    ownedErrors: { lines: ownedErr.length, distinct: distinctCount(ownedErr) },
    ownedWarnings: { lines: ownedWarn.length, distinct: distinctCount(ownedWarn) },
    platformErrors: { lines: platformErr.length, distinct: distinctCount(platformErr) },
    platformWarnings: { lines: platformWarnLines },
  };

  const environment = extractEnvironment(platformText, appText, gepText);

  // Rank signals high→low severity for presentation.
  signals.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.count - a.count);

  return {
    schema: "overwolf-log-doctor/diagnosis@1",
    bundle: {
      valid: inventory.valid,
      root: inventory.root,
      primaryApp: inventory.primaryApp,
      apps: inventory.apps.map((a) => ({
        name: a.name,
        role: a.name === ownedApp.name ? "owned" : a.system ? "platform" : "other",
        files: a.files.length,
        bytes: a.bytes,
      })),
      fileCount: inventory.files.length,
      categories: countBy(inventory.files, (f) => f.category),
    },
    ownedApp,
    environment,
    volume,
    topErrors,
    topWarnings,
    platformErrors,
    otherApps,
    sessions: sessionsByFile,
    signals,
    correlations,
    timeline,
  };
}

function countBy(arr, keyFn) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const x of arr) {
    const k = keyFn(x);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

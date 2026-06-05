// Orchestrates a full diagnosis of an extracted Overwolf log bundle:
//   read bundle → parse logs → extract environment → run detectors →
//   correlate activity-vs-sync → build timeline → return one plain object.
// The returned object is what the overwolf-log-doctor skill consumes.

import { readFileSync } from "node:fs";

import { readBundle, fileLabel } from "./bundle.mjs";
import { parseLines, splitSessions, timeSpan } from "./logline.mjs";
import { DETECTORS, levelSeverity, severityRank } from "./detectors.mjs";

const PARSE_CATEGORIES = new Set(["platform-trace", "updater", "app-log", "system-app-log"]);
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

/** Pull environment facts from platform traces + crash files + app logs. */
function extractEnvironment(platformText, appText) {
  const all = platformText + "\n" + appText;
  const env = {
    appVersion: firstMatch(appText, /\bbooting version\s+([\w.]+)/i) ?? firstMatch(all, /\bapp version[:=]?\s*([\w.]+)/i),
    overwolfVersion: firstMatch(all, /\bOverwolf(?:\.exe)?\s+v?(\d+(?:\.\d+){1,3})/i) ?? firstMatch(all, /"?Version"?\s*[:=]\s*"?(\d+(?:\.\d+){1,3})/i),
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

  // Parse every log file we care about, tagging each entry with its file ctx.
  /** @type {{entry: any, ctx: {file: any}, label: string}[]} */
  const tagged = [];
  let platformText = "";
  let appText = "";
  const sessionsByFile = [];

  for (const f of inventory.files) {
    if (!PARSE_CATEGORIES.has(f.category)) continue;
    const text = safeRead(f.path, f.size);
    if (text == null) continue;
    if (f.category === "platform-trace") platformText += "\n" + text;
    if (f.category === "app-log") appText += "\n" + text;

    const entries = parseLines(text);
    const ctx = { file: { category: f.category, app: f.app, window: f.window, system: Boolean(f.app && /^overwolf\b/i.test(f.app)) } };
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

    // Effective severity = max of the detector's floor and its evidence levels.
    let sev = d.severity ?? "notice";
    for (const m of matches) {
      const ls = levelSeverity(m.entry.level);
      if (severityRank(ls) > severityRank(sev)) sev = ls;
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

  if (lastActivityTs && lastSyncTs && lastActivityTs > lastSyncTs + 5000) {
    correlations.push({
      id: "activity-after-sync",
      severity: "warn",
      message:
        "Game/app activity was recorded after the last successful sync. Data generated after that " +
        "point may not have reached the server.",
      data: { lastActivityTs, lastSyncTs },
    });
  }
  if (syncData && syncData.sawComplete && syncData.lastPushed === 0 && lastActivityTs) {
    correlations.push({
      id: "synced-but-zero-pushed",
      severity: "notice",
      message:
        'Sync reported a "complete/fully synced" state but the last result pushed 0 records, despite ' +
        "recorded activity. Either there was nothing new to push, or new data was not captured into the sync set.",
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

  const environment = extractEnvironment(platformText, appText);

  // Rank signals high→low severity for presentation.
  signals.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.count - a.count);

  return {
    schema: "overwolf-log-doctor/diagnosis@1",
    bundle: {
      valid: inventory.valid,
      root: inventory.root,
      primaryApp: inventory.primaryApp,
      apps: inventory.apps.map((a) => ({ name: a.name, system: a.system, files: a.files.length, bytes: a.bytes })),
      fileCount: inventory.files.length,
      categories: countBy(inventory.files, (f) => f.category),
    },
    environment,
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

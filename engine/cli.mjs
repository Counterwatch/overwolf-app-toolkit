#!/usr/bin/env node
// overwolf-log-doctor CLI: analyze an Overwolf support-log bundle (zip or folder)
// and print a structured diagnosis (--json) or a human-readable report (--report).
//
//   node engine/cli.mjs <zip|dir> [--json|--report] [--redact] [--rules <path>]

import { diagnose } from "./diagnose.mjs";
import { loadRulePack } from "./detectors.mjs";
import { resolveBundleDir } from "./extract.mjs";
import { createRedactor } from "./redact.mjs";

const HELP = `overwolf-log-doctor — diagnose an Overwolf app support-log bundle

Usage:
  node engine/cli.mjs <path-to-zip-or-folder> [options]

Options:
  --app <name>      Your app's name (the Apps/<name> folder). Focuses the report on
                    your app + Overwolf; other apps in the bundle are ignored. If
                    omitted, the largest non-Overwolf app is assumed.
  --json            Emit the diagnosis as JSON (machine-readable; what the skill uses).
  --report          Emit a human-readable report (default).
  --redact          Mask PII (emails, UUIDs, tokens, gamertags, home paths, IPs).
  --rules <path>    Load extra app-specific detectors from a JS/JSON rule pack.
  --limit <n>       Max distinct messages per section (default 8/5/6). Raise it for
                    apps with lots of distinct errors/warnings.
  -h, --help        Show this help.

Privacy: a bundle contains a real end-user's data. Use --redact before sharing output.`;

function parseArgs(argv) {
  const args = { input: undefined, json: false, report: false, redact: false, rules: undefined, app: undefined, limit: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--report") args.report = true;
    else if (a === "--redact") args.redact = true;
    else if (a === "--rules") args.rules = argv[++i];
    else if (a === "--app") args.app = argv[++i];
    else if (a === "--limit") args.limit = parseInt(argv[++i], 10);
    else if (a === "-h" || a === "--help") args.help = true;
    else if (!a.startsWith("-") && args.input === undefined) args.input = a;
  }
  return args;
}

const SEV_BADGE = { critical: "[CRIT]", error: "[ERR ]", warn: "[WARN]", notice: "[NOTE]", info: "[INFO]" };

function fmtTs(ts) {
  // Overwolf timestamps are local wall-clock and were parsed as local, so format
  // them back with local components — converting to UTC would visibly shift them.
  if (typeof ts !== "number" || !Number.isFinite(ts)) return "—";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Catch-all / informational signals whose content is already covered by the
// clustered Top-errors/Top-warnings sections — show them as counts, not evidence.
const OVERVIEW_ONLY = new Set(["error-line", "warning-line", "app-exception", "auth-signal", "sync-signal", "game-detection"]);

function renderReport(d) {
  const lines = [];
  const h = (s) => lines.push("", s, "=".repeat(s.length));
  const clean = (m, n = 160) => String(m).replace(/\n/g, " ⏎ ").slice(0, n);

  h("Overwolf Log Doctor — diagnosis");
  lines.push(`Bundle valid: ${d.bundle.valid ? "yes" : "NO (does not look like an Overwolf bundle)"}`);
  const oa = d.ownedApp ?? { name: d.bundle.primaryApp, inferred: true, matched: true, requested: null };
  let appLine = `Your app: ${oa.name ?? "(none detected)"}`;
  if (oa.requested && !oa.matched) appLine += ` — ⚠ requested "${oa.requested}" not found; nothing scoped to it`;
  else if (oa.inferred) appLine += ` (inferred as the largest non-Overwolf app — pass --app to confirm)`;
  lines.push(appLine);
  lines.push(`Files: ${d.bundle.fileCount} (${Object.entries(d.bundle.categories).map(([k, v]) => `${k}:${v}`).join(", ")})`);

  if (Object.keys(d.environment).length) {
    h("Environment");
    for (const [k, v] of Object.entries(d.environment)) lines.push(`  ${k}: ${v}`);
  }

  const vol = d.volume ?? {};
  // "N lines → M distinct" so spam is visible; footer when the list is capped.
  const withVol = (title, v, shown) => (v && v.lines ? `${title}  (${v.lines} lines → ${v.distinct} distinct)` : title);
  const moreFooter = (v, shown) => {
    if (v && v.distinct > shown) lines.push(`  … +${v.distinct - shown} more distinct (use --limit ${v.distinct} to show all)`);
  };

  // The headline: the developer app's distinct errors, background/main weighted.
  h(withVol(`Top errors — ${oa.name ?? "your app"} (background/main prioritized)`, vol.ownedErrors));
  if (!d.topErrors?.length) lines.push("  (no error-level lines in your app's logs)");
  for (const c of d.topErrors ?? []) {
    lines.push(`  ${String(c.count).padStart(6)}×  (${c.level}) ${clean(c.sample, 150)}`);
    lines.push(`           ${c.window ? `[${c.window}] ` : ""}${c.file ?? ""} · ${fmtTs(c.firstTs)} → ${fmtTs(c.lastTs)}`);
  }
  moreFooter(vol.ownedErrors, (d.topErrors ?? []).length);

  if (d.topWarnings?.length) {
    h(withVol(`Top warnings — ${oa.name ?? "your app"}`, vol.ownedWarnings));
    for (const c of d.topWarnings) lines.push(`  ${String(c.count).padStart(6)}×  ${c.window ? `[${c.window}] ` : ""}${clean(c.sample, 120)}`);
    moreFooter(vol.ownedWarnings, d.topWarnings.length);
  }

  if (d.platformErrors?.length) {
    h(withVol("Overwolf platform errors (Overwolf's own logs — may be the source, not your code)", vol.platformErrors));
    for (const c of d.platformErrors) {
      lines.push(`  ${String(c.count).padStart(6)}×  (${c.level}) ${clean(c.sample, 150)}`);
      lines.push(`           ${c.file ?? ""} · ${fmtTs(c.firstTs)} → ${fmtTs(c.lastTs)}`);
    }
    moreFooter(vol.platformErrors, d.platformErrors.length);
    if (vol.platformWarnings?.lines) lines.push(`  (plus ${vol.platformWarnings.lines} Overwolf warning lines, not shown)`);
  }

  if (d.otherApps?.length) {
    h("Other apps in the bundle (not yours — ignored)");
    for (const a of d.otherApps) lines.push(`  ${a.name}: ${a.errors} errors, ${a.warnings} warnings (skipped)`);
  }

  if (d.correlations.length) {
    h("Correlations");
    for (const c of d.correlations) lines.push(`  ${SEV_BADGE[c.severity] ?? "[NOTE]"} ${c.message}`);
  }

  if (d.sessions.length) {
    h("Sessions");
    for (const s of d.sessions.slice(0, 10)) {
      lines.push(`  ${s.file}:`);
      s.sessions.forEach((ses, i) => lines.push(`    #${i + 1}  ${fmtTs(ses.start)} → ${fmtTs(ses.end)}  (${ses.entries} entries)`));
    }
    if (d.sessions.length > 10) lines.push(`  … (+${d.sessions.length - 10} more log files)`);
  }

  h(`Signal categories (${d.signals.length})`);
  if (!d.signals.length) lines.push("  (none)");
  for (const sig of d.signals) {
    lines.push(`  ${SEV_BADGE[sig.severity] ?? "[INFO]"} ${sig.title} — ${sig.count} hit(s) [${sig.id}]`);
    if (sig.data && Object.keys(sig.data).length) {
      const compact = Object.entries(sig.data).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(", ");
      if (compact) lines.push(`        data: ${compact}`);
    }
    // Evidence only for specific problem signals — the catch-alls are in Top errors.
    if (!OVERVIEW_ONLY.has(sig.id)) {
      for (const ev of sig.evidence.slice(0, 2)) lines.push(`        · ${fmtTs(ev.ts)} (${ev.level}) ${ev.file}: ${clean(ev.message)}`);
    }
  }

  h("Timeline (chronological, notable events)");
  if (!d.timeline.length) lines.push("  (none)");
  for (const t of d.timeline.slice(0, 30)) lines.push(`  ${fmtTs(t.ts)} (${t.level}) ${t.file}: ${clean(t.message, 200)}`);

  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input) {
    process.stdout.write(HELP + "\n");
    process.exit(args.input ? 0 : 1);
  }

  let extraDetectors = [];
  if (args.rules) {
    const { pathToFileURL } = await import("node:url");
    const { resolve } = await import("node:path");
    extraDetectors = await loadRulePack(pathToFileURL(resolve(args.rules)).href);
  }

  const resolved = resolveBundleDir(args.input);
  try {
    let diagnosis = diagnose(resolved.dir, { extraDetectors, ownedApp: args.app, limit: args.limit });
    // Don't leak the temp extraction path or input path in shareable output.
    diagnosis = { ...diagnosis, bundle: { ...diagnosis.bundle, root: resolved.extracted ? "(extracted)" : diagnosis.bundle.root } };
    if (args.redact) diagnosis = createRedactor().redactDeep(diagnosis);

    if (args.json) process.stdout.write(JSON.stringify(diagnosis, null, 2) + "\n");
    else {
      process.stdout.write(renderReport(diagnosis) + "\n");
      if (!args.redact) process.stderr.write("\nNote: run with --redact before sharing this output.\n");
    }
  } finally {
    resolved.cleanup();
  }
}

main().catch((err) => {
  process.stderr.write(`overwolf-log-doctor: ${err?.message ?? err}\n`);
  process.exit(1);
});

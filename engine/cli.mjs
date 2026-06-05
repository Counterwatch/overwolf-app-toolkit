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
  --json            Emit the diagnosis as JSON (machine-readable; what the skill uses).
  --report          Emit a human-readable report (default).
  --redact          Mask PII (emails, UUIDs, tokens, gamertags, home paths, IPs).
  --rules <path>    Load extra app-specific detectors from a JS/JSON rule pack.
  -h, --help        Show this help.

Privacy: a bundle contains a real end-user's data. Use --redact before sharing output.`;

function parseArgs(argv) {
  const args = { input: undefined, json: false, report: false, redact: false, rules: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--report") args.report = true;
    else if (a === "--redact") args.redact = true;
    else if (a === "--rules") args.rules = argv[++i];
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

function renderReport(d) {
  const lines = [];
  const h = (s) => lines.push("", s, "=".repeat(s.length));

  h("Overwolf Log Doctor — diagnosis");
  lines.push(`Bundle valid: ${d.bundle.valid ? "yes" : "NO (does not look like an Overwolf bundle)"}`);
  lines.push(`Primary app folder: ${d.bundle.primaryApp ?? "(none detected)"}`);
  lines.push(`Files: ${d.bundle.fileCount} (${Object.entries(d.bundle.categories).map(([k, v]) => `${k}:${v}`).join(", ")})`);

  if (Object.keys(d.environment).length) {
    h("Environment");
    for (const [k, v] of Object.entries(d.environment)) lines.push(`  ${k}: ${v}`);
  }

  if (d.correlations.length) {
    h("Correlations (read these first)");
    for (const c of d.correlations) lines.push(`  ${SEV_BADGE[c.severity] ?? "[NOTE]"} ${c.message}`);
  }

  if (d.sessions.length) {
    h("Sessions");
    for (const s of d.sessions) {
      lines.push(`  ${s.file}:`);
      s.sessions.forEach((ses, i) => lines.push(`    #${i + 1}  ${fmtTs(ses.start)} → ${fmtTs(ses.end)}  (${ses.entries} entries)`));
    }
  }

  h(`Signals (${d.signals.length})`);
  if (!d.signals.length) lines.push("  (none)");
  for (const sig of d.signals) {
    lines.push(`  ${SEV_BADGE[sig.severity] ?? "[INFO]"} ${sig.title} — ${sig.count} hit(s) [${sig.id}]`);
    if (sig.data && Object.keys(sig.data).length) {
      const compact = Object.entries(sig.data).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(", ");
      if (compact) lines.push(`        data: ${compact}`);
    }
    for (const ev of sig.evidence.slice(0, 4)) lines.push(`        · ${fmtTs(ev.ts)} (${ev.level}) ${ev.file}: ${ev.message.replace(/\n/g, " ⏎ ")}`);
  }

  h("Timeline (chronological, notable events)");
  if (!d.timeline.length) lines.push("  (none)");
  for (const t of d.timeline) lines.push(`  ${fmtTs(t.ts)} (${t.level}) ${t.file}: ${t.message.replace(/\n/g, " ⏎ ")}`);

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
    let diagnosis = diagnose(resolved.dir, { extraDetectors });
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

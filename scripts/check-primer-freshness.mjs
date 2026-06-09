#!/usr/bin/env node
// Freshness canary for references/overwolf-platform-primer.md.
//
// The primer cites its sources as dev.overwolf.com links. This script fetches
// every cited page, extracts the Docusaurus article text, hashes it, and
// compares against the committed baseline (references/primer-freshness.json).
// A changed hash means the live docs moved since the primer was last verified,
// so the primer needs a human re-read of that section (a hash change does not
// itself mean the primer is wrong).
//
// Usage:
//   node scripts/check-primer-freshness.mjs            # compare; exit 1 on drift
//   node scripts/check-primer-freshness.mjs --update   # rewrite the baseline
//
// Zero dependencies (global fetch + node:crypto). Run by the scheduled
// primer-freshness workflow and by hand after refreshing the primer.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRIMER = join(root, "references", "overwolf-platform-primer.md");
const BASELINE = join(root, "references", "primer-freshness.json");

/** All distinct dev.overwolf.com pages the primer cites, anchors stripped. */
function citedUrls() {
  const text = readFileSync(PRIMER, "utf8");
  const matches = text.match(/https:\/\/dev\.overwolf\.com[^\s)\]>]*/g) ?? [];
  const cleaned = matches
    .map((u) => u.replace(/[.,;*]+$/, "").split("#")[0])
    .filter((u) => u !== "https://dev.overwolf.com");
  return [...new Set(cleaned)].sort();
}

/**
 * Hash the stable text content of a docs page. Docusaurus renders the page
 * body inside <article>; falling back to the whole HTML would churn on nav and
 * footer noise, so a missing <article> is reported as an extraction failure.
 */
function contentHash(html) {
  const article = html.match(/<article[\s>][\s\S]*?<\/article>/i)?.[0];
  if (!article) return null;
  const text = article
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(text).digest("hex");
}

async function fetchPage(url, attempt = 1) {
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const hash = contentHash(await res.text());
    return hash ? { hash } : { error: "no <article> content found" };
  } catch (err) {
    if (attempt < 2) return fetchPage(url, attempt + 1);
    return { error: `fetch failed: ${err?.message ?? err}` };
  }
}

const update = process.argv.includes("--update");
const urls = citedUrls();
if (urls.length === 0) {
  console.error("No dev.overwolf.com links found in the primer - check the regex.");
  process.exit(1);
}

const results = {};
for (const url of urls) {
  results[url] = await fetchPage(url);
}

if (update) {
  const pages = Object.fromEntries(
    Object.entries(results)
      .filter(([, r]) => r.hash)
      .map(([url, r]) => [url, r.hash]),
  );
  const failed = Object.entries(results).filter(([, r]) => r.error);
  writeFileSync(
    BASELINE,
    `${JSON.stringify({ updatedAt: new Date().toISOString().slice(0, 10), pages }, null, 2)}\n`,
  );
  console.log(`Baseline written for ${Object.keys(pages).length} pages.`);
  for (const [url, r] of failed) console.error(`  skipped ${url}: ${r.error}`);
  process.exit(failed.length > 0 ? 1 : 0);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const drift = [];
for (const url of urls) {
  const r = results[url];
  const known = baseline.pages[url];
  if (r.error) drift.push(`UNREACHABLE ${url} (${r.error})`);
  else if (!known) drift.push(`NEW PAGE   ${url} (run --update after verifying the primer covers it)`);
  else if (known !== r.hash) drift.push(`CHANGED    ${url}`);
}
for (const url of Object.keys(baseline.pages)) {
  if (!urls.includes(url)) drift.push(`REMOVED    ${url} (no longer cited by the primer)`);
}

if (drift.length > 0) {
  console.error(`Primer sources drifted since ${baseline.updatedAt}:\n`);
  for (const d of drift) console.error(`  ${d}`);
  console.error(
    "\nRe-read the changed pages, update references/overwolf-platform-primer.md if needed",
  );
  console.error(
    "(see CONTRIBUTING.md), then run this script with --update to accept the new baseline.",
  );
  process.exit(1);
}

console.log(
  `Primer sources unchanged since ${baseline.updatedAt} (${urls.length} pages checked).`,
);

#!/usr/bin/env node
// Verifies that every place a version is declared agrees, so an `npm version`
// bump can't silently leave the Claude plugin manifests behind:
//
//   package.json                              (the npm package)
//   .claude-plugin/plugin.json                (the toolkit plugin)
//   .claude-plugin/marketplace.json           (both marketplace entries)
//   plugins/console/.claude-plugin/plugin.json (the console companion plugin)
//
// The toolkit plugin ships the same content as the npm package, so its version
// tracks package.json. The console plugin versions independently but must match
// its own marketplace entry. Run with no args; exits 1 with a remediation
// message on any mismatch. Zero dependencies.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), "utf8"));

const pkg = readJson("package.json");
const toolkitPlugin = readJson(".claude-plugin/plugin.json");
const marketplace = readJson(".claude-plugin/marketplace.json");
const consolePlugin = readJson("plugins/console/.claude-plugin/plugin.json");

const marketplaceEntry = (name) => {
  const entry = marketplace.plugins.find((p) => p.name === name);
  if (!entry) throw new Error(`marketplace.json has no plugin named "${name}"`);
  return entry;
};

const failures = [];
const expectEqual = (label, actual, expectedLabel, expected) => {
  if (actual !== expected) {
    failures.push(`${label} is ${actual} but ${expectedLabel} is ${expected}`);
  }
};

expectEqual(
  ".claude-plugin/plugin.json version",
  toolkitPlugin.version,
  "package.json version",
  pkg.version,
);
expectEqual(
  'marketplace.json "overwolf-app-toolkit" version',
  marketplaceEntry("overwolf-app-toolkit").version,
  "package.json version",
  pkg.version,
);
expectEqual(
  'marketplace.json "overwolf-console" version',
  marketplaceEntry("overwolf-console").version,
  "plugins/console plugin.json version",
  consolePlugin.version,
);

if (failures.length > 0) {
  console.error("Version sync check FAILED:\n");
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    "\nWhen bumping with `npm version`, also update .claude-plugin/plugin.json and",
  );
  console.error(
    "the matching entry in .claude-plugin/marketplace.json (and the console plugin's",
  );
  console.error("two locations when it changes).");
  process.exit(1);
}

console.log(
  `Version sync OK: toolkit ${pkg.version}, console ${consolePlugin.version}.`,
);

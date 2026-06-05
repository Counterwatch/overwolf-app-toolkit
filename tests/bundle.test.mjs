import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { readBundle } from "../engine/bundle.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "fixtures", "sample-bundle");

test("categorizes platform files and app logs", () => {
  const inv = readBundle(FIXTURE);
  assert.equal(inv.valid, true);
  const cat = (name) => inv.files.find((f) => f.name === name)?.category;
  assert.equal(cat("Trace_2026-01-01_00-00_1234.log"), "platform-trace");
  assert.equal(cat("Crash.json"), "crash");
  assert.equal(cat("OverwolfUpdater.log"), "updater");
  assert.equal(cat("background.html.log"), "app-log");
});

test("detects window names and rotation indices", () => {
  const inv = readBundle(FIXTURE);
  const current = inv.files.find((f) => f.name === "background.html.log");
  assert.equal(current.window, "background");
  assert.equal(current.rotation, 0);
  const rotated = inv.files.find((f) => f.name === "background.html.1.log");
  assert.equal(rotated.rotation, 1);
});

test("flags Overwolf's own apps as system and picks the developer app as primary", () => {
  const inv = readBundle(FIXTURE);
  assert.equal(inv.primaryApp, "ExampleApp");
  assert.equal(inv.apps.find((a) => a.name === "Overwolf notifications")?.system, true);
  assert.equal(inv.apps.find((a) => a.name === "ExampleApp")?.system, false);
});

test("an empty/non-bundle directory is reported invalid", () => {
  const inv = readBundle(join(here, "fixtures", "rules-pack"));
  assert.equal(inv.valid, false);
  assert.equal(inv.primaryApp, null);
});

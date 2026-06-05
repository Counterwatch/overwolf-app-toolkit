import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

import { diagnose } from "../engine/diagnose.mjs";
import { loadRulePack } from "../engine/detectors.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "fixtures", "sample-bundle");

function byId(diag, id) {
  return diag.signals.find((s) => s.id === id);
}

test("detects a valid bundle and the non-Overwolf primary app", () => {
  const d = diagnose(FIXTURE);
  assert.equal(d.bundle.valid, true);
  assert.equal(d.bundle.primaryApp, "ExampleApp");
  assert.ok(d.bundle.apps.some((a) => a.name === "Overwolf notifications" && a.role === "platform"));
});

test("extracts environment facts from traces and app logs", () => {
  const { environment } = diagnose(FIXTURE);
  assert.equal(environment.overwolfVersion, "0.300.0.11");
  assert.equal(environment.appVersion, "2.0.0");
  assert.match(environment.os, /^Windows 11/);
  assert.match(environment.gpu, /NVIDIA/);
  assert.equal(environment.timezone, "UTC+02:00");
});

test("fires the expected generic detectors", () => {
  const d = diagnose(FIXTURE);
  for (const id of ["sync-signal", "auth-signal", "gep-health", "error-line", "network-signal", "game-detection", "updater-issue", "permissions-csp", "crash-report"]) {
    assert.ok(byId(d, id), `expected signal ${id}`);
  }
});

test("sync rollup captures zero-pushed + complete state", () => {
  const d = diagnose(FIXTURE);
  const sync = byId(d, "sync-signal");
  assert.equal(sync.data.lastPushed, 0);
  assert.equal(sync.data.sawComplete, true);
});

test("classifies the log-upload Crash.json as info, not an app crash", () => {
  const crash = byId(diagnose(FIXTURE), "crash-report");
  assert.equal(crash.severity, "info");
  assert.equal(crash.data.isLogUpload, true);
});

test("correlates activity after the last successful sync", () => {
  const { correlations } = diagnose(FIXTURE);
  const ids = correlations.map((c) => c.id);
  assert.ok(ids.includes("activity-after-sync"));
  assert.ok(ids.includes("synced-but-zero-pushed"));
});

test("summarizes one session for the current background log", () => {
  const { sessions } = diagnose(FIXTURE);
  const bg = sessions.find((s) => s.file.endsWith("background.html.log"));
  assert.ok(bg);
  assert.equal(bg.sessions.length, 1);
});

test("loads an external rule pack and runs its detectors", async () => {
  const pack = await loadRulePack(pathToFileURL(join(here, "fixtures", "rules-pack", "index.mjs")).href);
  const d = diagnose(FIXTURE, { extraDetectors: pack });
  assert.ok(d.signals.find((s) => s.id === "example-app-custom"), "custom rule should fire");
});

test("rejects a malformed rule pack", async () => {
  await assert.rejects(() => loadRulePack(pathToFileURL(join(here, "fixtures", "sample-bundle", "Crash.json")).href));
});

test("scopes errors to the developer's app; other apps are counted, not detailed", () => {
  const d = diagnose(FIXTURE, { ownedApp: "ExampleApp" });
  assert.equal(d.ownedApp.name, "ExampleApp");
  assert.equal(d.ownedApp.matched, true);
  assert.equal(d.ownedApp.inferred, false);
  assert.ok(!d.topErrors.some((c) => /mod list|modmate/i.test(c.sample)), "third-party error must not be in topErrors");
  assert.ok(d.otherApps.some((a) => a.name === "ModMate" && a.errors >= 1), "ModMate should be listed in otherApps");
});

test("Overwolf's own apps + root traces are 'platform', not 'other'", () => {
  const d = diagnose(FIXTURE, { ownedApp: "ExampleApp" });
  assert.ok(!d.otherApps.some((a) => /overwolf/i.test(a.name)));
  assert.ok(d.platformErrors.some((c) => /download manifest/i.test(c.sample)), "updater error should be a platform error");
});

test("background/main-window errors outrank UI-window errors", () => {
  const d = diagnose(FIXTURE, { ownedApp: "ExampleApp" });
  assert.equal(d.topErrors[0].window, "background");
});

test("infers the developer's app when --app is omitted", () => {
  const d = diagnose(FIXTURE);
  assert.equal(d.ownedApp.inferred, true);
  assert.equal(d.ownedApp.name, "ExampleApp");
});

test("clusters error lines into top distinct messages", () => {
  const d = diagnose(FIXTURE);
  assert.ok(d.topErrors.length >= 1);
  // the three "write failed: timeout after Nms" lines collapse into one cluster of 3
  const wf = d.topErrors.find((c) => /write failed/i.test(c.sample));
  assert.ok(wf, "expected a 'write failed' cluster");
  assert.equal(wf.count, 3);
});

test("activity detectors stay informational (a stray error doesn't paint them red)", () => {
  const d = diagnose(FIXTURE);
  assert.notEqual(byId(d, "auth-signal").severity, "error");
  assert.notEqual(byId(d, "sync-signal").severity, "error");
});

test("flags local storage / database issues", () => {
  assert.ok(byId(diagnose(FIXTURE), "database-signal"), "expected database-signal");
});

test("handles a non-bundle directory gracefully", () => {
  const d = diagnose(join(here, "fixtures", "rules-pack"));
  assert.equal(d.bundle.valid, false);
  assert.ok(Array.isArray(d.signals));
});

test("handles a missing directory without throwing", () => {
  const d = diagnose(join(here, "fixtures", "does-not-exist"));
  assert.equal(d.bundle.valid, false);
  assert.equal(d.bundle.fileCount, 0);
});

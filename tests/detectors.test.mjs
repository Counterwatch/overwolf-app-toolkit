import assert from "node:assert/strict";
import { test } from "node:test";

import { DETECTORS, SEVERITY_ORDER, levelSeverity, severityRank } from "../engine/detectors.mjs";

const get = (id) => DETECTORS.find((d) => d.id === id);
const ctx = { file: { category: "app-log", app: "ExampleApp", window: "background", system: false } };

test("severity helpers order info < warn < error", () => {
  assert.deepEqual(SEVERITY_ORDER, ["info", "notice", "warn", "error", "critical"]);
  assert.ok(severityRank("error") > severityRank("warn"));
  assert.ok(severityRank("warn") > severityRank("info"));
  assert.equal(levelSeverity("ERROR"), "error");
  assert.equal(levelSeverity("WARN"), "warn");
  assert.equal(levelSeverity("INFO"), "info");
});

test("sync detector summarize extracts pushed count and complete state", () => {
  const sync = get("sync-signal");
  const data = sync.summarize([
    { message: "Initial sync complete: 0 records pushed", ts: 1 },
    { message: "All collections fully synced", ts: 2 },
  ]);
  assert.equal(data.lastPushed, 0);
  assert.equal(data.sawComplete, true);
  assert.equal(data.lastCompleteTs, 2);
});

test("gep-health only fires on a GEP line that signals trouble", () => {
  const gep = get("gep-health");
  assert.equal(gep.match({ level: "WARN", message: "Game Events Provider appears unhealthy" }, ctx), true);
  assert.equal(gep.match({ level: "INFO", message: "GEP healthy, all good" }, ctx), false);
});

test("network detector matches common connectivity errors", () => {
  const net = get("network-signal");
  assert.ok(net.match({ message: "fetch failed: net::ERR_CONNECTION_TIMED_OUT" }, ctx));
  assert.ok(net.match({ message: "WebSocket closed unexpectedly" }, ctx));
  assert.equal(net.match({ message: "all good" }, ctx), false);
});

test("updater-issue is scoped to the updater file", () => {
  const upd = get("updater-issue");
  assert.ok(upd.match({ level: "ERROR", message: "Failed to download manifest" }, { file: { category: "updater" } }));
});

test("app-exception matches the common 'cannot read properties' message even at INFO", () => {
  const ex = get("app-exception");
  assert.ok(ex.match({ level: "INFO", message: "Cannot read properties of undefined (reading 'x')" }, ctx));
  assert.ok(ex.match({ level: "INFO", message: "Cannot read property 'x' of undefined" }, ctx));
});

test("sync summarize uses the latest entry by timestamp, not array order", () => {
  const data = get("sync-signal").summarize([
    { message: "Initial sync complete: 0 records pushed", ts: 200 },
    { message: "3 records pushed", ts: 100 },
  ]);
  assert.equal(data.lastPushed, 0);
});

test("process-crash matches the Overwolf 'App crashed ... ProcessCrashed' trace line", () => {
  const pc = get("process-crash");
  const line = "[UI][17688] <12MB> ExtensionWebApp - App crashed - ExampleApp ('uid') (reason: ProcessCrashed)";
  assert.ok(pc.match({ level: "ERROR", message: line }, ctx));
  // a launch (no "(reason: ...)") must not look like a crash
  assert.equal(pc.match({ level: "INFO", message: "ExtensionWebApp - App launched - ExampleApp" }, ctx), false);
});

test("process-crash summarize groups crashes by app and reason", () => {
  const pc = get("process-crash");
  const data = pc.summarize([
    { message: "ExtensionWebApp - App crashed - ExampleApp ('uid') (reason: ProcessCrashed)" },
    { message: "ExtensionWebApp - App crashed - ExampleApp ('uid') (reason: Killed)" },
    { message: "ExtensionWebApp - App crashed - Other Tracker ('x') (reason: ProcessCrashed)" },
  ]);
  assert.equal(data.count, 3);
  assert.deepEqual(data.byApp, {
    ExampleApp: { ProcessCrashed: 1, Killed: 1 },
    "Other Tracker": { ProcessCrashed: 1 },
  });
});

test("renderer-crash fires only on browser-crash files and captures app + native fault", () => {
  const rc = get("renderer-crash");
  const bctx = { file: { category: "browser-crash", app: null, window: null, system: false } };
  const cmd = { level: "INFO", message: "OverwolfBrowser.exe --type=renderer --owapp=ExampleApp - background --no-sandbox /prefetch:1" };
  const exc = { level: "ERROR", message: "exception\nSystem.Runtime.InteropServices.SEHException (0x80004005): boom\n   at libcef.execute_process()" };
  assert.ok(rc.match(cmd, bctx));
  assert.ok(rc.match(exc, bctx));
  // the same lines in an ordinary app log must not match
  assert.equal(rc.match(cmd, ctx), false);

  const data = rc.summarize([cmd, exc]);
  assert.deepEqual(data.apps, ["ExampleApp - background"]);
  assert.equal(data.exceptions.length, 1);
  assert.match(data.exceptions[0], /SEHException \(0x80004005\)/);
});

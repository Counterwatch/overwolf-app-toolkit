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

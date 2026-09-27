import assert from "node:assert/strict";
import { test } from "node:test";

import { analyzeGep, correlateGepKeys } from "../engine/gep.mjs";
import { parseLines } from "../engine/logline.mjs";

// Synthetic GEP provider log lines, in the shapes the real provider writes.
const L = (ts, msg, level = "INFO") => `2026-02-01 ${ts},000 (${level}) </index/index.js> (:2) - ${msg}`;
const info = (ts, key, value, feature = "match_info") =>
  L(ts, `[GEP] info update ${JSON.stringify({ featureName: feature, categoryName: feature, key, value })}`);
const event = (ts, key) => L(ts, `[GEP] New Event  ${JSON.stringify({ gameId: 42, feature: "match_info", key, value: null })}`);
const plugin = (ts, key, value) => L(ts, `[Plugin] info update ${JSON.stringify({ channelId: 1, category: "game_info", key, value })}`);

/** One game session: `outcomes` real match_outcome values, then GEP's close-out lines. */
function session({ start, version, outcomes, extraMissing = [], matches = 2, pluginOutcome = true }) {
  const h = Number(start.slice(0, 2));
  const at = (m) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
  const lines = [
    "================== new session ==================",
    L(at(0), `Detected Gep Version ${version}`, "WARN"),
    L(at(0), "Running Game Id detected, gameId:  42"),
    L(at(0), `RunningGameInfo detected {"gameInfo":{"title":"Test Game","classId":42}}`),
    info(at(1), "scene", "lobby", "game_info"),
  ];
  for (let i = 0; i < matches; i++) {
    const m = 2 + i * 10;
    lines.push(event(at(m), "match_start"), info(at(m), "match_outcome", null), info(at(m), "match_id", `m${i}`));
    lines.push(info(at(m + 1), `roster_${i}`, "{}"), event(at(m + 2), "kill"), event(at(m + 5), "match_end"));
    if (i < outcomes) {
      if (pluginOutcome) lines.push(plugin(at(m + 5), "match_outcome", "Victory"));
      lines.push(info(at(m + 5), "match_outcome", "Victory"));
    } else if (pluginOutcome) {
      lines.push(plugin(at(m + 5), "scene", "lobby"));
    }
  }
  lines.push(L(at(40), "[GEP] Supported game ended 42 {}"), L(at(40), "Stopping Game Handler 42"));
  for (const k of ["scoreboard", ...extraMissing]) lines.push(L(at(40), `Missing feature (info) - gameId: 42 (Test Game) - ${k}`));
  return lines.join("\n");
}

const file = (label, text) => ({ label, entries: parseLines(text) });

test("splits provider logs into game sessions with their own GEP version", () => {
  const g = analyzeGep([
    file("a.log", session({ start: "10", version: "300.0.1", outcomes: 2 })),
    file("b.log", session({ start: "12", version: "301.0.0", outcomes: 2 })),
  ]);
  assert.equal(g.sessions.length, 2);
  assert.deepEqual(g.sessions.map((s) => s.gepVersion), ["300.0.1", "301.0.0"]);
  assert.equal(g.sessions[0].gameId, "42");
  assert.equal(g.sessions[0].gameName, "Test Game");
  assert.equal(g.sessions[0].ended, true);
  assert.deepEqual(g.versions.map((v) => v.version), ["300.0.1", "301.0.0"]);
});

test("counts delivered values separately from null updates", () => {
  const [s] = analyzeGep([file("a.log", session({ start: "10", version: "1.0.0", outcomes: 1 }))]).sessions;
  // two match_start null resets + one real value
  assert.deepEqual(s.info["match_info.match_outcome"], { updates: 3, values: 1 });
  assert.equal(s.events["match_info.match_end"], 2);
  assert.equal(s.plugin["game_info.match_outcome"].values, 1);
});

test("per-slot keys collapse into one row", () => {
  const [s] = analyzeGep([file("a.log", session({ start: "10", version: "1.0.0", outcomes: 2 }))]).sessions;
  assert.ok(s.info["match_info.roster_*"], "roster_0/roster_1 should group as roster_*");
  assert.equal(s.info["match_info.roster_0"], undefined);
});

test("records GEP's end-of-game missing-feature list once per key", () => {
  const text = session({ start: "10", version: "1.0.0", outcomes: 0, extraMissing: ["match_outcome", "match_outcome"] });
  const [s] = analyzeGep([file("a.log", text)]).sessions;
  assert.deepEqual(s.missing.map((m) => m.key), ["scoreboard", "match_outcome"]);
});

test("flags a key that stopped arriving in a comparable later session", () => {
  const g = analyzeGep([
    file("good.log", session({ start: "10", version: "300.0.1", outcomes: 2 })),
    file("bad.log", session({ start: "12", version: "301.0.0", outcomes: 0, extraMissing: ["match_outcome"] })),
  ]);
  assert.equal(g.dropouts.length, 1);
  const d = g.dropouts[0];
  assert.equal(d.key, "match_info.match_outcome");
  assert.equal(d.before.values, 2);
  assert.equal(d.before.gepVersion, "300.0.1");
  assert.equal(d.after.gepVersion, "301.0.0");
  assert.equal(d.after.updates, 2, "the null resets still arrived");
  assert.equal(d.after.pluginValues, 0, "the native plugin produced none either");
  assert.equal(d.flaggedMissing, true);
});

test("reports a dropout once, at the session where it started", () => {
  const g = analyzeGep([
    file("1.log", session({ start: "08", version: "300.0.1", outcomes: 2 })),
    file("2.log", session({ start: "10", version: "301.0.0", outcomes: 0 })),
    file("3.log", session({ start: "12", version: "301.0.0", outcomes: 0 })),
  ]);
  assert.equal(g.dropouts.length, 1);
  assert.equal(g.dropouts[0].after.gepVersion, "301.0.0");
});

test("a short menu-only session is not compared, so it reports no dropouts", () => {
  const menuOnly = ["================== new session ==================", L("12:00:00", "Running Game Id detected, gameId:  42"), info("12:00:05", "scene", "menu", "game_info")].join("\n");
  const g = analyzeGep([file("good.log", session({ start: "10", version: "1.0.0", outcomes: 2 })), file("menu.log", menuOnly)]);
  assert.equal(g.sessions.length, 2);
  assert.equal(g.dropouts.length, 0);
});

test("a key seen only once before is not treated as a pattern", () => {
  const g = analyzeGep([
    file("good.log", session({ start: "10", version: "1.0.0", outcomes: 1 })),
    file("bad.log", session({ start: "12", version: "1.0.0", outcomes: 0 })),
  ]);
  assert.equal(g.dropouts.length, 0);
});

test("idle provider starts with no game produce no session but still record the version", () => {
  const idle = ["================== new session ==================", L("09:00:00", "Detected Gep Version 299.0.0", "WARN"), L("09:00:01", "init plugin service")].join("\n");
  const g = analyzeGep([file("idle.log", idle)]);
  assert.equal(g.sessions.length, 0);
  assert.deepEqual(g.versions.map((v) => v.version), ["299.0.0"]);
});

test("correlates app hits with what GEP delivered in their session", () => {
  const g = analyzeGep([
    file("good.log", session({ start: "10", version: "300.0.1", outcomes: 2 })),
    file("bad.log", session({ start: "12", version: "301.0.0", outcomes: 0 })),
  ]);
  const ts = (hhmm) => Date.parse(`2026-02-01T${hhmm}:00`);
  const c = correlateGepKeys(g.sessions, ["match_outcome"], [ts("10:20"), ts("12:15"), ts("12:30"), ts("15:00"), undefined]);
  assert.equal(c.sessions.length, 2);
  assert.deepEqual(
    c.sessions.map((r) => [r.gepVersion, r.hits, r.values.match_outcome, r.gepSentNone]),
    [
      ["300.0.1", 1, 2, false],
      ["301.0.0", 2, 0, true],
    ],
  );
  assert.equal(c.unplaced, 2, "the 15:00 hit is outside every session, and one hit had no timestamp");
});

test("a qualified gepKey matches only its own feature", () => {
  const [s] = analyzeGep([file("a.log", session({ start: "10", version: "1.0.0", outcomes: 2 }))]).sessions;
  const ts = Date.parse("2026-02-01T10:20:00");
  assert.equal(correlateGepKeys([s], ["other_feature.match_outcome"], [ts]).sessions[0].values["other_feature.match_outcome"], 0);
  assert.equal(correlateGepKeys([s], ["match_info.match_outcome"], [ts]).sessions[0].values["match_info.match_outcome"], 2);
});

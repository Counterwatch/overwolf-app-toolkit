import assert from "node:assert/strict";
import { test } from "node:test";

import { parseLines, splitSessions, timeSpan } from "../engine/logline.mjs";

test("parseLines reads timestamp, level, component and message", () => {
  const [e] = parseLines("2026-01-01 12:00:04,100 (INFO) sync.js (:120) - [SyncService/run] Initial sync complete: 0 records pushed");
  assert.equal(e.level, "INFO");
  assert.equal(e.component, "SyncService/run");
  assert.ok(e.message.includes("Initial sync complete"));
  assert.equal(e.tsRaw, "2026-01-01 12:00:04,100");
  assert.equal(typeof e.ts, "number");
});

test("parseLines normalizes WARNING -> WARN and folds continuation lines", () => {
  const entries = parseLines(
    [
      "2026-01-01 12:00:00,000 (WARNING) a.js (:1) - first",
      "    continued stack frame",
      "2026-01-01 12:00:01,000 (ERROR) b.js (:2) - second",
    ].join("\n"),
  );
  assert.equal(entries.length, 2);
  assert.equal(entries[0].level, "WARN");
  assert.ok(entries[0].message.includes("continued stack frame"));
  assert.equal(entries[1].level, "ERROR");
});

test("splitSessions splits on the new-session marker", () => {
  const entries = parseLines(
    [
      "================== new session ==================",
      "2026-01-01 12:00:00,000 (INFO) a (:1) - one",
      "================== new session ==================",
      "2026-01-01 13:00:00,000 (INFO) a (:1) - two",
      "2026-01-01 13:00:01,000 (INFO) a (:1) - three",
    ].join("\n"),
  );
  const sessions = splitSessions(entries);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].length, 1);
  assert.equal(sessions[1].length, 2);
});

test("timeSpan returns first and last timestamps", () => {
  const entries = parseLines(
    ["2026-01-01 12:00:00,000 (INFO) a (:1) - one", "2026-01-01 12:00:05,000 (INFO) a (:1) - two"].join("\n"),
  );
  const span = timeSpan(entries);
  assert.ok(span.end > span.start);
});

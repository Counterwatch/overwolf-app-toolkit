import assert from "node:assert/strict";
import { test } from "node:test";

import { buildReminder, detectBundlePaths } from "../hooks/detect-log-bundle.mjs";

test("detects real-world bundle paths, including as side evidence in a longer prompt", () => {
  const prompt = [
    "There's been an increase of app crashes but no uploaded logs since 2.43.1. Help me understand why.",
    "The only logs that have been uploaded for those versions have been these:",
    String.raw`C:\Users\someone\Downloads\rejectionCannotreadpropertiesofundefinedreadingid_2026-06-10_01-18-58_2.43.3_abBwf.zip`,
    String.raw`C:\Users\someone\Downloads\rejectionWindowclosed_2026-06-09_23-13-46_2.43.3_jW7ub.zip`,
    String.raw`C:\Users\someone\Downloads\CareerProfilePublic1781032034936_2026-06-09_19-07-15_2.43.3_icFbV.zip`,
  ].join("\n");
  const found = detectBundlePaths(prompt);
  assert.equal(found.length, 3);
  assert.ok(found[0].endsWith("rejectionCannotreadpropertiesofundefinedreadingid_2026-06-10_01-18-58_2.43.3_abBwf.zip"));
});

test("detects quoted paths, ticket-id prefixes, and forward slashes; dedupes repeats", () => {
  const prompt = [
    '"C:\\Users\\x\\Downloads\\comp12345_2025-11-02_08-30-12_1.0.9_Ab3xZ.zip" attached twice:',
    String.raw`"C:\Users\x\Downloads\comp12345_2025-11-02_08-30-12_1.0.9_Ab3xZ.zip"`,
    "/tmp/uploads/syncbroken_2025-01-31_23-59-59_2.0.0_zzzzz.zip",
  ].join("\n");
  const found = detectBundlePaths(prompt);
  assert.equal(found.length, 2);
  assert.ok(found.every((p) => !p.includes('"')));
});

test("ignores ordinary zips and date-free names", () => {
  const prompt = [
    "Please look at node_modules.zip and backup_2026.zip,",
    "also release-2.43.3.zip and the folder C:\\logs\\2026-06-10\\.",
  ].join("\n");
  assert.deepEqual(detectBundlePaths(prompt), []);
});

test("reminder names every bundle and the skill", () => {
  const reminder = buildReminder([
    String.raw`C:\Users\x\Downloads\comp1_2025-11-02_08-30-12_1.0.9_Ab3xZ.zip`,
    "/tmp/syncbroken_2025-01-31_23-59-59_2.0.0_zzzzz.zip",
  ]);
  assert.match(reminder, /2 Overwolf support-log bundle/);
  assert.match(reminder, /comp1_2025-11-02_08-30-12_1\.0\.9_Ab3xZ\.zip/);
  assert.match(reminder, /syncbroken_2025-01-31_23-59-59_2\.0\.0_zzzzz\.zip/);
  assert.match(reminder, /overwolf-log-doctor/);
  assert.match(reminder, /side evidence/);
});

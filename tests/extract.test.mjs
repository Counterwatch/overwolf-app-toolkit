import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { resolveBundleDir } from "../engine/extract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "fixtures", "sample-bundle");

test("passes an existing directory through unchanged", () => {
  const r = resolveBundleDir(FIXTURE);
  assert.equal(r.extracted, false);
  assert.equal(r.dir, FIXTURE);
  r.cleanup(); // should be a no-op and not throw
});

test("rejects a non-zip file with a clear message", () => {
  assert.throws(() => resolveBundleDir(join(FIXTURE, "Crash.json")), /directory or a \.zip/);
});

test("throws on a missing path", () => {
  assert.throws(() => resolveBundleDir(join(here, "fixtures", "nope.zip")));
});

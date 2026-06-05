import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeMessage, stripPrefix, clusterMessages } from "../engine/cluster.mjs";

test("stripPrefix removes the source and [Component] tag", () => {
  assert.equal(stripPrefix("store.js (:14) - [Store] write failed"), "write failed");
  assert.equal(stripPrefix("[Renderer] boom"), "boom");
});

test("normalizeMessage collapses variable numbers/ids/quotes so siblings match", () => {
  const a = "store.js (:14) - [Store] write failed: timeout after 1000ms";
  const b = "store.js (:99) - [Store] write failed: timeout after 9999ms";
  assert.equal(normalizeMessage(a), normalizeMessage(b));
  // different message text stays distinct
  assert.notEqual(normalizeMessage(a), normalizeMessage("[Store] read failed"));
});

test("clusterMessages groups, counts, sorts by frequency, and tracks span", () => {
  const clusters = clusterMessages([
    { message: "write failed: timeout after 1000ms", level: "ERROR", ts: 10 },
    { message: "write failed: timeout after 2000ms", level: "ERROR", ts: 20 },
    { message: "boom once", level: "ERROR", ts: 5 },
  ]);
  assert.equal(clusters[0].count, 2);
  assert.equal(clusters[0].firstTs, 10);
  assert.equal(clusters[0].lastTs, 20);
  assert.equal(clusters[1].count, 1);
});

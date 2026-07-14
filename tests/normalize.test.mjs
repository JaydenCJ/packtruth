// Canonicalization: the many equivalent spellings npm accepts must
// compare equal, because false positives on formatting noise would
// train users to ignore the real findings.
import test from "node:test";
import assert from "node:assert/strict";

import {
  asRecord,
  asSortedList,
  deepEqual,
  normalizeBin,
  normalizeBundled,
  renderValue,
  stableStringify,
} from "../dist/normalize.js";

test("stableStringify sorts keys at every depth", () => {
  const a = { b: 1, a: { z: [1, { y: 2, x: 3 }], w: null } };
  const b = { a: { w: null, z: [1, { x: 3, y: 2 }] }, b: 1 };
  assert.equal(stableStringify(a), stableStringify(b));
  assert.equal(stableStringify({ a: 1 }), '{"a":1}');
});

test("deepEqual: key order is noise, values and array order are signal", () => {
  assert.ok(deepEqual({ a: "1", b: "2" }, { b: "2", a: "1" }));
  assert.ok(!deepEqual({ a: "1" }, { a: "2" }));
  assert.ok(!deepEqual([1, 2], [2, 1])); // array order is meaningful
  assert.ok(deepEqual(undefined, undefined));
  assert.ok(!deepEqual(undefined, null)); // presence handled by caller
});

test("renderValue truncates long values with an ellipsis", () => {
  assert.equal(renderValue(undefined), "—");
  assert.equal(renderValue("short"), '"short"');
  const long = renderValue("x".repeat(200), 20);
  assert.equal(long.length, 20);
  assert.ok(long.endsWith("…"));
});

test("bin: string spelling normalizes to a map keyed by the unscoped name", () => {
  assert.deepEqual(normalizeBin("./cli.js", "mytool"), { mytool: "cli.js" });
  assert.deepEqual(normalizeBin("bin/run.js", "@scope/mytool"), { mytool: "bin/run.js" });
  assert.deepEqual(normalizeBin({ a: "./x.js", b: "y.js" }, "pkg"), { a: "x.js", b: "y.js" });
  // The two spellings of the same executable must compare equal.
  assert.ok(deepEqual(normalizeBin("./cli.js", "tool"), normalizeBin({ tool: "cli.js" }, "tool")));
});

test("absent or malformed bin normalizes to undefined", () => {
  assert.equal(normalizeBin(undefined, "p"), undefined);
  assert.equal(normalizeBin(null, "p"), undefined);
  assert.equal(normalizeBin(42, "p"), undefined);
});

test("both bundled-dependency spellings normalize identically", () => {
  assert.deepEqual(normalizeBundled({ bundledDependencies: ["b", "a"] }), ["a", "b"]);
  assert.deepEqual(normalizeBundled({ bundleDependencies: ["a", "b"] }), ["a", "b"]);
  assert.equal(normalizeBundled({ bundledDependencies: true }), true);
  assert.equal(normalizeBundled({ bundledDependencies: false }), undefined);
  assert.equal(normalizeBundled({}), undefined);
});

test("asRecord and asSortedList coerce safely instead of dropping data", () => {
  assert.deepEqual(asRecord({ a: "1" }), { a: "1" });
  assert.equal(asRecord(["a"]), undefined);
  assert.equal(asRecord("a"), undefined);
  assert.equal(asRecord(null), undefined);
  // A dependencies map with an object value is malformed but must still
  // be visible in the diff, not silently skipped.
  assert.deepEqual(asRecord({ weird: { nested: true } }), { weird: '{"nested":true}' });
  assert.deepEqual(asSortedList(["linux", "darwin"]), ["darwin", "linux"]);
  assert.equal(asSortedList("linux"), undefined);
});

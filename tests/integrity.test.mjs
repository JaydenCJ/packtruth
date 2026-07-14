// Integrity verification: the registry's dist digests against the real
// tarball bytes. If these disagree, the inspected artifact is not the
// one the registry serves — everything else becomes secondary.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { checkIntegrity, parseSri } from "../dist/integrity.js";
import { basePkg, pkgTarball } from "./helpers.mjs";

const tgz = pkgTarball(basePkg());
const goodSha512 = "sha512-" + createHash("sha512").update(tgz).digest("base64");
const goodShasum = createHash("sha1").update(tgz).digest("hex");

test("matching sha512 integrity passes", () => {
  const { result, findings } = checkIntegrity({ dist: { integrity: goodSha512 } }, tgz);
  assert.deepEqual(result, { checked: ["sha512"], ok: true });
  assert.deepEqual(findings, []);
});

test("legacy shasum passes alone and alongside integrity", () => {
  const alone = checkIntegrity({ dist: { shasum: goodShasum } }, tgz);
  assert.deepEqual(alone.result, { checked: ["shasum(sha1)"], ok: true });
  assert.deepEqual(alone.findings, []);

  const both = checkIntegrity({ dist: { integrity: goodSha512, shasum: goodShasum } }, tgz);
  assert.deepEqual(both.result.checked, ["sha512", "shasum(sha1)"]);
  assert.equal(both.result.ok, true);
});

test("a wrong integrity digest is a critical finding", () => {
  const wrong = "sha512-" + createHash("sha512").update("other bytes").digest("base64");
  const { result, findings } = checkIntegrity({ dist: { integrity: wrong } }, tgz);
  assert.equal(result.ok, false);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "critical");
  assert.equal(findings[0].field, "dist.integrity");
  assert.match(findings[0].detail, /different artifact/);
});

test("a wrong shasum is a critical finding (case-insensitive compare)", () => {
  const { findings: bad } = checkIntegrity({ dist: { shasum: "deadbeef" } }, tgz);
  assert.equal(bad[0].severity, "critical");
  const { findings: upper } = checkIntegrity({ dist: { shasum: goodShasum.toUpperCase() } }, tgz);
  assert.deepEqual(upper, []);
});

test("multi-algorithm SRI strings verify every known algorithm; parseSri skips options", () => {
  const sha256 = "sha256-" + createHash("sha256").update(tgz).digest("base64");
  const { result } = checkIntegrity({ dist: { integrity: `${goodSha512} ${sha256}` } }, tgz);
  assert.deepEqual(result.checked, ["sha512", "sha256"]);
  assert.equal(result.ok, true);

  const entries = parseSri("sha512-AAAA?foo=bar sha1-BBBB unknown-CCCC");
  assert.deepEqual(entries, [
    { algorithm: "sha512", digest: "AAAA" },
    { algorithm: "sha1", digest: "BBBB" },
  ]);
  assert.deepEqual(parseSri("   "), []);
});

test("unverifiable input degrades gracefully, never crashes", () => {
  // Unknown-algorithm-only SRI: a low finding, nothing verified.
  const odd = checkIntegrity({ dist: { integrity: "md5-abcdef" } }, tgz);
  assert.equal(odd.result, null);
  assert.equal(odd.findings.length, 1);
  assert.equal(odd.findings[0].severity, "low");
  // No dist at all, or a malformed one: nothing verifiable, no findings.
  assert.deepEqual(checkIntegrity({}, tgz), { result: null, findings: [] });
  assert.deepEqual(checkIntegrity({ dist: "weird" }, tgz), { result: null, findings: [] });
});

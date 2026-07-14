// runCheck orchestration: tarball + registry document in, full Report
// out — including packument version selection, the missing-version
// finding, integrity wiring, and the exit-threshold logic.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { failsAt, runCheck, summarize } from "../dist/check.js";
import { basePkg, packument, pkgTarball, registryManifest } from "./helpers.mjs";

test("a faithful publish yields a clean report", () => {
  const tgz = pkgTarball(basePkg());
  const doc = registryManifest(basePkg(), {
    dist: { integrity: "sha512-" + createHash("sha512").update(tgz).digest("base64") },
  });
  const report = runCheck(doc, tgz);
  assert.equal(report.verdict, "clean");
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.integrity, { checked: ["sha512"], ok: true });
  assert.deepEqual(report.package, { name: "left-pad-plus", version: "1.2.3" });
  // Registry dressing (_npmVersion, maintainers, gitHead, …) must never
  // count as divergence on a faithful publish.
  const dressed = runCheck(registryManifest(basePkg(), { gitHead: "abc" }), pkgTarball(basePkg()));
  assert.equal(dressed.verdict, "clean");
});

test("the classic manifest-confusion payload is fully reported", () => {
  const evil = basePkg({
    scripts: { test: "node --test", postinstall: "node collect.js" },
    dependencies: { "tiny-invariant": "^1.3.0", exfil: "^0.0.1" },
  });
  const doc = registryManifest(basePkg(), { hasInstallScript: false });
  const report = runCheck(doc, pkgTarball(evil));
  assert.equal(report.verdict, "divergent");
  const fields = report.findings.map((f) => f.field);
  assert.deepEqual(fields, ["hasInstallScript", "scripts.postinstall", "dependencies.exfil"]);
  assert.equal(report.summary.critical, 2);
  assert.equal(report.summary.high, 1);
  assert.equal(report.summary.total, 3);
});

test("a packument selects the tarball's version; --registry-version overrides", () => {
  const v1 = basePkg({ version: "1.0.0", main: "old.js" });
  const doc = packument("left-pad-plus", [v1, basePkg()]);
  // Automatic: compared against 1.2.3 (the tarball's), not latest-or-old.
  assert.equal(runCheck(doc, pkgTarball(basePkg())).verdict, "clean");
  // Forced: compared against 1.0.0, so version and main both diverge.
  const forced = runCheck(doc, pkgTarball(basePkg()), { registryVersion: "1.0.0" });
  assert.equal(forced.verdict, "divergent");
  const fields = forced.findings.map((f) => f.field);
  assert.ok(fields.includes("version"));
  assert.ok(fields.includes("main"));
});

test("a tarball version absent from the packument is a critical finding", () => {
  const doc = packument("left-pad-plus", [basePkg({ version: "1.0.0" })]);
  const report = runCheck(doc, pkgTarball(basePkg())); // tarball is 1.2.3
  assert.equal(report.verdict, "divergent");
  assert.equal(report.findings.length, 1);
  const f = report.findings[0];
  assert.equal(f.kind, "missing-version");
  assert.equal(f.severity, "critical");
  assert.equal(f.tarball, "1.2.3");
  assert.deepEqual(f.registry, ["1.0.0"]);
});

test("integrity mismatch and field divergence are reported together", () => {
  const doc = registryManifest(basePkg(), {
    dist: { integrity: "sha512-" + createHash("sha512").update("not the tarball").digest("base64") },
  });
  const report = runCheck(doc, pkgTarball(basePkg({ main: "evil.js" })));
  const fields = report.findings.map((f) => f.field);
  assert.ok(fields.includes("dist.integrity"));
  assert.ok(fields.includes("main"));
  assert.equal(report.integrity.ok, false);
});

test("noIntegrity skips digests; ignore reaches comparator and hasInstallScript", () => {
  const skipped = runCheck(registryManifest(basePkg(), { dist: { shasum: "deadbeef" } }), pkgTarball(basePkg()), {
    noIntegrity: true,
  });
  assert.equal(skipped.integrity, null);
  assert.equal(skipped.verdict, "clean");

  const doc = registryManifest(basePkg(), { hasInstallScript: false });
  const evil = basePkg({ scripts: { test: "node --test", postinstall: "x" } });
  const ignored = runCheck(doc, pkgTarball(evil), { ignore: ["hasInstallScript", "scripts"] });
  assert.equal(ignored.verdict, "clean");
});

test("source labels flow into the report; summarize counts per severity", () => {
  const report = runCheck(registryManifest(basePkg()), pkgTarball(basePkg()), {
    manifestLabel: "m.json",
    tarballLabel: "t.tgz",
  });
  assert.deepEqual(report.source, { manifest: "m.json", tarball: "t.tgz" });

  const summary = summarize([
    { field: "a", kind: "mismatch", severity: "critical", detail: "" },
    { field: "b", kind: "mismatch", severity: "high", detail: "" },
    { field: "c", kind: "mismatch", severity: "high", detail: "" },
    { field: "d", kind: "mismatch", severity: "info", detail: "" },
  ]);
  assert.deepEqual(summary, { critical: 1, high: 2, medium: 0, low: 0, info: 1, total: 4 });
});

test("failsAt respects the threshold ladder; a clean report never fails", () => {
  const doc = registryManifest(basePkg());
  const info = runCheck(doc, pkgTarball(basePkg({ description: "reworded" }))); // info only
  assert.equal(failsAt(info, "low"), false); // info sits below low
  assert.equal(failsAt(info, "info"), true);
  assert.equal(failsAt(info, "never"), false);

  const medium = runCheck(doc, pkgTarball(basePkg({ main: "other.js" })));
  assert.equal(failsAt(medium, "medium"), true);
  assert.equal(failsAt(medium, "high"), false);
  assert.equal(failsAt(medium, "low"), true);

  const clean = runCheck(doc, pkgTarball(basePkg()));
  assert.equal(failsAt(clean, "info"), false);
});

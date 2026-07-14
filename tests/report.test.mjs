// Report rendering: deterministic text tables, the JSON envelope, and
// the fields reference. Rendering is pure string work, so these tests
// pin exact shapes.
import test from "node:test";
import assert from "node:assert/strict";

import { runCheck } from "../dist/check.js";
import { renderFields, renderJson, renderText } from "../dist/report.js";
import { basePkg, pkgTarball, registryManifest } from "./helpers.mjs";

function divergentReport() {
  const evil = basePkg({
    scripts: { test: "node --test", postinstall: "node collect.js" },
    main: "evil.js",
  });
  return runCheck(registryManifest(basePkg()), pkgTarball(evil), {
    manifestLabel: "manifest.json",
    tarballLabel: "pkg.tgz",
  });
}

test("header names both sources, the package, and the integrity status", () => {
  const text = renderText(divergentReport());
  assert.match(text, /^packtruth check: pkg\.tgz vs manifest\.json \(left-pad-plus@1\.2\.3\)\n/);
  assert.match(text, /integrity: not verified \(no digest in registry document\)/);
});

test("the table lists severity, field, direction, both values — and bang lines explain", () => {
  const text = renderText(divergentReport());
  assert.match(text, /SEVERITY\s+FIELD\s+DIVERGENCE\s+REGISTRY\s+TARBALL/);
  assert.match(text, /critical\s+scripts\.postinstall\s+only in tarball\s+—\s+"node collect\.js"/);
  assert.match(text, /medium\s+main\s+differs\s+"index\.js"\s+"evil\.js"/);
  // Critical and high findings additionally get an explanatory line.
  assert.match(text, /! scripts\.postinstall: install-time script exists only in the tarball/);
});

test("summary counts by severity, states the verdict, and declines correctly", () => {
  assert.match(renderText(divergentReport()), /2 divergences \(1 critical, 1 medium\) — verdict: DIVERGENT\n$/);
  const single = runCheck(registryManifest(basePkg()), pkgTarball(basePkg({ main: "x.js" })));
  assert.match(renderText(single), /1 divergence \(1 medium\)/); // singular noun
});

test("a clean report renders the clean verdict and no table", () => {
  const report = runCheck(registryManifest(basePkg()), pkgTarball(basePkg()));
  const text = renderText(report);
  assert.match(text, /0 divergences — verdict: CLEAN/);
  assert.doesNotMatch(text, /SEVERITY/);
});

test("rendering is deterministic", () => {
  assert.equal(renderText(divergentReport()), renderText(divergentReport()));
  assert.equal(renderJson(divergentReport()), renderJson(divergentReport()));
});

test("JSON report round-trips with the documented envelope", () => {
  const parsed = JSON.parse(renderJson(divergentReport()));
  assert.equal(parsed.tool, "packtruth");
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.verdict, "divergent");
  assert.equal(parsed.summary.total, parsed.findings.length);
  assert.deepEqual(Object.keys(parsed.findings[0]).sort(), ["detail", "field", "kind", "severity", "tarball"]);
});

test("fields reference lists every policy row, in text and JSON", () => {
  const text = renderFields(false);
  assert.match(text, /FIELD\s+SEVERITY\s+COMPARE/);
  assert.match(text, /\bname\s+critical\b/);
  assert.match(text, /\bdependencies\s+high\b/);
  assert.match(text, /\bdevDependencies\s+low\b/);
  assert.match(text, /preinstall\/install\/postinstall are critical/);

  const rows = JSON.parse(renderFields(true));
  assert.ok(Array.isArray(rows));
  assert.equal(rows.find((r) => r.field === "name").severity, "critical");
  assert.ok(rows.every((r) => typeof r.why === "string" && r.why.length > 0));
});

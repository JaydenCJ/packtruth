// End-to-end CLI: spawn the built dist/cli.js against fixture files in
// fresh temp dirs and assert on real stdout/stderr/exit codes — the
// same interface scripts and CI pipelines consume.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { basePkg, packument, pkgTarball, registryManifest, runCli } from "./helpers.mjs";

const cleanTgz = pkgTarball(basePkg());
const evilTgz = pkgTarball(
  basePkg({
    scripts: { test: "node --test", postinstall: "node collect.js" },
    dependencies: { "tiny-invariant": "^1.3.0", exfil: "^0.0.1" },
  }),
);
const manifestJson = JSON.stringify(registryManifest(basePkg()));

test("--version prints the manifest version; --help prints usage", () => {
  const version = runCli(["--version"]);
  assert.equal(version.status, 0);
  assert.equal(version.stdout, "0.1.0\n");
  const help = runCli(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /packtruth — detect manifest confusion/);
});

test("a clean pair exits 0 with the CLEAN verdict", () => {
  const { status, stdout } = runCli(["check", "pkg.tgz", "-m", "manifest.json"], {
    files: { "pkg.tgz": cleanTgz, "manifest.json": manifestJson },
  });
  assert.equal(status, 0);
  assert.match(stdout, /verdict: CLEAN/);
});

test("a divergent pair exits 1 and prints the findings table", () => {
  const { status, stdout } = runCli(["check", "pkg.tgz", "-m", "manifest.json"], {
    files: { "pkg.tgz": evilTgz, "manifest.json": manifestJson },
  });
  assert.equal(status, 1);
  assert.match(stdout, /scripts\.postinstall/);
  assert.match(stdout, /dependencies\.exfil/);
  assert.match(stdout, /verdict: DIVERGENT/);
});

test("--format json emits the machine envelope", () => {
  const { status, stdout } = runCli(["check", "pkg.tgz", "-m", "manifest.json", "--format", "json"], {
    files: { "pkg.tgz": evilTgz, "manifest.json": manifestJson },
  });
  assert.equal(status, 1);
  const report = JSON.parse(stdout);
  assert.equal(report.tool, "packtruth");
  assert.equal(report.verdict, "divergent");
  assert.equal(report.source.tarball, "pkg.tgz");
});

test("the manifest can arrive on stdin", () => {
  const { status, stdout } = runCli(["check", "pkg.tgz", "-m", "-"], {
    files: { "pkg.tgz": cleanTgz },
    stdin: manifestJson,
  });
  assert.equal(status, 0);
  assert.match(stdout, /vs stdin /);
});

test("--fail-on gates the exit code without changing the report", () => {
  const files = { "pkg.tgz": pkgTarball(basePkg({ main: "other.js" })), "manifest.json": manifestJson };
  const strict = runCli(["check", "pkg.tgz", "-m", "manifest.json"], { files });
  assert.equal(strict.status, 1); // medium ≥ low (default)
  const lax = runCli(["check", "pkg.tgz", "-m", "manifest.json", "--fail-on", "critical"], { files });
  assert.equal(lax.status, 0);
  assert.match(lax.stdout, /verdict: DIVERGENT/); // still reported
  const never = runCli(["check", "pkg.tgz", "-m", "manifest.json", "--fail-on", "never"], { files });
  assert.equal(never.status, 0);
});

test("--quiet keeps only the exit code; --ignore drops a field", () => {
  const quiet = runCli(["check", "pkg.tgz", "-m", "manifest.json", "-q"], {
    files: { "pkg.tgz": evilTgz, "manifest.json": manifestJson },
  });
  assert.equal(quiet.status, 1);
  assert.equal(quiet.stdout, "");

  const ignored = runCli(
    ["check", "pkg.tgz", "-m", "manifest.json", "--ignore", "description", "--fail-on", "info"],
    { files: { "pkg.tgz": pkgTarball(basePkg({ description: "reworded" })), "manifest.json": manifestJson } },
  );
  assert.equal(ignored.status, 0);
  assert.match(ignored.stdout, /verdict: CLEAN/);
});

test("a packument manifest works end to end with --registry-version", () => {
  const doc = JSON.stringify(packument("left-pad-plus", [basePkg({ version: "1.0.0", main: "old.js" }), basePkg()]));
  const auto = runCli(["check", "pkg.tgz", "-m", "packument.json"], {
    files: { "pkg.tgz": cleanTgz, "packument.json": doc },
  });
  assert.equal(auto.status, 0);
  const forced = runCli(["check", "pkg.tgz", "-m", "packument.json", "--registry-version", "1.0.0"], {
    files: { "pkg.tgz": cleanTgz, "packument.json": doc },
  });
  assert.equal(forced.status, 1);
});

test("integrity mismatch surfaces in the header and findings", () => {
  const badDist = JSON.stringify(
    registryManifest(basePkg(), {
      dist: { integrity: "sha512-" + createHash("sha512").update("someone else's bytes").digest("base64") },
    }),
  );
  const { status, stdout } = runCli(["check", "pkg.tgz", "-m", "manifest.json"], {
    files: { "pkg.tgz": cleanTgz, "manifest.json": badDist },
  });
  assert.equal(status, 1);
  assert.match(stdout, /integrity: sha512 MISMATCH/);
  assert.match(stdout, /dist\.integrity/);
});

test("extract prints the embedded package.json (verbatim and --pretty); fields prints the table", () => {
  const verbatim = runCli(["extract", "pkg.tgz"], { files: { "pkg.tgz": cleanTgz } });
  assert.equal(verbatim.status, 0);
  assert.deepEqual(JSON.parse(verbatim.stdout), basePkg());

  const pretty = runCli(["extract", "pkg.tgz", "--pretty"], { files: { "pkg.tgz": cleanTgz } });
  assert.match(pretty.stdout, /^\{\n  "name": "left-pad-plus",\n/);

  const fields = runCli(["fields"]);
  assert.equal(fields.status, 0);
  assert.match(fields.stdout, /FIELD\s+SEVERITY/);
  assert.ok(Array.isArray(JSON.parse(runCli(["fields", "--json"]).stdout)));
});

test("every failure mode exits 2 with a message on stderr, nothing on stdout", () => {
  const usage = runCli(["check", "pkg.tgz"]);
  assert.equal(usage.status, 2);
  assert.equal(usage.stdout, "");
  assert.match(usage.stderr, /needs --manifest/);

  const unreadable = runCli(["check", "missing.tgz", "-m", "also-missing.json"]);
  assert.equal(unreadable.status, 2);
  assert.match(unreadable.stderr, /cannot read/);

  const badJson = runCli(["check", "pkg.tgz", "-m", "manifest.json"], {
    files: { "pkg.tgz": cleanTgz, "manifest.json": "not json at all" },
  });
  assert.equal(badJson.status, 2);
  assert.match(badJson.stderr, /not valid JSON/);

  const badTarball = runCli(["check", "pkg.tgz", "-m", "manifest.json"], {
    files: { "pkg.tgz": Buffer.from("this is not a tarball"), "manifest.json": manifestJson },
  });
  assert.equal(badTarball.status, 2);
  assert.match(badTarball.stderr, /packtruth: /);
});

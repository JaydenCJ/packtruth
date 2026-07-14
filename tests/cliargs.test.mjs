// Argument parsing: command dispatch, strict flag validation, and the
// per-command rules that keep flags from silently applying to the wrong
// subcommand.
import test from "node:test";
import assert from "node:assert/strict";

import { parseArgs, UsageError, USAGE } from "../dist/cliargs.js";

test("check parses tarball, manifest and defaults", () => {
  const opts = parseArgs(["check", "pkg.tgz", "--manifest", "m.json"]);
  assert.equal(opts.command, "check");
  assert.equal(opts.tarball, "pkg.tgz");
  assert.equal(opts.manifest, "m.json");
  assert.equal(opts.format, "text");
  assert.equal(opts.failOn, "low");
  assert.deepEqual(opts.ignore, []);
  assert.equal(opts.noIntegrity, false);
});

test("bare tarball implies check; --help/--version win regardless of position", () => {
  const opts = parseArgs(["pkg.tgz", "-m", "m.json"]);
  assert.equal(opts.command, "check");
  assert.equal(opts.tarball, "pkg.tgz");
  assert.equal(parseArgs(["check", "x.tgz", "--help"]).command, "help");
  assert.equal(parseArgs(["-V"]).command, "version");
  assert.equal(parseArgs(["--version"]).command, "version");
});

test("stdin manifest and every check flag parse", () => {
  const opts = parseArgs([
    "check", "p.tgz",
    "-m", "-",
    "--registry-version", "2.0.0",
    "-f", "json",
    "--fail-on", "high",
    "--ignore", "devDependencies",
    "--ignore", "description",
    "--no-integrity",
    "-q",
  ]);
  assert.equal(opts.manifest, "-");
  assert.equal(opts.registryVersion, "2.0.0");
  assert.equal(opts.format, "json");
  assert.equal(opts.failOn, "high");
  assert.deepEqual(opts.ignore, ["devDependencies", "description"]);
  assert.equal(opts.noIntegrity, true);
  assert.equal(opts.quiet, true);
});

test("missing inputs and extra positionals are usage errors", () => {
  assert.throws(() => parseArgs(["check", "pkg.tgz"]), /needs --manifest/);
  assert.throws(() => parseArgs(["check", "--manifest", "m.json"]), /needs a tarball/);
  assert.throws(() => parseArgs(["check", "a.tgz", "b.tgz", "-m", "m.json"]), /unexpected argument: b\.tgz/);
  assert.throws(() => parseArgs(["fields", "x"]), /takes no positional/);
});

test("enum flags validate values; value-taking flags require a value", () => {
  assert.throws(() => parseArgs(["check", "a.tgz", "-m", "m", "--format", "yaml"]), /--format must be one of/);
  assert.throws(() => parseArgs(["check", "a.tgz", "-m", "m", "--fail-on", "fatal"]), /--fail-on must be one of/);
  assert.throws(() => parseArgs(["check", "a.tgz", "--manifest"]), /--manifest requires a value/);
  assert.throws(() => parseArgs(["check", "a.tgz", "-m", "m", "--ignore"]), /--ignore requires a value/);
});

test("unknown flags are fatal, never ignored", () => {
  assert.throws(() => parseArgs(["check", "a.tgz", "-m", "m", "--verbose"]), /unknown option: --verbose/);
  assert.throws(() => parseArgs(["--manifests"]), /unknown option: --manifests/);
  assert.throws(() => parseArgs([]), UsageError);
});

test("extract and fields fence off flags that are not theirs", () => {
  const opts = parseArgs(["extract", "pkg.tgz", "--pretty"]);
  assert.equal(opts.command, "extract");
  assert.equal(opts.pretty, true);
  assert.throws(() => parseArgs(["extract", "p.tgz", "--manifest", "m"]), /only applies to check/);
  assert.throws(() => parseArgs(["extract", "p.tgz", "--format", "json"]), /only applies to check/);
  assert.throws(() => parseArgs(["extract", "p.tgz", "--fail-on", "high"]), /--fail-on only applies to check/);
  assert.throws(() => parseArgs(["fields", "-q"]), /--quiet only applies to check/);
  assert.throws(() => parseArgs(["extract", "p.tgz", "--json"]), /--json is for fields/);
  assert.equal(parseArgs(["fields", "--json"]).json, true);
  assert.throws(() => parseArgs(["fields", "--pretty"]), /only applies to extract/);
  assert.throws(() => parseArgs(["fields", "--no-integrity"]), /only applies to check/);
});

test("check rejects other commands' flags; USAGE documents everything", () => {
  assert.throws(() => parseArgs(["check", "p.tgz", "-m", "m", "--pretty"]), /only applies to extract/);
  assert.throws(() => parseArgs(["check", "p.tgz", "-m", "m", "--json"]), /--format json/);
  for (const token of ["check", "extract", "fields", "--manifest", "--fail-on", "--ignore", "--registry-version", "--no-integrity"]) {
    assert.ok(USAGE.includes(token), `USAGE missing ${token}`);
  }
});

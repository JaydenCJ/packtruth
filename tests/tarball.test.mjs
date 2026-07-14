// Tarball opening: gzip handling, locating the manifest npm will honor
// (and only that one), digesting the distributed bytes, and precise
// errors for everything that is not an npm package tarball.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { extractManifestText, hashTarball, readTarball, TarballError } from "../dist/tarball.js";
import { basePkg, makeTar, makeTgz, pkgTarball, tarEntry } from "./helpers.mjs";

test("reads the manifest out of a gzipped npm tarball", () => {
  const info = readTarball(pkgTarball(basePkg()));
  assert.equal(info.manifest.name, "left-pad-plus");
  assert.equal(info.manifest.version, "1.2.3");
  assert.equal(info.manifestPath, "package/package.json");
  assert.equal(info.fileCount, 2);
});

test("accepts an uncompressed .tar as well", () => {
  const archive = makeTar([tarEntry("package/package.json", '{"name":"raw","version":"0.0.1"}')]);
  assert.equal(readTarball(archive).manifest.name, "raw");
});

test("the root folder can have any name, or be absent entirely", () => {
  // Some clients archive under the unscoped package name instead of "package".
  const renamedRoot = makeTgz([tarEntry("left-pad-plus/package.json", '{"name":"left-pad-plus"}')]);
  assert.equal(readTarball(renamedRoot).manifestPath, "left-pad-plus/package.json");
  // Hand-rolled archives sometimes skip the root folder altogether.
  const bare = makeTgz([tarEntry("package.json", '{"name":"bare"}')]);
  assert.equal(readTarball(bare).manifest.name, "bare");
});

test("nested package.json files never shadow the manifest; two roots are ambiguous", () => {
  const nested = makeTgz([
    tarEntry("package/package.json", '{"name":"outer"}'),
    tarEntry("package/tests/fixtures/package.json", '{"name":"fixture"}'),
  ]);
  assert.equal(readTarball(nested).manifest.name, "outer");

  const twoRoots = makeTgz([
    tarEntry("package/package.json", '{"name":"a"}'),
    tarEntry("other/package.json", '{"name":"b"}'),
  ]);
  assert.throws(() => readTarball(twoRoots), /ambiguous archive/);
});

test("missing manifest and corrupt gzip are clear, distinct errors", () => {
  const noManifest = makeTgz([tarEntry("package/index.js", "x")]);
  assert.throws(() => readTarball(noManifest), /no package\.json at the archive root/);

  const brokenGzip = Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.from("definitely not deflate")]);
  assert.throws(() => readTarball(brokenGzip), /gzip decompression failed/);
});

test("bad manifest content fails with its path; tar errors surface as TarballError", () => {
  const badJson = makeTgz([tarEntry("package/package.json", "{nope")]);
  assert.throws(() => readTarball(badJson), /package\/package\.json is not valid JSON/);

  const arrayManifest = makeTgz([tarEntry("package/package.json", "[1,2]")]);
  assert.throws(() => readTarball(arrayManifest), /must contain a JSON object/);

  const corrupt = makeTar([tarEntry("package/package.json", "{}", { corruptChecksum: true })]);
  assert.throws(() => readTarball(corrupt), TarballError);
});

test("extractManifestText returns the exact stored bytes", () => {
  const text = '{\n  "name": "exact",\n  "version": "9.9.9"\n}\n';
  const archive = makeTgz([tarEntry("package/package.json", text)]);
  assert.deepEqual(extractManifestText(archive), { path: "package/package.json", text });
});

test("hashTarball digests the distributed (compressed) bytes", () => {
  const tgz = pkgTarball(basePkg());
  assert.equal(hashTarball(tgz, "sha512").base64, createHash("sha512").update(tgz).digest("base64"));
  assert.equal(hashTarball(tgz, "sha1").hex, createHash("sha1").update(tgz).digest("hex"));
});

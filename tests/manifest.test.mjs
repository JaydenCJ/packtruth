// Registry-document loading: version manifests pass through, packuments
// select the right version, and registry-managed keys are stripped so
// they never masquerade as publisher-authored divergence.
import test from "node:test";
import assert from "node:assert/strict";

import {
  isPackument,
  loadRegistryManifest,
  ManifestError,
  stripRegistryKeys,
  VersionNotFoundError,
} from "../dist/manifest.js";
import { basePkg, packument, registryManifest } from "./helpers.mjs";

test("a version manifest passes through untouched", () => {
  const doc = registryManifest(basePkg());
  const loaded = loadRegistryManifest(doc);
  assert.equal(loaded.source, "version-manifest");
  assert.equal(loaded.manifest, doc);
  assert.equal(loaded.selectedVersion, undefined);
});

test("a packument selects the requested version, else dist-tags.latest", () => {
  const doc = packument("left-pad-plus", [basePkg({ version: "1.0.0" }), basePkg({ version: "1.2.3" })]);
  const explicit = loadRegistryManifest(doc, { version: "1.0.0" });
  assert.equal(explicit.source, "packument");
  assert.equal(explicit.selectedVersion, "1.0.0");
  assert.equal(explicit.manifest.version, "1.0.0");

  const tagged = packument("p", [basePkg({ version: "1.0.0" }), basePkg({ version: "2.0.0" })], "1.0.0");
  assert.equal(loadRegistryManifest(tagged).selectedVersion, "1.0.0");
});

test("a missing version raises VersionNotFoundError listing what exists", () => {
  const doc = packument("p", [basePkg({ version: "1.0.0" })]);
  try {
    loadRegistryManifest(doc, { version: "6.6.6" });
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof VersionNotFoundError);
    assert.equal(err.requested, "6.6.6");
    assert.deepEqual(err.available, ["1.0.0"]);
  }
});

test("a packument without dist-tags needs --registry-version", () => {
  const doc = packument("p", [basePkg()]);
  delete doc["dist-tags"];
  assert.throws(() => loadRegistryManifest(doc), /pass --registry-version/);
});

test("non-objects and shapeless objects are rejected", () => {
  assert.throws(() => loadRegistryManifest("nope"), ManifestError);
  assert.throws(() => loadRegistryManifest([1, 2]), ManifestError);
  assert.throws(() => loadRegistryManifest(null), ManifestError);
  assert.throws(() => loadRegistryManifest({ hello: "world" }), /not an npm manifest/);
});

test("isPackument distinguishes the two document shapes", () => {
  assert.equal(isPackument(packument("p", [basePkg()])), true);
  assert.equal(isPackument(registryManifest(basePkg())), false);
  // A package whose own manifest carries a "versions" field AND a dist
  // object (i.e. a real version manifest) must not be misclassified.
  assert.equal(isPackument({ name: "x", version: "1.0.0", versions: {}, dist: {} }), false);
});

test("stripRegistryKeys removes exactly the registry dressing, without mutating", () => {
  const doc = registryManifest(basePkg(), {
    dist: { tarball: "https://registry.example.test/x.tgz" },
    gitHead: "abc123",
    hasInstallScript: true,
    deprecated: "use something else",
  });
  const stripped = stripRegistryKeys(doc);
  for (const gone of ["_id", "_npmVersion", "_nodeVersion", "maintainers", "dist", "gitHead", "hasInstallScript", "deprecated"]) {
    assert.equal(gone in stripped, false, `${gone} should be stripped`);
  }
  // Publisher-authored fields all survive.
  assert.equal(stripped.name, "left-pad-plus");
  assert.deepEqual(stripped.scripts, { test: "node --test" });
  assert.deepEqual(stripped.dependencies, { "tiny-invariant": "^1.3.0" });
  // And the input document is untouched.
  assert.equal(doc._id, "left-pad-plus@1.2.3");
});

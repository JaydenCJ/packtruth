// The comparison engine — the heart of packtruth. Each test fabricates
// a registry view and a tarball view and asserts on exactly which
// findings come out, at which severity, because that mapping IS the
// security contract.
import test from "node:test";
import assert from "node:assert/strict";

import { checkHasInstallScript, compareManifests, sortFindings } from "../dist/compare.js";
import { basePkg } from "./helpers.mjs";

/** Shorthand: compare and index findings by field. */
function diff(registry, tarball, options) {
  const findings = compareManifests(registry, tarball, options);
  const byField = new Map(findings.map((f) => [f.field, f]));
  return { findings, byField };
}

test("identical manifests produce zero findings", () => {
  const { findings } = diff(basePkg(), basePkg());
  assert.deepEqual(findings, []);
});

test("key order and equivalent spellings produce zero findings", () => {
  const registry = basePkg({
    dependencies: { b: "^2.0.0", a: "^1.0.0" },
    bin: { "left-pad-plus": "./cli.js" },
    bundledDependencies: ["y", "x"],
  });
  const tarball = basePkg({
    dependencies: { a: "^1.0.0", b: "^2.0.0" },
    bin: "cli.js", // string spelling of the same executable
    bundleDependencies: ["x", "y"], // alternate spelling, different order
  });
  assert.deepEqual(diff(registry, tarball).findings, []);
});

test("name and version mismatches are critical", () => {
  const { byField } = diff(basePkg(), basePkg({ name: "left-pad-plus-evil", version: "1.2.4" }));
  assert.equal(byField.get("name").severity, "critical");
  assert.equal(byField.get("version").severity, "critical");
  assert.equal(byField.get("name").kind, "mismatch");
});

test("a hidden postinstall script is the critical finding", () => {
  const { byField } = diff(basePkg(), basePkg({ scripts: { test: "node --test", postinstall: "node x.js" } }));
  const f = byField.get("scripts.postinstall");
  assert.equal(f.severity, "critical");
  assert.equal(f.kind, "tarball-only");
  assert.equal(f.tarball, "node x.js");
  assert.match(f.detail, /npm will run it/);
});

test("each install lifecycle key is critical; prepare is high; others low", () => {
  const tarball = basePkg({
    scripts: {
      test: "node --test",
      preinstall: "a",
      install: "b",
      postinstall: "c",
      prepare: "d",
      lint: "e",
    },
  });
  const { byField } = diff(basePkg(), tarball);
  assert.equal(byField.get("scripts.preinstall").severity, "critical");
  assert.equal(byField.get("scripts.install").severity, "critical");
  assert.equal(byField.get("scripts.postinstall").severity, "critical");
  assert.equal(byField.get("scripts.prepare").severity, "high");
  assert.equal(byField.get("scripts.lint").severity, "low");
});

test("install scripts that differ in body, or exist only registry-side, stay critical", () => {
  const changed = diff(
    basePkg({ scripts: { postinstall: "node-gyp rebuild" } }),
    basePkg({ scripts: { postinstall: "node-gyp rebuild && node collect.js" } }),
  ).byField.get("scripts.postinstall");
  assert.equal(changed.severity, "critical");
  assert.equal(changed.kind, "mismatch");

  const phantom = diff(basePkg({ scripts: { install: "node setup.js" } }), basePkg()).byField.get(
    "scripts.install",
  );
  assert.equal(phantom.kind, "registry-only");
  assert.equal(phantom.severity, "critical");
});

test("hidden dependencies are high-severity, one finding per package", () => {
  const tarball = basePkg({
    dependencies: { "tiny-invariant": "^1.3.0", "evil-payload": "^0.0.1", "other-extra": "*" },
  });
  const { byField, findings } = diff(basePkg(), tarball);
  assert.equal(byField.get("dependencies.evil-payload").severity, "high");
  assert.equal(byField.get("dependencies.evil-payload").kind, "tarball-only");
  assert.equal(byField.get("dependencies.other-extra").kind, "tarball-only");
  assert.equal(findings.length, 2);
});

test("phantom and range-changed dependencies are reported distinctly", () => {
  const registry = basePkg({ dependencies: { "tiny-invariant": "^1.3.0", ghost: "^2.0.0" } });
  const tarball = basePkg({ dependencies: { "tiny-invariant": "^1.4.0" } });
  const { byField } = diff(registry, tarball);
  assert.equal(byField.get("dependencies.ghost").kind, "registry-only");
  const changed = byField.get("dependencies.tiny-invariant");
  assert.equal(changed.kind, "mismatch");
  assert.equal(changed.registry, "^1.3.0");
  assert.equal(changed.tarball, "^1.4.0");
});

test("optional and peer dependency divergence is high; dev is low", () => {
  const tarball = basePkg({
    optionalDependencies: { opt: "^1.0.0" },
    peerDependencies: { react: ">=18" },
    devDependencies: { devonly: "^1.0.0" },
  });
  const { byField } = diff(basePkg(), tarball);
  assert.equal(byField.get("optionalDependencies.opt").severity, "high");
  assert.equal(byField.get("peerDependencies.react").severity, "high");
  assert.equal(byField.get("devDependencies.devonly").severity, "low");
});

test("bin: a hidden entry is high with PATH wording; same name, different file is a mismatch", () => {
  const hidden = diff(
    basePkg({ bin: { "left-pad-plus": "cli.js" } }),
    basePkg({ bin: { "left-pad-plus": "cli.js", node2: "payload.js" } }),
  ).byField.get("bin.node2");
  assert.equal(hidden.severity, "high");
  assert.equal(hidden.kind, "tarball-only");
  assert.match(hidden.detail, /PATH/);

  const swapped = diff(basePkg({ bin: { tool: "cli.js" } }), basePkg({ bin: { tool: "other.js" } })).byField.get(
    "bin.tool",
  );
  assert.equal(swapped.kind, "mismatch");
});

test("entry-point fields are medium; types and typings are the same field", () => {
  const tarball = basePkg({
    main: "lib/other.js",
    module: "esm/index.js",
    types: "index.d.ts",
    type: "module",
    exports: { ".": "./lib/other.js" },
  });
  const { byField } = diff(basePkg(), tarball);
  for (const field of ["main", "module", "types", "type", "exports"]) {
    assert.equal(byField.get(field).severity, "medium", field);
  }
  // typings is the legacy alias for types — never a divergence on its own.
  assert.deepEqual(diff(basePkg({ types: "index.d.ts" }), basePkg({ typings: "index.d.ts" })).findings, []);
});

test("exports maps are compared structurally, not textually", () => {
  const registry = basePkg({ exports: { ".": { import: "./a.js", require: "./b.cjs" } } });
  const same = basePkg({ exports: { ".": { require: "./b.cjs", import: "./a.js" } } });
  assert.deepEqual(diff(registry, same).findings, []);
  const different = basePkg({ exports: { ".": { import: "./EVIL.js", require: "./b.cjs" } } });
  assert.equal(diff(registry, different).byField.get("exports").severity, "medium");
});

test("os/cpu compare order-insensitively at medium; license divergence is medium", () => {
  const registry = basePkg({ os: ["darwin", "linux"], cpu: ["x64"] });
  const same = basePkg({ os: ["linux", "darwin"], cpu: ["x64"] });
  assert.deepEqual(diff(registry, same).findings, []);
  const gained = basePkg({ os: ["linux", "darwin", "win32"], cpu: ["x64"] });
  assert.equal(diff(registry, gained).byField.get("os").severity, "medium");

  const license = diff(basePkg(), basePkg({ license: "SEE LICENSE IN COMMERCIAL.txt" })).byField.get("license");
  assert.equal(license.severity, "medium");
});

test("cosmetic fields diverge at info; uncategorized fields get a generic info finding", () => {
  const registry = basePkg({ eslintConfig: { extends: "standard" } });
  const tarball = basePkg({
    description: "different words",
    keywords: ["a"],
    homepage: "https://example.test",
    eslintConfig: { extends: "other" },
    customBlob: { x: 1 },
  });
  const { byField } = diff(registry, tarball);
  assert.equal(byField.get("description").severity, "info");
  assert.equal(byField.get("keywords").severity, "info");
  assert.equal(byField.get("homepage").severity, "info");
  assert.equal(byField.get("eslintConfig").severity, "info");
  assert.equal(byField.get("customBlob").kind, "tarball-only");
});

test("fields missing from both sides (or JSON null) produce nothing", () => {
  const { findings } = diff(basePkg({ main: null }), basePkg({ main: undefined }));
  assert.deepEqual(findings, []);
});

test("--ignore suppresses a field and its per-key findings", () => {
  const tarball = basePkg({
    devDependencies: { extra: "^1.0.0" },
    dependencies: { "tiny-invariant": "^1.3.0", hidden: "*" },
  });
  const { byField, findings } = diff(basePkg(), tarball, { ignore: ["devDependencies"] });
  assert.equal(byField.has("devDependencies.extra"), false);
  assert.equal(byField.get("dependencies.hidden").severity, "high"); // others unaffected
  assert.equal(findings.length, 1);
});

test("findings sort by severity then field; sortFindings never mutates", () => {
  const tarball = basePkg({
    description: "cosmetic",
    main: "other.js",
    scripts: { test: "node --test", postinstall: "x" },
    dependencies: { "tiny-invariant": "^1.3.0", zzz: "*", aaa: "*" },
  });
  const { findings } = diff(basePkg(), tarball);
  assert.deepEqual(
    findings.map((f) => f.field),
    ["scripts.postinstall", "dependencies.aaa", "dependencies.zzz", "main", "description"],
  );

  const input = [
    { field: "b", kind: "mismatch", severity: "info", detail: "" },
    { field: "a", kind: "mismatch", severity: "critical", detail: "" },
  ];
  const sorted = sortFindings(input);
  assert.equal(sorted[0].field, "a");
  assert.equal(input[0].field, "b"); // untouched
});

test("hasInstallScript=false with real install scripts is critical", () => {
  const findings = checkHasInstallScript(
    { hasInstallScript: false },
    basePkg({ scripts: { preinstall: "a", postinstall: "b" } }),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "critical");
  assert.deepEqual(findings[0].tarball, ["preinstall", "postinstall"]);
});

test("hasInstallScript=true without install scripts is medium; agreement yields nothing", () => {
  const phantom = checkHasInstallScript({ hasInstallScript: true }, basePkg());
  assert.equal(phantom.length, 1);
  assert.equal(phantom[0].severity, "medium");

  assert.deepEqual(checkHasInstallScript({ hasInstallScript: true }, basePkg({ scripts: { install: "x" } })), []);
  assert.deepEqual(checkHasInstallScript({ hasInstallScript: false }, basePkg()), []);
  assert.deepEqual(checkHasInstallScript({}, basePkg({ scripts: { install: "x" } })), []);
});

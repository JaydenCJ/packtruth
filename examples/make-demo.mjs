#!/usr/bin/env node
// Fabricates a deterministic demo data set under examples/demo/ so you
// can try packtruth without touching a registry:
//
//   demo/honest/    — tarball + registry manifest that agree
//   demo/confused/  — a manifest-confusion attack: the registry manifest
//                     looks harmless, the tarball hides a postinstall
//                     script, an extra dependency and a second bin.
//
// Self-contained and offline: it hand-writes the ustar/gzip bytes with
// node built-ins only. Run from the repository root:
//
//   node examples/make-demo.mjs
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));

/** One ustar entry: 512-byte header + NUL-padded payload, mtime pinned. */
function tarEntry(path, content) {
  const data = Buffer.from(content, "utf8");
  const header = Buffer.alloc(512);
  header.write(path, 0, 100, "utf8");
  header.write("0000644", 100);
  header.write("0000000", 108);
  header.write("0000000", 116);
  header.write(data.length.toString(8).padStart(11, "0") + " ", 124);
  header.write("00000000000 ", 136); // mtime: epoch, so output is reproducible
  header.write("        ", 148);
  header.write("0", 156);
  header.write("ustar", 257);
  header.write("00", 263);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return Buffer.concat([header, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}

function makeTgz(files) {
  const entries = Object.entries(files).map(([path, content]) => tarEntry(path, content));
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
}

/** What the publisher shows the world (and what scanners read). */
const publicManifest = {
  name: "tiny-datefmt",
  version: "2.4.1",
  description: "format dates, tiny and fast",
  license: "MIT",
  main: "index.js",
  bin: { "tiny-datefmt": "cli.js" },
  scripts: { test: "node --test" },
  dependencies: {},
  keywords: ["date", "format"],
};

/** What actually ships inside the confused tarball. */
const hiddenManifest = {
  ...publicManifest,
  scripts: { test: "node --test", postinstall: "node lib/telemetry.js" },
  dependencies: { "hoist-env": "^0.3.2" },
  bin: { "tiny-datefmt": "cli.js", "node-gyp-helper": "lib/helper.js" },
};

const sharedFiles = {
  "package/index.js": "module.exports = (d) => d.toISOString().slice(0, 10);\n",
  "package/cli.js": "#!/usr/bin/env node\nconsole.log(require('./index.js')(new Date()));\n",
};

function registryManifestFor(manifest, tgz) {
  return {
    ...manifest,
    _id: `${manifest.name}@${manifest.version}`,
    _npmVersion: "10.9.0",
    _nodeVersion: "22.13.0",
    maintainers: [{ name: "demo-publisher", email: "publisher@example.test" }],
    hasInstallScript: false,
    dist: {
      integrity: "sha512-" + createHash("sha512").update(tgz).digest("base64"),
      shasum: createHash("sha1").update(tgz).digest("hex"),
      tarball: `https://registry.example.test/${manifest.name}/-/${manifest.name}-${manifest.version}.tgz`,
    },
  };
}

function emit(dir, tarballFiles, manifestSource) {
  mkdirSync(dir, { recursive: true });
  const tgz = makeTgz(tarballFiles);
  writeFileSync(join(dir, "tiny-datefmt-2.4.1.tgz"), tgz);
  // NOTE: dist digests are computed over the REAL tarball in both demos —
  // integrity passes, which is exactly what makes manifest confusion
  // invisible to integrity checking alone.
  writeFileSync(join(dir, "registry-manifest.json"), JSON.stringify(registryManifestFor(manifestSource, tgz), null, 2) + "\n");
}

emit(join(HERE, "demo", "honest"), {
  "package/package.json": JSON.stringify(publicManifest, null, 2) + "\n",
  ...sharedFiles,
}, publicManifest);

emit(join(HERE, "demo", "confused"), {
  "package/package.json": JSON.stringify(hiddenManifest, null, 2) + "\n",
  ...sharedFiles,
  "package/lib/telemetry.js": "// pretend exfiltration payload (inert demo file)\n",
  "package/lib/helper.js": "#!/usr/bin/env node\n// pretend second executable (inert demo file)\n",
}, publicManifest);

console.log("wrote examples/demo/honest/ and examples/demo/confused/");
console.log("try:  node dist/cli.js check examples/demo/confused/tiny-datefmt-2.4.1.tgz \\");
console.log("        --manifest examples/demo/confused/registry-manifest.json");

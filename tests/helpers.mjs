// Shared test helpers: a deterministic ustar/pax writer (so the reader
// is tested against real archive bytes, not its own output), package
// manifest factories, and a runner for the built CLI. No network, no
// wall clocks — every archive is byte-reproducible.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "dist", "cli.js");

/** Write one 512-byte ustar header + padded payload. */
export function tarEntry(path, content, options = {}) {
  const data = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  const header = Buffer.alloc(512);
  header.write(path, 0, 100, "utf8");
  header.write("0000644", 100); // mode
  header.write("0000000", 108); // uid
  header.write("0000000", 116); // gid
  if (options.base256Size) {
    // GNU base-256 size encoding: top bit set on the first byte.
    header[124] = 0x80;
    let size = data.length;
    for (let i = 135; i > 124; i--) {
      header[i] = size % 256;
      size = Math.floor(size / 256);
    }
  } else {
    header.write(data.length.toString(8).padStart(11, "0") + " ", 124);
  }
  header.write("00000000000 ", 136); // mtime: epoch, pinned
  header.write("        ", 148); // checksum placeholder (spaces)
  header.write(options.type ?? "0", 156);
  header.write("ustar", 257);
  header.write("00", 263);
  if (options.prefix) header.write(options.prefix, 345, 155, "utf8");
  let sum = 0;
  for (const byte of header) sum += byte;
  if (options.corruptChecksum) sum += 1;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header, data, padding]);
}

/** A pax extended header ('x') carrying the given records. */
export function paxEntry(records, type = "x") {
  let body = "";
  for (const [key, value] of Object.entries(records)) {
    // Record length includes its own decimal digits — iterate to fixpoint.
    const base = ` ${key}=${value}\n`;
    let len = base.length + 1;
    while (String(len).length + base.length !== len) len = String(len).length + base.length;
    body += `${len}${base}`;
  }
  return tarEntry("PaxHeader/x", body, { type });
}

/** Assemble entries plus the two-zero-block end-of-archive marker. */
export function makeTar(entryBuffers) {
  return Buffer.concat([...entryBuffers, Buffer.alloc(1024)]);
}

/** Gzip an assembled archive (Node's gzip header is deterministic). */
export function makeTgz(entryBuffers) {
  return gzipSync(makeTar(entryBuffers));
}

/** The default happy-path package.json used by fixtures. */
export function basePkg(overrides = {}) {
  return {
    name: "left-pad-plus",
    version: "1.2.3",
    description: "pads, but more",
    license: "MIT",
    main: "index.js",
    scripts: { test: "node --test" },
    dependencies: { "tiny-invariant": "^1.3.0" },
    ...overrides,
  };
}

/** A tarball whose package/package.json is the given manifest object. */
export function pkgTarball(manifest, extraEntries = []) {
  return makeTgz([
    tarEntry("package/package.json", JSON.stringify(manifest, null, 2) + "\n"),
    tarEntry("package/index.js", "module.exports = (s) => s;\n"),
    ...extraEntries,
  ]);
}

/** A registry version manifest: the same fields plus registry dressing. */
export function registryManifest(manifest, extras = {}) {
  return {
    ...manifest,
    _id: `${manifest.name}@${manifest.version}`,
    _npmVersion: "10.9.0",
    _nodeVersion: "22.13.0",
    maintainers: [{ name: "someone", email: "someone@example.test" }],
    ...extras,
  };
}

/** A packument wrapping the given version manifests. */
export function packument(name, versionManifests, latest) {
  const versions = {};
  for (const m of versionManifests) versions[m.version] = registryManifest(m);
  return {
    _id: name,
    name,
    "dist-tags": { latest: latest ?? versionManifests[versionManifests.length - 1].version },
    versions,
  };
}

/** Fresh temp dir; caller cleans with rmSync via the returned dispose. */
export function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "packtruth-test-"));
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Write fixture files into a temp dir and run the built CLI. */
export function runCli(args, { files = {}, stdin } = {}) {
  const { dir, dispose } = tempDir();
  try {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content);
    }
    const result = spawnSync(process.execPath, [CLI, ...args], {
      cwd: dir,
      input: stdin,
      encoding: "utf8",
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally {
    dispose();
  }
}

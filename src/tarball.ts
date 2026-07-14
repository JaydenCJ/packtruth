/**
 * Opens an npm package tarball (.tgz or plain .tar), locates the
 * package.json that installers will actually honor, and computes the
 * digests needed to verify the registry's `dist` claims. Pure: takes a
 * Buffer, does no I/O of its own.
 */

import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { listTarEntries, TarError, type TarEntry } from "./tar.js";
import type { ManifestObject } from "./types.js";

/** Raised when the tarball cannot yield a usable package.json. */
export class TarballError extends Error {
  override name = "TarballError";
}

/** Everything packtruth needs to know about one tarball. */
export interface TarballInfo {
  /** The parsed package.json found inside the archive. */
  manifest: ManifestObject;
  /** Where it was found, e.g. `package/package.json`. */
  manifestPath: string;
  /** Number of file entries in the archive (context for reports). */
  fileCount: number;
}

/** GZIP magic bytes. */
function isGzip(raw: Buffer): boolean {
  return raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b;
}

/** Decompress if gzipped; accept plain tar as-is. */
function decompress(raw: Buffer): Buffer {
  if (!isGzip(raw)) return raw;
  try {
    return gunzipSync(raw);
  } catch (err) {
    throw new TarballError(`gzip decompression failed: ${(err as Error).message}`);
  }
}

/** Strip a leading `./`, collapse doubled slashes. */
function normalizePath(path: string): string {
  return path.replace(/^\.\//, "").replace(/\/{2,}/g, "/").replace(/\/$/, "");
}

/**
 * Find the manifest entry. npm archives everything under one root folder
 * (canonically `package/`, but scoped builds and other clients vary), so
 * the manifest is `<root>/package.json`. A bare root-level `package.json`
 * (hand-rolled archives) is accepted too. Deeper package.json files are
 * fixtures or nested test data — never the installed manifest.
 */
function findManifestEntry(entries: TarEntry[]): TarEntry {
  const candidates = entries.filter((e) => {
    if (e.type !== "0") return false;
    const parts = normalizePath(e.path).split("/");
    return (
      (parts.length === 2 && parts[1] === "package.json") ||
      (parts.length === 1 && parts[0] === "package.json")
    );
  });
  if (candidates.length === 0) {
    throw new TarballError("no package.json at the archive root (is this an npm package tarball?)");
  }
  if (candidates.length > 1) {
    const seen = candidates.map((c) => c.path).join(", ");
    throw new TarballError(`ambiguous archive: multiple root package.json files (${seen})`);
  }
  return candidates[0] as TarEntry;
}

/** Open the tarball and extract its manifest. */
export function readTarball(raw: Buffer): TarballInfo {
  const archive = decompress(raw);
  let entries: TarEntry[];
  try {
    entries = listTarEntries(archive);
  } catch (err) {
    if (err instanceof TarError) throw new TarballError(err.message);
    throw err;
  }
  const entry = findManifestEntry(entries);
  const text = entry.data.toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new TarballError(`${entry.path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TarballError(`${entry.path} must contain a JSON object`);
  }
  return {
    manifest: parsed as ManifestObject,
    manifestPath: entry.path,
    fileCount: entries.filter((e) => e.type === "0").length,
  };
}

/** Return the raw package.json text exactly as stored in the archive. */
export function extractManifestText(raw: Buffer): { path: string; text: string } {
  const archive = decompress(raw);
  let entries: TarEntry[];
  try {
    entries = listTarEntries(archive);
  } catch (err) {
    if (err instanceof TarError) throw new TarballError(err.message);
    throw err;
  }
  const entry = findManifestEntry(entries);
  return { path: entry.path, text: entry.data.toString("utf8") };
}

/**
 * Digest the tarball bytes *as distributed* (the registry hashes the
 * compressed file, not the tar stream inside it).
 */
export function hashTarball(raw: Buffer, algorithm: "sha1" | "sha256" | "sha512"): {
  hex: string;
  base64: string;
} {
  return {
    hex: createHash(algorithm).update(raw).digest("hex"),
    base64: createHash(algorithm).update(raw).digest("base64"),
  };
}

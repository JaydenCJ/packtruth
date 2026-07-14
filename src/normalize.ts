/**
 * Canonicalization helpers: turn the many equivalent spellings npm
 * accepts into one comparable form, so packtruth flags real divergence
 * and never formatting noise. Also home to the stable stringifier used
 * for deep equality and report rendering.
 */

import type { ManifestObject } from "./types.js";

/** JSON.stringify with object keys sorted at every depth (stable). */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const keys = Object.keys(value as ManifestObject).sort();
  const body = keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as ManifestObject)[k])}`)
    .join(",");
  return `{${body}}`;
}

/** Deep equality via canonical serialization. */
export function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** Render a value for the text report, truncated to keep rows readable. */
export function renderValue(value: unknown, max = 58): string {
  if (value === undefined) return "—"; // em dash: "not present"
  const text = stableStringify(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/**
 * Normalize a `bin` field. npm allows a bare string (one executable
 * named after the unscoped package name) or a map of name → path; both
 * spellings install identically, so both compare identically.
 */
export function normalizeBin(bin: unknown, packageName: unknown): Record<string, string> | undefined {
  if (bin === undefined || bin === null) return undefined;
  if (typeof bin === "string") {
    const name = typeof packageName === "string" ? packageName : "";
    const unscoped = name.startsWith("@") ? name.slice(name.indexOf("/") + 1) : name;
    return { [unscoped === "" ? "bin" : unscoped]: normalizeBinPath(bin) };
  }
  if (typeof bin === "object" && !Array.isArray(bin)) {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(bin as ManifestObject)) {
      if (typeof value === "string") out[key] = normalizeBinPath(value);
    }
    return out;
  }
  return undefined;
}

/** `./cli.js` and `cli.js` point at the same file. */
function normalizeBinPath(path: string): string {
  return path.replace(/^\.\//, "");
}

/**
 * Normalize the two historical spellings of bundled dependencies into
 * one sorted list. `true` means "bundle everything in dependencies".
 */
export function normalizeBundled(manifest: ManifestObject): string[] | true | undefined {
  const raw = manifest["bundledDependencies"] ?? manifest["bundleDependencies"];
  if (raw === undefined || raw === null || raw === false) return undefined;
  if (raw === true) return true;
  if (Array.isArray(raw)) {
    return [...raw].filter((v): v is string => typeof v === "string").sort();
  }
  return undefined;
}

/** Coerce a value into a string→string record; non-records become undefined. */
export function asRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as ManifestObject)) {
    out[key] = typeof entry === "string" ? entry : stableStringify(entry);
  }
  return out;
}

/** Sorted string list, or undefined for anything that is not an array. */
export function asSortedList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((v) => (typeof v === "string" ? v : stableStringify(v))).sort();
}

/**
 * Loads the registry side of the comparison. Accepts either a bare
 * version manifest (what `npm view <pkg>@<version> --json` prints) or a
 * full packument (`https://registry.example.test/<pkg>` saved to disk /
 * `npm view <pkg> --json`), from which the right version is selected.
 */

import type { ManifestObject } from "./types.js";

/** Raised for structurally unusable registry documents. */
export class ManifestError extends Error {
  override name = "ManifestError";
}

/** Raised when a packument does not contain the requested version. */
export class VersionNotFoundError extends ManifestError {
  override name = "VersionNotFoundError";
  constructor(
    public readonly requested: string,
    public readonly available: string[],
  ) {
    super(`version ${requested} is not in the registry document (available: ${available.join(", ") || "none"})`);
  }
}

/**
 * Keys the registry adds to (or manages on) a version manifest. They can
 * never diverge "from the tarball" because they never existed in it, so
 * the comparison must not treat them as fields the publisher wrote.
 * `dist` is consumed separately for integrity checking; `deprecated` and
 * `hasInstallScript` get dedicated handling in the comparator.
 */
export const REGISTRY_MANAGED_KEYS = [
  "_id",
  "_rev",
  "_from",
  "_shasum",
  "_resolved",
  "_integrity",
  "_nodeVersion",
  "_npmVersion",
  "_npmUser",
  "_npmOperationalInternal",
  "_hasShrinkwrap",
  "_engineSupported",
  "_defaultsLoaded",
  "dist",
  "maintainers",
  "readme",
  "readmeFilename",
  "gitHead",
  "users",
  "deprecated",
  "hasInstallScript",
] as const;

/** What loading produced, with provenance for the report header. */
export interface LoadedManifest {
  /** The version-level manifest, registry-managed keys still present. */
  manifest: ManifestObject;
  /** Whether the input was a packument or already version-level. */
  source: "packument" | "version-manifest";
  /** The version picked out of a packument (absent for version manifests). */
  selectedVersion?: string;
}

function isObject(value: unknown): value is ManifestObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A packument has a `versions` map and no top-level `dist`. */
export function isPackument(doc: ManifestObject): boolean {
  return isObject(doc["versions"]) && doc["dist"] === undefined;
}

/**
 * Resolve the registry document to a single version manifest.
 * Selection order for packuments: the explicit `version` option (usually
 * the version found inside the tarball), else `dist-tags.latest`.
 */
export function loadRegistryManifest(
  doc: unknown,
  options: { version?: string } = {},
): LoadedManifest {
  if (!isObject(doc)) {
    throw new ManifestError("registry document must be a JSON object");
  }
  if (!isPackument(doc)) {
    if (typeof doc["name"] !== "string" && typeof doc["version"] !== "string") {
      throw new ManifestError(
        "registry document has neither a versions map nor name/version fields — not an npm manifest",
      );
    }
    return { manifest: doc, source: "version-manifest" };
  }

  const versions = doc["versions"] as Record<string, unknown>;
  const available = Object.keys(versions);
  let wanted = options.version;
  if (wanted === undefined) {
    const distTags = doc["dist-tags"];
    if (isObject(distTags) && typeof distTags["latest"] === "string") {
      wanted = distTags["latest"];
    }
  }
  if (wanted === undefined) {
    throw new ManifestError("packument has no dist-tags.latest; pass --registry-version");
  }
  const selected = versions[wanted];
  if (!isObject(selected)) {
    throw new VersionNotFoundError(wanted, available);
  }
  return { manifest: selected, source: "packument", selectedVersion: wanted };
}

/** The publisher-authored view: registry-managed keys removed. */
export function stripRegistryKeys(manifest: ManifestObject): ManifestObject {
  const out: ManifestObject = {};
  for (const [key, value] of Object.entries(manifest)) {
    if (!(REGISTRY_MANAGED_KEYS as readonly string[]).includes(key)) {
      out[key] = value;
    }
  }
  return out;
}

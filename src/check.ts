/**
 * Orchestration: tie tarball reading, registry-manifest loading,
 * integrity verification and the field comparator into one Report.
 * This is the whole programmatic entry point — the CLI is a thin shell
 * around `runCheck`.
 */

import { checkHasInstallScript, compareManifests, sortFindings, type CompareOptions } from "./compare.js";
import { checkIntegrity } from "./integrity.js";
import { loadRegistryManifest, stripRegistryKeys, VersionNotFoundError } from "./manifest.js";
import { readTarball } from "./tarball.js";
import type { Finding, Report, Severity, Summary } from "./types.js";
import { atLeast } from "./types.js";

export interface CheckOptions extends CompareOptions {
  /** Force a packument version instead of the tarball's own version. */
  registryVersion?: string;
  /** Skip dist.integrity/shasum verification. */
  noIntegrity?: boolean;
  /** Labels for the report header (file names, "stdin", …). */
  manifestLabel?: string;
  tarballLabel?: string;
}

/** Count findings per severity. */
export function summarize(findings: Finding[]): Summary {
  const summary: Summary = { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: findings.length };
  for (const f of findings) summary[f.severity] += 1;
  return summary;
}

/** Does the report warrant a non-zero exit at this threshold? */
export function failsAt(report: Report, threshold: Severity | "never"): boolean {
  if (threshold === "never") return false;
  return report.findings.some((f) => atLeast(f.severity, threshold));
}

function buildReport(
  findings: Finding[],
  options: CheckOptions,
  pkg: { name: string; version: string },
  integrity: Report["integrity"],
): Report {
  const sorted = sortFindings(findings);
  return {
    tool: "packtruth",
    schemaVersion: 1,
    package: pkg,
    source: {
      manifest: options.manifestLabel ?? "registry manifest",
      tarball: options.tarballLabel ?? "tarball",
    },
    integrity,
    findings: sorted,
    summary: summarize(sorted),
    verdict: sorted.length === 0 ? "clean" : "divergent",
  };
}

/**
 * Cross-check one tarball against one registry document.
 *
 * @param registryDoc  Parsed JSON: a version manifest or a packument.
 * @param tarballRaw   The .tgz (or .tar) bytes as distributed.
 */
export function runCheck(registryDoc: unknown, tarballRaw: Buffer, options: CheckOptions = {}): Report {
  const tarball = readTarball(tarballRaw);
  const tarName = typeof tarball.manifest["name"] === "string" ? (tarball.manifest["name"] as string) : "(unnamed)";
  const tarVersion =
    typeof tarball.manifest["version"] === "string" ? (tarball.manifest["version"] as string) : "(no version)";
  const pkg = { name: tarName, version: tarVersion };

  let loaded;
  try {
    loaded = loadRegistryManifest(registryDoc, {
      version: options.registryVersion ?? (tarVersion !== "(no version)" ? tarVersion : undefined),
    });
  } catch (err) {
    if (err instanceof VersionNotFoundError) {
      // The packument does not even contain this version — the sharpest
      // divergence there is. Report it instead of erroring out.
      const finding: Finding = {
        field: "version",
        kind: "missing-version",
        severity: "critical",
        tarball: err.requested,
        registry: err.available,
        detail: "the tarball's version does not exist in the registry document",
      };
      return buildReport([finding], options, pkg, null);
    }
    throw err;
  }

  const findings: Finding[] = [];
  let integrity: Report["integrity"] = null;
  if (!options.noIntegrity) {
    const check = checkIntegrity(loaded.manifest, tarballRaw);
    integrity = check.result;
    findings.push(...check.findings);
  }
  if (!(options.ignore ?? []).includes("hasInstallScript")) {
    findings.push(...checkHasInstallScript(loaded.manifest, tarball.manifest));
  }
  findings.push(...compareManifests(stripRegistryKeys(loaded.manifest), tarball.manifest, options));

  return buildReport(findings, options, pkg, integrity);
}

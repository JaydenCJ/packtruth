/**
 * Verifies the registry's `dist` claims (SRI `integrity` and legacy
 * `shasum`) against the actual tarball bytes. If the bytes do not match,
 * every other comparison is moot: the registry is pointing at a
 * different artifact than the one being inspected.
 */

import { hashTarball } from "./tarball.js";
import type { Finding, IntegrityResult, ManifestObject } from "./types.js";

const SRI_ALGORITHMS = ["sha512", "sha256", "sha1"] as const;
type SriAlgorithm = (typeof SRI_ALGORITHMS)[number];

interface ParsedSri {
  algorithm: SriAlgorithm;
  digest: string; // base64
}

/** Parse an SRI string ("sha512-BASE64 sha256-BASE64 …") into known entries. */
export function parseSri(integrity: string): ParsedSri[] {
  const out: ParsedSri[] = [];
  for (const token of integrity.trim().split(/\s+/)) {
    const dash = token.indexOf("-");
    if (dash === -1) continue;
    const algorithm = token.slice(0, dash) as SriAlgorithm;
    if (!(SRI_ALGORITHMS as readonly string[]).includes(algorithm)) continue;
    // Strip SRI options ("?…") if present; the digest is base64.
    const digest = token.slice(dash + 1).split("?")[0] as string;
    if (digest.length > 0) out.push({ algorithm, digest });
  }
  return out;
}

export interface IntegrityCheck {
  result: IntegrityResult | null;
  findings: Finding[];
}

/**
 * Check the tarball against the version manifest's `dist` object.
 * Returns `result: null` when there is nothing verifiable (no dist, or
 * no recognizable digest inside it).
 */
export function checkIntegrity(rawRegistryManifest: ManifestObject, tarball: Buffer): IntegrityCheck {
  const dist = rawRegistryManifest["dist"];
  if (typeof dist !== "object" || dist === null || Array.isArray(dist)) {
    return { result: null, findings: [] };
  }
  const distObj = dist as ManifestObject;
  const findings: Finding[] = [];
  const checked: string[] = [];
  let ok = true;

  const integrity = distObj["integrity"];
  if (typeof integrity === "string") {
    const entries = parseSri(integrity);
    if (entries.length === 0) {
      findings.push({
        field: "dist.integrity",
        kind: "integrity",
        severity: "low",
        registry: integrity,
        detail: "integrity string contains no recognizable sha512/sha256/sha1 digest",
      });
    }
    for (const entry of entries) {
      checked.push(entry.algorithm);
      const actual = hashTarball(tarball, entry.algorithm).base64;
      if (actual !== entry.digest) {
        ok = false;
        findings.push({
          field: "dist.integrity",
          kind: "integrity",
          severity: "critical",
          registry: `${entry.algorithm}-${entry.digest}`,
          tarball: `${entry.algorithm}-${actual}`,
          detail: "tarball bytes do not match the registry integrity digest — this is a different artifact",
        });
      }
    }
  }

  const shasum = distObj["shasum"];
  if (typeof shasum === "string" && shasum.length > 0) {
    checked.push("shasum(sha1)");
    const actual = hashTarball(tarball, "sha1").hex;
    if (actual !== shasum.toLowerCase()) {
      ok = false;
      findings.push({
        field: "dist.shasum",
        kind: "integrity",
        severity: "critical",
        registry: shasum,
        tarball: actual,
        detail: "tarball bytes do not match the registry shasum — this is a different artifact",
      });
    }
  }

  if (checked.length === 0) {
    return { result: null, findings };
  }
  return { result: { checked, ok }, findings };
}

/**
 * Shared types for packtruth: findings, severities, and the report
 * envelope. Everything here is plain data — no behavior — so both the
 * CLI and the programmatic API can share it.
 */

/** How bad a divergence is. Order matters: index 0 is the worst. */
export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** The shape a single divergence takes. */
export type FindingKind =
  | "mismatch" /* both sides define the field, values differ            */
  | "tarball-only" /* the tarball declares it, the registry manifest hides it */
  | "registry-only" /* the registry advertises it, the tarball does not have it */
  | "integrity" /* the tarball bytes do not match dist.integrity/shasum   */
  | "missing-version"; /* the packument does not contain the tarball's version */

/** One divergent field, with both observed values and an explanation. */
export interface Finding {
  /** Dotted field path, e.g. `scripts.postinstall` or `dependencies.qs`. */
  field: string;
  kind: FindingKind;
  severity: Severity;
  /** Value as seen in the registry manifest; absent when the registry omits it. */
  registry?: unknown;
  /** Value as seen inside the tarball's package.json; absent when missing. */
  tarball?: unknown;
  /** One human sentence: what diverged and why it matters. */
  detail: string;
}

/** Result of verifying the tarball bytes against the registry `dist` object. */
export interface IntegrityResult {
  /** Which digests were actually verified (subset of what `dist` offered). */
  checked: string[];
  /** True when every verified digest matched the tarball bytes. */
  ok: boolean;
}

/** Per-severity counts plus the total. */
export interface Summary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  total: number;
}

/** The full machine-readable report (`--format json` prints exactly this). */
export interface Report {
  tool: "packtruth";
  schemaVersion: 1;
  package: { name: string; version: string };
  source: { manifest: string; tarball: string };
  /** Null when `dist` offered nothing verifiable or integrity was disabled. */
  integrity: IntegrityResult | null;
  findings: Finding[];
  summary: Summary;
  verdict: "clean" | "divergent";
}

/** A parsed package.json / registry version manifest: plain JSON object. */
export type ManifestObject = Record<string, unknown>;

/** Severity comparison: is `a` at least as severe as `b`? */
export function atLeast(a: Severity, b: Severity): boolean {
  return SEVERITIES.indexOf(a) <= SEVERITIES.indexOf(b);
}

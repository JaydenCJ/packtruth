/**
 * The field policy table: every manifest field packtruth checks, how it
 * is compared, and how severe a divergence in it is. This table is data,
 * not code — docs/fields.md mirrors it and `packtruth fields` prints it.
 */

import type { Severity } from "./types.js";

/** How a field's values are compared. */
export type CompareKind =
  | "scalar" /* string/number/boolean compared directly            */
  | "record" /* string→string map, diffed key by key               */
  | "scripts" /* like record, but severity depends on the key       */
  | "bin" /* record after normalizing npm's two bin spellings   */
  | "list" /* array compared order-insensitively                 */
  | "deep"; /* arbitrary JSON compared structurally               */

export interface FieldPolicy {
  field: string;
  kind: CompareKind;
  severity: Severity;
  /** Why a divergence in this field matters (shown by `packtruth fields`). */
  rationale: string;
}

/**
 * Lifecycle scripts npm runs automatically when the package is installed
 * as a dependency. A script hidden here is the manifest-confusion RCE:
 * npm executes the tarball's copy while scanners read the registry's.
 */
export const INSTALL_LIFECYCLE = ["preinstall", "install", "postinstall"] as const;

/** Scripts npm runs on other automatic occasions (git deps, publish). */
export const SECONDARY_LIFECYCLE = ["prepare", "prepublish", "preprepare", "postprepare"] as const;

/** Severity for one script key. */
export function scriptSeverity(key: string): Severity {
  if ((INSTALL_LIFECYCLE as readonly string[]).includes(key)) return "critical";
  if ((SECONDARY_LIFECYCLE as readonly string[]).includes(key)) return "high";
  return "low";
}

/** The ordered policy table (report rows follow this order within a severity). */
export const FIELD_POLICIES: FieldPolicy[] = [
  {
    field: "name",
    kind: "scalar",
    severity: "critical",
    rationale: "a different name inside the tarball poisons caches and confuses every tool that trusts one side",
  },
  {
    field: "version",
    kind: "scalar",
    severity: "critical",
    rationale: "advisory matching, lockfiles and dedupe all key on the version the registry advertises",
  },
  {
    field: "scripts",
    kind: "scripts",
    severity: "critical",
    rationale: "npm executes the tarball's lifecycle scripts; a copy hidden from the registry is invisible to scanners",
  },
  {
    field: "dependencies",
    kind: "record",
    severity: "high",
    rationale: "hidden dependencies dodge audit, license and policy checks that read only the registry manifest",
  },
  {
    field: "optionalDependencies",
    kind: "record",
    severity: "high",
    rationale: "optional deps still install by default — hiding one hides an entire subtree from review",
  },
  {
    field: "peerDependencies",
    kind: "record",
    severity: "high",
    rationale: "divergent peer ranges change resolver behavior between what was reviewed and what installs",
  },
  {
    field: "bundledDependencies",
    kind: "list",
    severity: "high",
    rationale: "bundled code ships inside the tarball itself; the registry list is the only inventory of it",
  },
  {
    field: "bin",
    kind: "bin",
    severity: "high",
    rationale: "bin entries land on PATH at install time; a hidden one plants an executable nothing reviewed",
  },
  {
    field: "main",
    kind: "scalar",
    severity: "medium",
    rationale: "the entry point actually loaded can differ from the one shown on the registry page",
  },
  {
    field: "module",
    kind: "scalar",
    severity: "medium",
    rationale: "bundlers resolve this entry point; divergence swaps the code they pull in",
  },
  {
    field: "browser",
    kind: "deep",
    severity: "medium",
    rationale: "browser field remaps modules wholesale for front-end builds",
  },
  {
    field: "types",
    kind: "scalar",
    severity: "medium",
    rationale: "mismatched typings mask API differences between the reviewed and installed artifact",
  },
  {
    field: "exports",
    kind: "deep",
    severity: "medium",
    rationale: "the exports map is the real module surface on modern Node; divergence rewires imports",
  },
  {
    field: "type",
    kind: "scalar",
    severity: "medium",
    rationale: "module vs commonjs changes how every file in the package is interpreted",
  },
  {
    field: "engines",
    kind: "deep",
    severity: "medium",
    rationale: "install-time engine gating follows one document, runtime behavior the other",
  },
  {
    field: "os",
    kind: "list",
    severity: "medium",
    rationale: "platform gating that differs between documents targets machines the registry says are excluded",
  },
  {
    field: "cpu",
    kind: "list",
    severity: "medium",
    rationale: "same as os: divergent architecture gating is targeting, not housekeeping",
  },
  {
    field: "overrides",
    kind: "deep",
    severity: "medium",
    rationale: "overrides rewrite the dependency tree when the package is the workspace root",
  },
  {
    field: "license",
    kind: "deep",
    severity: "medium",
    rationale: "compliance tooling reads the registry; the tarball is what you actually redistribute",
  },
  {
    field: "devDependencies",
    kind: "record",
    severity: "low",
    rationale: "never installed by consumers, but divergence still means the documents were built apart",
  },
  {
    field: "description",
    kind: "scalar",
    severity: "info",
    rationale: "cosmetic, yet honest packages have no reason for the two copies to differ",
  },
  {
    field: "keywords",
    kind: "list",
    severity: "info",
    rationale: "cosmetic search metadata; divergence is a smell, not a threat",
  },
  {
    field: "homepage",
    kind: "scalar",
    severity: "info",
    rationale: "a registry page linking somewhere the tarball does not claim is worth a glance",
  },
  {
    field: "repository",
    kind: "deep",
    severity: "info",
    rationale: "provenance tools resolve the repo from the registry copy",
  },
  {
    field: "author",
    kind: "deep",
    severity: "info",
    rationale: "authorship strings are unverified either way; divergence is only a smell",
  },
  {
    field: "funding",
    kind: "deep",
    severity: "info",
    rationale: "cosmetic; `npm fund` reads the installed copy, the web page shows the registry's",
  },
  {
    field: "files",
    kind: "list",
    severity: "info",
    rationale: "already applied at pack time — informational, but honest publishes match",
  },
  {
    field: "sideEffects",
    kind: "deep",
    severity: "info",
    rationale: "bundler hint read from the installed copy only",
  },
  {
    field: "packageManager",
    kind: "scalar",
    severity: "info",
    rationale: "corepack pin; only meaningful when developing the package itself",
  },
];

/** Fields with dedicated comparison logic (never generic-diffed). */
export const SPECIAL_FIELDS = new Set([
  ...FIELD_POLICIES.map((p) => p.field),
  "bundleDependencies", // folded into bundledDependencies
  "typings", // folded into types
]);

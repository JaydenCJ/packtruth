/**
 * The comparison engine: given the publisher-authored view of the
 * registry manifest and the package.json from inside the tarball,
 * produce one finding per divergent field. Pure — no I/O, no ordering
 * dependence on input key order.
 */

import { FIELD_POLICIES, SPECIAL_FIELDS, scriptSeverity, INSTALL_LIFECYCLE, type FieldPolicy } from "./fields.js";
import {
  asRecord,
  asSortedList,
  deepEqual,
  normalizeBin,
  normalizeBundled,
  stableStringify,
} from "./normalize.js";
import { SEVERITIES, type Finding, type ManifestObject, type Severity } from "./types.js";

export interface CompareOptions {
  /** Top-level field names to skip entirely (CLI `--ignore`). */
  ignore?: string[];
}

/** Both-sides-missing is not a divergence; JSON null counts as missing. */
function present(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function finding(
  field: string,
  severity: Severity,
  registry: unknown,
  tarball: unknown,
  detail: string,
): Finding {
  const kind = !present(registry) ? "tarball-only" : !present(tarball) ? "registry-only" : "mismatch";
  const out: Finding = { field, kind, severity, detail };
  if (present(registry)) out.registry = registry;
  if (present(tarball)) out.tarball = tarball;
  return out;
}

/** Diff two string→string records key by key. */
function diffRecord(
  field: string,
  severity: Severity,
  registry: Record<string, string> | undefined,
  tarball: Record<string, string> | undefined,
  labels: { hidden: string; phantom: string; changed: string },
): Finding[] {
  const out: Finding[] = [];
  const keys = [...new Set([...Object.keys(registry ?? {}), ...Object.keys(tarball ?? {})])].sort();
  for (const key of keys) {
    const r = registry?.[key];
    const t = tarball?.[key];
    if (r === t) continue;
    const path = `${field}.${key}`;
    if (r === undefined) out.push(finding(path, severity, undefined, t, labels.hidden));
    else if (t === undefined) out.push(finding(path, severity, r, undefined, labels.phantom));
    else out.push(finding(path, severity, r, t, labels.changed));
  }
  return out;
}

/** Scripts get per-key severities and lifecycle-aware wording. */
function diffScripts(registry: unknown, tarball: unknown): Finding[] {
  const r = asRecord(registry) ?? {};
  const t = asRecord(tarball) ?? {};
  const out: Finding[] = [];
  const keys = [...new Set([...Object.keys(r), ...Object.keys(t)])].sort();
  for (const key of keys) {
    if (r[key] === t[key]) continue;
    const severity = scriptSeverity(key);
    const lifecycle = severity !== "low";
    const path = `scripts.${key}`;
    if (r[key] === undefined) {
      out.push(
        finding(
          path,
          severity,
          undefined,
          t[key],
          lifecycle
            ? "install-time script exists only in the tarball — npm will run it, registry readers never see it"
            : "script exists only in the tarball",
        ),
      );
    } else if (t[key] === undefined) {
      out.push(
        finding(
          path,
          severity,
          r[key],
          undefined,
          lifecycle
            ? "registry advertises an install-time script the tarball does not contain"
            : "script exists only in the registry manifest",
        ),
      );
    } else {
      out.push(
        finding(
          path,
          severity,
          r[key],
          t[key],
          lifecycle
            ? "install-time script differs — the tarball's version is the one npm executes"
            : "script body differs between the two documents",
        ),
      );
    }
  }
  return out;
}

/** Dispatch one policy row. */
function compareField(
  policy: FieldPolicy,
  registry: ManifestObject,
  tarball: ManifestObject,
): Finding[] {
  const field = policy.field;
  let r: unknown = registry[field];
  let t: unknown = tarball[field];

  switch (policy.kind) {
    case "scripts":
      return diffScripts(r, t);
    case "bin": {
      const rBin = normalizeBin(r, registry["name"]);
      const tBin = normalizeBin(t, tarball["name"]);
      return diffRecord(field, policy.severity, rBin, tBin, {
        hidden: "executable is installed on PATH but absent from the registry manifest",
        phantom: "registry advertises an executable the tarball does not install",
        changed: "the same command name points at different files",
      });
    }
    case "record":
      return diffRecord(field, policy.severity, asRecord(r), asRecord(t), {
        hidden: `hidden entry: only the tarball declares it under ${field}`,
        phantom: `phantom entry: the registry manifest declares it, the tarball does not`,
        changed: "declared range differs between registry manifest and tarball",
      });
    case "list": {
      if (field === "bundledDependencies") {
        r = normalizeBundled(registry);
        t = normalizeBundled(tarball);
      } else {
        r = asSortedList(r) ?? r;
        t = asSortedList(t) ?? t;
      }
      break;
    }
    case "scalar":
      if (field === "types") {
        r = r ?? registry["typings"];
        t = t ?? tarball["typings"];
      }
      break;
    case "deep":
      break;
  }

  if (!present(r) && !present(t)) return [];
  if (deepEqual(r, t)) return [];
  return [finding(field, policy.severity, r, t, policy.rationale)];
}

/**
 * Any remaining top-level keys (rc-file blobs, custom metadata, …) get a
 * generic structural diff at `info` severity, so the report really does
 * list *every* divergent field without drowning the ranked ones.
 */
function diffGenericFields(registry: ManifestObject, tarball: ManifestObject): Finding[] {
  const out: Finding[] = [];
  const keys = [...new Set([...Object.keys(registry), ...Object.keys(tarball)])]
    .filter((k) => !SPECIAL_FIELDS.has(k))
    .sort();
  for (const key of keys) {
    const r = registry[key];
    const t = tarball[key];
    if (!present(r) && !present(t)) continue;
    if (deepEqual(r, t)) continue;
    out.push(finding(key, "info", r, t, "uncategorized field differs between the two documents"));
  }
  return out;
}

/**
 * Compare the registry's `hasInstallScript` claim against the tarball's
 * actual lifecycle scripts. npm shows install warnings and lets tooling
 * gate on this flag — a tarball with install scripts behind a false (or
 * absent-but-computed) flag is the textbook manifest-confusion payload.
 */
export function checkHasInstallScript(
  rawRegistryManifest: ManifestObject,
  tarball: ManifestObject,
): Finding[] {
  const flag = rawRegistryManifest["hasInstallScript"];
  if (flag !== true && flag !== false) return []; // registry never asserted it
  const scripts = asRecord(tarball["scripts"]) ?? {};
  const actual = (INSTALL_LIFECYCLE as readonly string[]).filter((k) => scripts[k] !== undefined);
  if (flag === false && actual.length > 0) {
    return [
      {
        field: "hasInstallScript",
        kind: "mismatch",
        severity: "critical",
        registry: false,
        tarball: actual,
        detail: "registry claims no install scripts, but the tarball defines " + actual.join(", "),
      },
    ];
  }
  if (flag === true && actual.length === 0) {
    return [
      {
        field: "hasInstallScript",
        kind: "mismatch",
        severity: "medium",
        registry: true,
        tarball: [],
        detail: "registry claims an install script the tarball does not define",
      },
    ];
  }
  return [];
}

/** Stable ordering: severity first, then field path. */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const s = SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity);
    if (s !== 0) return s;
    return a.field < b.field ? -1 : a.field > b.field ? 1 : 0;
  });
}

/**
 * Compare the publisher-authored registry view against the tarball's
 * package.json. Returns findings sorted by severity, then field.
 */
export function compareManifests(
  registry: ManifestObject,
  tarball: ManifestObject,
  options: CompareOptions = {},
): Finding[] {
  const ignore = new Set(options.ignore ?? []);
  const findings: Finding[] = [];
  for (const policy of FIELD_POLICIES) {
    if (ignore.has(policy.field)) continue;
    findings.push(...compareField(policy, registry, tarball));
  }
  findings.push(
    ...diffGenericFields(registry, tarball).filter((f) => !ignore.has(f.field)),
  );
  // Sanity: never emit a finding whose two sides render identically.
  return sortFindings(findings.filter((f) => stableStringify(f.registry) !== stableStringify(f.tarball)));
}

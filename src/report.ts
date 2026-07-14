/**
 * Report rendering: an aligned, greppable text table for humans and a
 * stable JSON envelope for machines. Output is deterministic — same
 * report in, byte-identical text out.
 */

import { renderValue } from "./normalize.js";
import { FIELD_POLICIES } from "./fields.js";
import type { Report, Severity } from "./types.js";

const KIND_LABEL: Record<string, string> = {
  mismatch: "differs",
  "tarball-only": "only in tarball",
  "registry-only": "only in registry",
  integrity: "bytes mismatch",
  "missing-version": "not in registry",
};

/** Pad to width (findings tables are aligned by the widest cell). */
function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function formatRow(cells: string[], widths: number[]): string {
  return cells
    .map((cell, i) => (i === cells.length - 1 ? cell : pad(cell, widths[i] as number)))
    .join("  ")
    .trimEnd();
}

/** One-line integrity status for the header. */
function integrityLine(report: Report): string {
  if (report.integrity === null) return "integrity: not verified (no digest in registry document)";
  const algos = report.integrity.checked.join(", ");
  return report.integrity.ok ? `integrity: ${algos} ok` : `integrity: ${algos} MISMATCH`;
}

function summaryLine(report: Report): string {
  const s = report.summary;
  if (s.total === 0) {
    return "0 divergences — verdict: CLEAN (registry manifest matches the tarball)";
  }
  const parts = (["critical", "high", "medium", "low", "info"] as Severity[])
    .filter((sev) => s[sev] > 0)
    .map((sev) => `${s[sev]} ${sev}`);
  const noun = s.total === 1 ? "divergence" : "divergences";
  return `${s.total} ${noun} (${parts.join(", ")}) — verdict: DIVERGENT`;
}

/** Human-readable report. */
export function renderText(report: Report): string {
  const lines: string[] = [];
  lines.push(
    `packtruth check: ${report.source.tarball} vs ${report.source.manifest} (${report.package.name}@${report.package.version})`,
  );
  lines.push(integrityLine(report));
  lines.push("");

  if (report.findings.length > 0) {
    const header = ["SEVERITY", "FIELD", "DIVERGENCE", "REGISTRY", "TARBALL"];
    const rows = report.findings.map((f) => [
      f.severity,
      f.field,
      KIND_LABEL[f.kind] ?? f.kind,
      renderValue(f.registry, 34),
      renderValue(f.tarball, 34),
    ]);
    const widths = header.map((cell, i) => Math.max(cell.length, ...rows.map((r) => (r[i] as string).length)));
    lines.push(formatRow(header, widths));
    for (const row of rows) lines.push(formatRow(row, widths));
    lines.push("");
    for (const f of report.findings.filter((x) => x.severity === "critical" || x.severity === "high")) {
      lines.push(`! ${f.field}: ${f.detail}`);
    }
    if (report.findings.some((x) => x.severity === "critical" || x.severity === "high")) lines.push("");
  }

  lines.push(summaryLine(report));
  return lines.join("\n") + "\n";
}

/** Machine-readable report (`--format json`). */
export function renderJson(report: Report): string {
  return JSON.stringify(report, null, 2) + "\n";
}

/** The `packtruth fields` reference table. */
export function renderFields(json: boolean): string {
  if (json) {
    return (
      JSON.stringify(
        FIELD_POLICIES.map((p) => ({ field: p.field, severity: p.severity, compare: p.kind, why: p.rationale })),
        null,
        2,
      ) + "\n"
    );
  }
  const header = ["FIELD", "SEVERITY", "COMPARE", "WHY IT MATTERS"];
  const rows = FIELD_POLICIES.map((p) => [p.field, p.severity, p.kind, p.rationale]);
  const widths = header.map((cell, i) => Math.max(cell.length, ...rows.map((r) => (r[i] as string).length)));
  const lines = [formatRow(header, widths)];
  for (const row of rows) lines.push(formatRow(row, widths));
  lines.push("");
  lines.push("scripts severity is per key: preinstall/install/postinstall are critical;");
  lines.push("prepare (with its pre/post hooks) and prepublish are high; everything else");
  lines.push("is low. hasInstallScript and dist integrity get dedicated checks;");
  lines.push("uncategorized fields diff at info.");
  return lines.join("\n") + "\n";
}

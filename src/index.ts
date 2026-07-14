/**
 * Public programmatic API. Everything the CLI can do is reachable from
 * here without spawning a process:
 *
 *   import { runCheck } from "packtruth";
 *   const report = runCheck(registryDoc, tarballBytes);
 *   if (report.verdict === "divergent") …
 */

export { runCheck, summarize, failsAt, type CheckOptions } from "./check.js";
export { compareManifests, checkHasInstallScript, sortFindings, type CompareOptions } from "./compare.js";
export { checkIntegrity, parseSri } from "./integrity.js";
export {
  loadRegistryManifest,
  stripRegistryKeys,
  isPackument,
  ManifestError,
  VersionNotFoundError,
  REGISTRY_MANAGED_KEYS,
  type LoadedManifest,
} from "./manifest.js";
export { readTarball, extractManifestText, hashTarball, TarballError, type TarballInfo } from "./tarball.js";
export { listTarEntries, parsePaxRecords, TarError, type TarEntry } from "./tar.js";
export { FIELD_POLICIES, scriptSeverity, INSTALL_LIFECYCLE, type FieldPolicy } from "./fields.js";
export { renderText, renderJson, renderFields } from "./report.js";
export {
  SEVERITIES,
  atLeast,
  type Severity,
  type Finding,
  type FindingKind,
  type IntegrityResult,
  type ManifestObject,
  type Report,
  type Summary,
} from "./types.js";
export { VERSION } from "./version.js";

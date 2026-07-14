# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-13

### Added

- `packtruth check`: cross-checks a registry version manifest (or a
  full packument, with automatic or `--registry-version` selection)
  against the `package.json` inside the package tarball, reporting one
  finding per divergent field with severity, direction (`only in
  tarball` / `only in registry` / `differs`) and both observed values.
- Severity policy tuned to npm's actual split of responsibilities:
  hidden `preinstall`/`install`/`postinstall` scripts, name/version
  lies and wrong artifact bytes are critical; hidden dependencies,
  bins and `prepare` scripts are high; entry points, engine/platform
  gating and license are medium; cosmetics are info. Every
  uncategorized field still gets a generic structural diff.
- Dedicated `hasInstallScript` check: the registry's flag is tested
  against the install scripts the tarball actually defines.
- Integrity verification of `dist.integrity` (SRI sha512/sha256/sha1)
  and legacy `dist.shasum` over the exact tarball bytes.
- A dependency-free tar reader (POSIX ustar + pax extended headers +
  GNU long names + base-256 sizes) with header-checksum validation,
  and gzip handling via node:zlib — corrupt input fails loudly.
- Normalization so formatting never counts as divergence: string vs
  object `bin`, `bundleDependencies` vs `bundledDependencies`,
  `typings` vs `types`, key order, list order for `os`/`cpu`/
  `keywords`/`files`, leading `./` in bin paths.
- `packtruth extract` (print the tarball's embedded package.json,
  verbatim or `--pretty`) and `packtruth fields` (the live policy
  table, text or `--json`).
- Script-friendly CLI: stdin manifests, `--format json` with a stable
  `schemaVersion: 1` envelope, `--fail-on <severity|never>` exit
  gating, repeatable `--ignore`, `--no-integrity`, `--quiet`, and
  shared exit codes (0 clean / 1 divergent / 2 usage or input error).
- Public programmatic API (`runCheck`, `compareManifests`,
  `readTarball`, `checkIntegrity`, `loadRegistryManifest`, …) with
  type declarations.
- Offline demo generator (`examples/make-demo.mjs`) fabricating honest
  and manifest-confused package pairs, a field-policy reference
  (`docs/fields.md`), 90 deterministic node:test tests and an
  end-to-end `scripts/smoke.sh`.

[0.1.0]: https://github.com/JaydenCJ/packtruth/releases/tag/v0.1.0

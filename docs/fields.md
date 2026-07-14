# Checked fields and severity rationale

packtruth compares the **publisher-authored view** of the registry
version manifest (registry-managed keys like `_id`, `_npmVersion`,
`maintainers`, `gitHead`, `dist` are removed first — they never existed
in the tarball, so they cannot "diverge" from it) against the
`package.json` npm actually unpacks and honors at install time.

The live version of this table is `packtruth fields` (add `--json` for
machines); this document explains the reasoning in more depth.

## Why the tarball side wins

When the two documents disagree, npm's behavior is split:

- **Executed from the tarball:** lifecycle scripts, `bin` linking,
  `main`/`exports` resolution, the `files` already applied at pack time.
- **Read from the registry manifest:** dependency-tree resolution,
  `npm audit`, the website, `hasInstallScript` install warnings, and
  virtually every third-party scanner.

That split is the vulnerability: an attacker publishes a tarball whose
embedded manifest differs from the metadata the registry serves, and
every tool that reads only one side sees a package that does not exist.
npm's own position (2023) is that the registry does not validate the
two against each other. packtruth's position is: **any divergence at
all is a defect worth knowing about**, ranked by how much damage that
particular field can do.

## Severity ladder

| Severity | Fields | Reasoning |
|---|---|---|
| critical | `name`, `version`, `scripts.preinstall/install/postinstall`, `hasInstallScript`, `dist.integrity`, `dist.shasum` | identity lies, code execution at install time, or wrong artifact bytes |
| high | `dependencies`, `optionalDependencies`, `peerDependencies`, `bundledDependencies`, `bin`, `scripts.prepare/prepublish` | hidden install surface: extra packages pulled in, executables on PATH, scripts run for git deps |
| medium | `main`, `module`, `browser`, `types`, `exports`, `type`, `engines`, `os`, `cpu`, `overrides`, `license` | changes what code loads or gates where it installs; legal misrepresentation |
| low | `devDependencies`, non-lifecycle `scripts`, unverifiable `dist.integrity` strings | not consumer-facing, but proof the documents were built separately |
| info | `description`, `keywords`, `homepage`, `repository`, `author`, `funding`, `files`, `sideEffects`, `packageManager`, plus every uncategorized field | cosmetic; honest publishes still have no reason to differ |

## Comparison semantics

- **Presence:** a field missing on both sides is not compared; JSON
  `null` counts as absent (matching npm's tolerance).
- **Maps** (`dependencies`, `scripts`, `bin`): diffed key by key, one
  finding per divergent entry, each labelled `only in tarball`
  (hidden), `only in registry` (phantom), or `differs`.
- **Spelling normalization:** `bin: "cli.js"` equals
  `bin: { "<unscoped name>": "cli.js" }`; leading `./` in bin paths is
  insignificant; `bundleDependencies` folds into `bundledDependencies`;
  `typings` folds into `types`; `os`/`cpu`/`keywords`/`files` compare
  order-insensitively; objects compare with sorted keys at every depth.
- **`scripts` severity is per key:** `preinstall`/`install`/
  `postinstall` are critical (npm runs them on every dependency
  install); `prepare` (plus `preprepare`/`postprepare`) and
  `prepublish` are high (run for git dependencies and on publish);
  everything else is low.
- **`hasInstallScript`** is registry-managed, so it is excluded from
  the generic field diff and gets a dedicated check: the flag's claim
  is tested against the install scripts the tarball actually defines.
- **`dist` digests:** `integrity` (SRI, sha512/sha256/sha1) and legacy
  `shasum` are recomputed over the exact tarball bytes. A mismatch
  means you are not even holding the artifact the registry serves —
  reported as critical and the field comparison still runs, so you see
  the full picture.
- **Everything else:** any remaining top-level key (`eslintConfig`,
  custom metadata, …) is structurally diffed at `info`, so the report
  genuinely lists *every* divergent field.

## Registry-managed keys (never compared)

`_id`, `_rev`, `_from`, `_shasum`, `_resolved`, `_integrity`,
`_nodeVersion`, `_npmVersion`, `_npmUser`, `_npmOperationalInternal`,
`_hasShrinkwrap`, `_engineSupported`, `_defaultsLoaded`, `dist`,
`maintainers`, `readme`, `readmeFilename`, `gitHead`, `users`,
`deprecated`, `hasInstallScript`.

`deprecated` is legitimately registry-only (set by `npm deprecate`, not
by publishing), so it is ignored rather than reported.

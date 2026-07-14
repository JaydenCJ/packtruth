# Contributing to packtruth

Issues, discussions and pull requests are all welcome.

## Getting started

You need Node.js ≥22.13; nothing else (the only devDependency is `typescript`).

```bash
git clone https://github.com/JaydenCJ/packtruth && cd packtruth
npm install
npm run build
npm test
bash scripts/smoke.sh
```

`scripts/smoke.sh` builds the CLI, fabricates honest and
manifest-confused package pairs with `examples/make-demo.mjs`, and
asserts on real end-to-end output and exit codes; it must finish by
printing `SMOKE OK`.

## Before you open a pull request

1. `npx tsc -p tsconfig.json --noEmit` compiles with zero errors
   (strict mode is enforced).
2. `npm test` passes (90 deterministic node:test tests, no network).
3. `bash scripts/smoke.sh` prints `SMOKE OK`.
4. Add tests for behavior changes; keep logic in pure, unit-testable
   modules (only `cli.ts` touches the filesystem or process globals).
5. Severity changes are policy changes: update `src/fields.ts`,
   `docs/fields.md` and the README table together, with a test pinning
   the new mapping.

## Ground rules

- Keep runtime dependencies at zero; adding one needs strong
  justification in the PR. `typescript` stays the only devDependency —
  even Node type stubs live in `src/node.d.ts`.
- No network calls, ever. packtruth reads the files it is given and
  nothing else; obtaining artifacts is the caller's job. No telemetry.
- Determinism first: identical inputs must produce byte-identical
  reports, including all orderings.
- Fail loudly: corrupt tarballs, malformed manifests and unknown flags
  are hard errors (exit 2), never guesses.
- Code comments and doc comments are written in English.

## Reporting bugs

Include the output of `packtruth --version`, the full command you ran,
and — if at all possible — the tarball and registry document that
reproduce the problem (or a `make-demo.mjs`-style fabrication of them,
since real confused packages tend to get unpublished quickly).

## Security

Please do not open public issues for security problems; use GitHub's
private vulnerability reporting on this repository instead.

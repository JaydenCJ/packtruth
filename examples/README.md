# packtruth examples

`make-demo.mjs` fabricates a deterministic, fully offline demo data set
under `examples/demo/` (git-ignored, safe to delete and regenerate). All
commands below run from the repository root after
`npm install && npm run build`; replace `node dist/cli.js` with
`packtruth` if you installed the package globally.

```bash
node examples/make-demo.mjs
```

## What gets generated

- `demo/honest/` — a tarball and a registry version manifest that agree
  on every field. `check` exits 0.
- `demo/confused/` — a manifest-confusion attack against a fake package
  called `tiny-datefmt`: the registry manifest advertises zero
  dependencies, one bin and no install scripts (`hasInstallScript:
  false`), while the package.json inside the tarball hides a
  `postinstall` script, an extra dependency and a second executable.
  Crucially, `dist.integrity` and `dist.shasum` are **correct** in both
  demos — integrity checking alone cannot see this attack, because the
  registry hashes whatever tarball it was given.

## Try it

```bash
# The attack: exit 1, two critical + two high findings
node dist/cli.js check examples/demo/confused/tiny-datefmt-2.4.1.tgz \
  --manifest examples/demo/confused/registry-manifest.json

# The honest publish: exit 0, verdict CLEAN
node dist/cli.js check examples/demo/honest/tiny-datefmt-2.4.1.tgz \
  --manifest examples/demo/honest/registry-manifest.json

# Look at what the tarball really says
node dist/cli.js extract examples/demo/confused/tiny-datefmt-2.4.1.tgz --pretty

# Machine-readable, for pipelines
node dist/cli.js check examples/demo/confused/tiny-datefmt-2.4.1.tgz \
  --manifest examples/demo/confused/registry-manifest.json --format json
```

## Against a real package

packtruth never talks to a registry itself — feed it artifacts you
fetched with your own tooling:

```bash
npm pack some-package@1.2.3                          # writes some-package-1.2.3.tgz
npm view some-package@1.2.3 --json > manifest.json   # registry version manifest
packtruth check some-package-1.2.3.tgz --manifest manifest.json
```

A saved packument (the whole-package JSON document) works as `--manifest`
too; packtruth picks the version matching the tarball, or the one you
name with `--registry-version`.

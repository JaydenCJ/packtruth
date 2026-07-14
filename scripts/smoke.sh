#!/usr/bin/env bash
# Smoke test for packtruth: builds the CLI, fabricates honest and
# manifest-confused package pairs with the bundled demo generator, and
# asserts on real end-to-end output and exit codes. No network,
# idempotent, runs from a clean checkout (after `npm install`). Prints
# "SMOKE OK" on success.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

# 1. Build (idempotent).
npm run build >/dev/null 2>&1 || fail "npm run build failed"
CLI="node $ROOT/dist/cli.js"
echo "[smoke] build ok"

# 2. --version matches package.json; --help documents every command.
PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
CLI_VERSION="$($CLI --version)"
[ "$CLI_VERSION" = "$PKG_VERSION" ] || fail "--version mismatch: $CLI_VERSION != $PKG_VERSION"
HELP="$($CLI --help)"
for word in check extract fields --manifest --fail-on --ignore --registry-version; do
  echo "$HELP" | grep -q -- "$word" || fail "--help missing $word"
done
echo "[smoke] --help/--version ok ($CLI_VERSION)"

# 3. Generate the deterministic demo data set.
node examples/make-demo.mjs >/dev/null || fail "make-demo.mjs failed"
HONEST_TGZ=examples/demo/honest/tiny-datefmt-2.4.1.tgz
HONEST_MAN=examples/demo/honest/registry-manifest.json
EVIL_TGZ=examples/demo/confused/tiny-datefmt-2.4.1.tgz
EVIL_MAN=examples/demo/confused/registry-manifest.json
[ -f "$EVIL_TGZ" ] && [ -f "$EVIL_MAN" ] || fail "demo files missing"
echo "[smoke] demo data generated"

# 4. The honest pair is CLEAN, exit 0, integrity verified.
OUT="$($CLI check "$HONEST_TGZ" --manifest "$HONEST_MAN")" || fail "honest check should exit 0"
echo "$OUT" | grep -q "verdict: CLEAN" || fail "honest verdict not CLEAN"
echo "$OUT" | grep -q "integrity: sha512, shasum(sha1) ok" || fail "integrity line missing"
echo "[smoke] honest pair ok (exit 0, CLEAN)"

# 5. The confused pair diverges: exit 1, hidden script/dep/bin all found.
set +e
OUT="$($CLI check "$EVIL_TGZ" --manifest "$EVIL_MAN")"; STATUS=$?
set -e
[ "$STATUS" -eq 1 ] || fail "confused check should exit 1, got $STATUS"
for marker in "scripts.postinstall" "dependencies.hoist-env" "bin.node-gyp-helper" "hasInstallScript" "verdict: DIVERGENT"; do
  echo "$OUT" | grep -q "$marker" || fail "confused report missing $marker"
done
echo "$OUT" | grep -q "2 critical" || fail "expected 2 critical findings"
echo "[smoke] confused pair ok (exit 1, hidden script/dep/bin reported)"

# 6. JSON report is machine-readable and structurally sound.
set +e
$CLI check "$EVIL_TGZ" --manifest "$EVIL_MAN" --format json > "$WORKDIR/report.json"
set -e
node -e "
  const r = JSON.parse(require('fs').readFileSync('$WORKDIR/report.json', 'utf8'));
  if (r.tool !== 'packtruth') throw new Error('bad envelope');
  if (r.verdict !== 'divergent') throw new Error('bad verdict');
  if (r.summary.total !== r.findings.length) throw new Error('summary/findings disagree');
  if (!r.findings.some((f) => f.field === 'scripts.postinstall' && f.severity === 'critical'))
    throw new Error('missing critical postinstall finding');
" || fail "JSON report failed validation"
echo "[smoke] json report ok"

# 7. --fail-on gates the exit code; --ignore silences fields.
$CLI check "$EVIL_TGZ" --manifest "$EVIL_MAN" --fail-on never -q || fail "--fail-on never should exit 0"
$CLI check "$EVIL_TGZ" --manifest "$EVIL_MAN" -q \
  --ignore hasInstallScript --ignore scripts --ignore dependencies --ignore bin \
  || fail "ignoring every divergent field should exit 0"
echo "[smoke] --fail-on / --ignore ok"

# 8. Tampered bytes: a registry manifest pointing at different bytes fails integrity.
node -e "
  const fs = require('fs');
  const m = JSON.parse(fs.readFileSync('$HONEST_MAN', 'utf8'));
  m.dist.shasum = '0000000000000000000000000000000000000000';
  m.dist.integrity = 'sha512-' + Buffer.alloc(64).toString('base64');
  fs.writeFileSync('$WORKDIR/tampered.json', JSON.stringify(m));
"
set +e
OUT="$($CLI check "$HONEST_TGZ" --manifest "$WORKDIR/tampered.json")"; STATUS=$?
set -e
[ "$STATUS" -eq 1 ] || fail "tampered dist should exit 1"
echo "$OUT" | grep -q "MISMATCH" || fail "integrity mismatch not reported"
echo "[smoke] integrity tamper detection ok"

# 9. The manifest can arrive on stdin; extract shows the tarball's truth.
$CLI check "$HONEST_TGZ" --manifest - < "$HONEST_MAN" >/dev/null || fail "stdin manifest failed"
$CLI extract "$EVIL_TGZ" --pretty | grep -q '"postinstall": "node lib/telemetry.js"' \
  || fail "extract did not reveal the hidden postinstall"
echo "[smoke] stdin manifest + extract ok"

# 10. Usage errors exit 2.
set +e
$CLI check "$HONEST_TGZ" >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "missing --manifest should exit 2"; }
$CLI check "$HONEST_TGZ" --manifest "$HONEST_MAN" --format yaml >/dev/null 2>&1
[ $? -eq 2 ] || { set -e; fail "bad --format should exit 2"; }
set -e
echo "[smoke] usage errors ok (exit 2)"

echo "SMOKE OK"

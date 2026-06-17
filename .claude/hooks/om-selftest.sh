#!/usr/bin/env bash
# om-selftest — Stop hook. Gates "done" on green tests for the memory-extraction
# monorepo (core + app), scoped to what actually changed.
#
#   core/ changed (any file)              -> core typecheck + unit tests
#   core/src or app runtime/e2e changed   -> + Electron e2e (it pops a window)
#   only docs/config/deps/assets changed  -> nothing to gate, exit 0 fast
#
#   OM_SELFTEST_E2E=0 skips the e2e. exit 2 = block + feed failure back to the
#   model; capped at 3 attempts so an unfixable failure never traps the session.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
ME="$ROOT/memory-extraction"
COUNT_FILE="/tmp/om-selftest-count"

cd "$ROOT" 2>/dev/null || exit 0

changed="$( { git diff --name-only -- memory-extraction 2>/dev/null; \
              git diff --cached --name-only -- memory-extraction 2>/dev/null; } | sort -u )"
if [ -z "$changed" ]; then
  rm -f "$COUNT_FILE"
  exit 0
fi

# core/ change → run the (fast) core gate.
core_changed=0
printf '%s\n' "$changed" | grep -qE '^memory-extraction/core/' && core_changed=1

# Only runtime code (core/src, app *.js/*.html/*.css, or the e2e itself) reruns
# the heavy Electron e2e — not package.json, README, smoke.mjs, configs, or assets.
e2e_relevant=0
printf '%s\n' "$changed" | grep -qE '^memory-extraction/core/src/|^memory-extraction/app/.*\.(js|html|css)$|^memory-extraction/app/e2e/' && e2e_relevant=1

if [ "$core_changed" = 0 ] && [ "$e2e_relevant" = 0 ]; then
  rm -f "$COUNT_FILE"
  exit 0
fi

fail=0
core_out=""
e2e_out=""

if [ "$core_changed" = 1 ]; then
  if ! core_out="$(cd "$ME/core" && npm run -s typecheck 2>&1 && npm test 2>&1)"; then
    fail=1
  fi
fi

if [ "${OM_SELFTEST_E2E:-1}" != "0" ] && [ "$e2e_relevant" = 1 ]; then
  if ! e2e_out="$(cd "$ME/app" && npm run -s e2e 2>&1)"; then
    fail=1
  fi
fi

if [ "$fail" = 0 ]; then
  rm -f "$COUNT_FILE"
  exit 0
fi

attempts=$(( $(cat "$COUNT_FILE" 2>/dev/null || echo 0) + 1 ))
echo "$attempts" > "$COUNT_FILE"

if [ "$attempts" -ge 3 ]; then
  rm -f "$COUNT_FILE"
  echo "om-selftest: still RED after ${attempts} attempts — not trapping the session, but tests are failing. Fix before trusting this." >&2
  exit 0
fi

{
  echo "om-selftest: tests are RED (attempt ${attempts}/3) — do not finish on red. Fix, then stop again."
  if [ -n "$core_out" ]; then echo "--- core typecheck + unit ---"; printf '%s\n' "$core_out" | tail -25; fi
  if [ -n "$e2e_out" ]; then echo "--- electron e2e ---"; printf '%s\n' "$e2e_out" | tail -15; fi
} >&2
exit 2

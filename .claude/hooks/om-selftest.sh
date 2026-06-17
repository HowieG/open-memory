#!/usr/bin/env bash
# om-selftest — Stop hook. Gates "done" on green tests whenever memory-extraction
# code has uncommitted changes. Blocks the turn from ending while tests are red.
#
#   - exits 0 fast when there's nothing relevant to gate (chat turns, docs, etc.)
#   - runs core typecheck + unit tests when core/ or app/ changed
#   - runs the Electron e2e when app/ changed (set OM_SELFTEST_E2E=0 to skip — it
#     pops a window). Default on.
#   - exit 2 = block + feed failure back to the model; capped at 3 attempts so an
#     unfixable failure never traps the session.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
ME="$ROOT/memory-extraction"
COUNT_FILE="/tmp/om-selftest-count"

cd "$ROOT" 2>/dev/null || exit 0

# Nothing to gate unless core/ or app/ has uncommitted (staged or unstaged) changes.
if git diff --quiet -- memory-extraction/core memory-extraction/app 2>/dev/null \
  && git diff --cached --quiet -- memory-extraction/core memory-extraction/app 2>/dev/null; then
  rm -f "$COUNT_FILE"
  exit 0
fi

app_changed() {
  ! { git diff --quiet -- memory-extraction/app 2>/dev/null \
    && git diff --cached --quiet -- memory-extraction/app 2>/dev/null; }
}

fail=0
core_out=""
e2e_out=""

if ! core_out="$(cd "$ME/core" && npm run -s typecheck 2>&1 && npm test 2>&1)"; then
  fail=1
fi

if [ "${OM_SELFTEST_E2E:-1}" != "0" ] && app_changed; then
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
  echo "--- core typecheck + unit ---"
  printf '%s\n' "$core_out" | tail -25
  if [ -n "$e2e_out" ]; then
    echo "--- electron e2e ---"
    printf '%s\n' "$e2e_out" | tail -15
  fi
} >&2
exit 2

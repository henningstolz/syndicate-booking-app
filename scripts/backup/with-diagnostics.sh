#!/usr/bin/env bash
# Self-test helper: runs a command, and if it fails, shows the end of its
# output as an annotation on the run (readable on the run's summary page and
# through GitHub's API). Only the self-test uses it: it has no real data.
set -uo pipefail
log="$(mktemp)"
"$@" >"$log" 2>&1
code=$?
cat "$log"
if [ "$code" -ne 0 ]; then
  msg="$(tail -n 25 "$log" | sed -e 's/%/%25/g' | awk '{printf "%s%%0A", $0}')"
  echo "::error title=$1 failed::${msg}"
fi
exit "$code"

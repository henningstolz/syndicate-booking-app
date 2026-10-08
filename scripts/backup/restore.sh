#!/usr/bin/env bash
# Puts a backup folder (made by backup.sh) into an EMPTY database, then proves
# the copy matches the original. Never run this against the live database.
#
#   restore.sh <empty-database-url> <folder> [--with-auth-schema]
#
# For a real Supabase project (a brand-new one): run it as is. For a plain test
# database that has no sign-in tables, add --with-auth-schema.
set -euo pipefail
url="$1"
in="$2"
flag="${3:-}"
here="$(cd "$(dirname "$0")" && pwd)"
psql_q() { psql "$url" --no-psqlrc --quiet -v ON_ERROR_STOP=1 "$@"; }

if [ -n "$(psql_q -At -c "select 1 from information_schema.tables where table_schema = 'public' limit 1")" ]; then
  echo "Refusing: the target database already has tables in 'public'. Restore into an empty project." >&2
  exit 1
fi

# The two add-ons the database design uses.
psql_q -c "create schema if not exists extensions;
           create extension if not exists btree_gist with schema extensions;
           create extension if not exists pgcrypto with schema extensions;"

if [ "$flag" = "--with-auth-schema" ]; then
  psql_q -f "$in/auth-schema.sql"
fi
# People first (the app's tables point at them), then the app's own data.
psql_q -f "$in/auth-data.sql"
# The 'public' schema already exists in every database, so leave out the step that creates it.
pg_restore --list "$in/public.dump" | grep -v -E ' SCHEMA - public ' > "$in/restore-list.txt"
pg_restore --no-owner --exit-on-error --use-list="$in/restore-list.txt" --dbname="$url" "$in/public.dump"

# Prove it: the restored copy must look exactly like the original.
"$here/fingerprint.sh" "$url" all > "$in/fingerprint-restored.txt"
structure_of() { grep -v -E '^(public|auth)\.' "$1"; }
counts_of() { grep -E '^(public|auth)\.' "$1"; }
ok=1
for side in before after; do
  if [ "$(structure_of "$in/fingerprint-$side.txt")" != "$(structure_of "$in/fingerprint-restored.txt")" ]; then
    echo "STRUCTURE DIFFERS from the original ($side), in:" >&2
    diff <(structure_of "$in/fingerprint-$side.txt") <(structure_of "$in/fingerprint-restored.txt") | grep -E '^[<>]' | awk '{print $2}' | sort -u >&2 || true
    ok=0
  fi
done
match=0
for side in before after; do
  if [ "$(counts_of "$in/fingerprint-$side.txt")" = "$(counts_of "$in/fingerprint-restored.txt")" ]; then match=1; fi
done
if [ "$match" = 0 ]; then
  echo "ROW COUNTS DIFFER from the original, in tables:" >&2
  diff <(counts_of "$in/fingerprint-before.txt") <(counts_of "$in/fingerprint-restored.txt") | grep -E '^[<>]' | awk '{print $2}' | sort -u >&2 || true
  ok=0
fi
if [ "$ok" = 1 ]; then
  echo "RESTORE VERIFIED: the copy has the same tables, rules, permissions and row counts as the original."
  # Row counts say a little about how much the group is used, so they are only printed when asked.
  if [ "${SHOW_COUNTS:-}" = 1 ]; then counts_of "$in/fingerprint-restored.txt"; fi
else
  exit 1
fi

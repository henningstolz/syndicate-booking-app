#!/usr/bin/env bash
# Takes a backup of the database into a folder:
#   public.dump       every table, function, security policy and permission in
#                     the app's schema, with all the data
#   auth-schema.sql   the shape of the sign-in tables (only used to check a backup)
#   auth-data.sql     the people who can sign in (emails and password hashes)
#   fingerprint.txt   row counts and a structure checksum, to prove a restore matches
#
#   backup.sh <database-url> <folder>
#
# It only READS the database. Needs pg_dump and psql (version 17 or newer).
set -euo pipefail
url="$1"
out="$2"
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$out"

# Counts before and after, so a row added while the dump runs cannot fail a check.
"$here/fingerprint.sh" "$url" all > "$out/fingerprint-before.txt"

pg_dump "$url" --schema=public --format=custom --no-owner --file="$out/public.dump"
pg_dump "$url" --schema-only --no-owner --no-privileges --table=auth.users --table=auth.identities --file="$out/auth-schema.sql"
pg_dump "$url" --data-only --column-inserts --no-owner --table=auth.users --table=auth.identities --file="$out/auth-data.sql"

"$here/fingerprint.sh" "$url" all > "$out/fingerprint-after.txt"
{
  echo "taken_at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "server $(psql "$url" --no-psqlrc -At -c 'show server_version')"
} > "$out/info.txt"
echo "backup written to $out:"
ls -l "$out"

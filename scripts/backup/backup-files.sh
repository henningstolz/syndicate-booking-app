#!/usr/bin/env bash
# Copies the stored files (the `documents` bucket) into the backup folder, and checks
# that the copy holds exactly what the database says is stored there (how many files,
# how many bytes). Nothing is printed that names a file or says how much a group stores.
#
#   backup-files.sh <database-url> <backup-folder>
#
# Needs the aws command line tool and these settings in the environment: the file
# store's S3 address and access key (Supabase, Project Settings, Storage, S3):
#   S3_ENDPOINT  AWS_ACCESS_KEY_ID  AWS_SECRET_ACCESS_KEY  AWS_DEFAULT_REGION
# It only READS the file store.
set -euo pipefail
url="$1"
out="$2/files"
mkdir -p "$out"

aws configure set default.s3.addressing_style path
aws s3 sync "s3://documents" "$out" --endpoint-url "$S3_ENDPOINT" --only-show-errors

want="$(psql "$url" --no-psqlrc -At -F ' ' -c "select count(*), coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects where bucket_id = 'documents'")"
have_count="$(find "$out" -type f | wc -l | tr -d ' ')"
have_bytes="$(find "$out" -type f -exec wc -c {} + | awk '$2 != "total" {s += $1} END {print s + 0}')"
if [ "$want" != "$have_count $have_bytes" ]; then
  # A file uploaded while the copy ran can make the two differ by a little; look again before failing.
  sleep 20
  aws s3 sync "s3://documents" "$out" --endpoint-url "$S3_ENDPOINT" --only-show-errors
  want="$(psql "$url" --no-psqlrc -At -F ' ' -c "select count(*), coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects where bucket_id = 'documents'")"
  have_count="$(find "$out" -type f | wc -l | tr -d ' ')"
  have_bytes="$(find "$out" -type f -exec wc -c {} + | awk '$2 != "total" {s += $1} END {print s + 0}')"
fi
if [ "$want" != "$have_count $have_bytes" ]; then
  echo "FILES DO NOT MATCH the database's list of stored files: the copy is incomplete." >&2
  exit 1
fi
echo "stored files copied and checked against the database."

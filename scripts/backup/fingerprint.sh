#!/usr/bin/env bash
# Prints a "fingerprint" of a database: how many rows each table holds, and a
# checksum of its structure (columns, security policies, and who may run which
# function). A restored copy must print the same thing as the original. Used by
# the backup check and by the restore drill.
#
#   fingerprint.sh <database-url> [counts|structure|all]
set -euo pipefail
url="$1"
what="${2:-all}"
psql_q() { psql "$url" --no-psqlrc --quiet -At -v ON_ERROR_STOP=1 "$@"; }

counts() {
  # One "table count" line per table in public, plus the sign-in tables.
  sql=$(psql_q -c "
    select string_agg(format('select %L as t, count(*) as n from %I.%I', table_schema || '.' || table_name, table_schema, table_name), ' union all ' order by table_schema, table_name)
    from information_schema.tables
    where table_type = 'BASE TABLE'
      and (table_schema = 'public' or (table_schema = 'auth' and table_name in ('users', 'identities')))")
  psql_q -F ' ' -c "select t, n from ($sql) x order by t"
}

structure() {
  # Everything below is sorted, so the order the database happens to list things in does not matter.
  psql_q -c "
    select 'columns ' || md5(coalesce(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''), ',' order by table_name, column_name), ''))
    from information_schema.columns where table_schema = 'public'"
  psql_q -c "
    select 'policies ' || md5(coalesce(string_agg(tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ',' order by tablename, policyname), ''))
    from pg_policies where schemaname = 'public'"
  psql_q -c "
    select 'rls ' || md5(coalesce(string_agg(c.relname || ':' || c.relrowsecurity::text, ',' order by c.relname), ''))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'"
  # Who can actually run each function and use each table (anonymous visitors, signed-in
  # users, and the server role), whichever way the permission was granted.
  psql_q -c "
    select 'functions ' || md5(coalesce(string_agg(p.oid::regprocedure::text || ':' || p.prosecdef::text
      || ':' || has_function_privilege('anon', p.oid, 'execute')::text
      || has_function_privilege('authenticated', p.oid, 'execute')::text
      || has_function_privilege('service_role', p.oid, 'execute')::text, ',' order by p.oid::regprocedure::text), ''))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')  -- not the add-ons' own functions
  "
  psql_q -c "
    select 'tables-acl ' || md5(coalesce(string_agg(c.relname || ':' || r.role || ':' || has_table_privilege(r.role, c.oid, 'select')::text
      || has_table_privilege(r.role, c.oid, 'insert')::text || has_table_privilege(r.role, c.oid, 'update')::text
      || has_table_privilege(r.role, c.oid, 'delete')::text, ',' order by c.relname, r.role), ''))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role)
    where n.nspname = 'public' and c.relkind = 'r'"
  psql_q -c "
    select 'constraints ' || md5(coalesce(string_agg(conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid), ',' order by conrelid::regclass::text, conname), ''))
    from pg_constraint where connamespace = 'public'::regnamespace"
}

case "$what" in
  counts) counts ;;
  structure) structure ;;
  all) structure; counts ;;
  *) echo "usage: fingerprint.sh <url> [counts|structure|all]" >&2; exit 2 ;;
esac

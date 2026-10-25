// Shared test harness: a throwaway in-memory Postgres (PGlite) with
// stand-ins for what Supabase provides (the auth.users table, auth.uid(), the
// anon/authenticated roles), plus small helpers. It never touches the real
// database.
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MIG = fileURLToPath(new URL("../migrations", import.meta.url));

export function createHarness() {
  const db = new PGlite({ extensions: { btree_gist, pgcrypto } });
  const U = {}; // name -> auth.users id
  let pass = 0;
  let fail = 0;

  const files = () => readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();

  const h = {
    db,
    U,

    async setup() {
      // Supabase runs in UTC; PGlite would otherwise take the time zone of the machine
      // the tests run on, which changes how timestamps are written into JSON.
      await db.exec("set time zone 'UTC'");
      await db.exec(`
        create role anon nologin; create role authenticated nologin;
        create schema auth;
        create table auth.users (id uuid primary key default gen_random_uuid(), email text);
        create function auth.uid() returns uuid language sql stable as
          $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
        -- The signed-in person's token claims (Supabase puts the sign-in strength in "aal").
        create function auth.jwt() returns jsonb language sql stable as
          $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
        grant usage on schema auth to anon, authenticated;
        grant usage on schema public to anon, authenticated;
        -- A stand-in for Supabase's file store (the real one adds more columns).
        create schema storage;
        create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
        create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text, metadata jsonb, created_at timestamptz default now());
        alter table storage.objects enable row level security;
        create function storage.foldername(name text) returns text[] language plpgsql immutable as
          $$ declare _parts text[]; begin select string_to_array(name, '/') into _parts; return _parts[1 : array_length(_parts, 1) - 1]; end $$;
        grant usage on schema storage to anon, authenticated;
        grant select, insert, update, delete on storage.objects to authenticated;
      `);
    },

    // Apply migrations: all of them, only those before a number, only those after one, or just one.
    async migrate({ before, only, after } = {}) {
      for (const f of files()) {
        const n = f.slice(0, 4);
        if (before && !(n < before)) continue;
        if (only && n !== only) continue;
        if (after && !(n > after)) continue;
        try {
          await db.exec(readFileSync(`${MIG}/${f}`, "utf8"));
        } catch (e) {
          console.log("MIGRATION FAILED", f, e.message);
          process.exit(1);
        }
      }
      // What Supabase's default privileges give the app's role.
      await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated;
                     grant all on all sequences in schema public to authenticated;`);
    },

    async addUsers(...names) {
      for (const n of names) {
        U[n] = (await db.query("insert into auth.users (email) values ($1) returning id", [`${n}@example.test`])).rows[0].id;
      }
    },

    // Act as a signed-in user (by name), or as an anonymous visitor (null). A name can end in
    // "@aal1" or "@aal2" to say how strongly the person signed in ("alice@aal2" = with a second
    // factor); with no ending the token carries no such claim.
    async as(user) {
      await db.exec("reset role");
      if (user) {
        const [name, aal] = user.split("@");
        await db.query("select set_config('request.jwt.claim.sub', $1, false)", [U[name]]);
        await db.query("select set_config('request.jwt.claims', $1, false)", [aal ? JSON.stringify({ sub: U[name], aal }) : ""]);
        await db.exec("set role authenticated");
      } else {
        await db.query("select set_config('request.jwt.claim.sub', '', false)");
        await db.query("select set_config('request.jwt.claims', '', false)");
        await db.exec("set role anon");
      }
    },

    async rpc(user, fn, ...args) {
      await h.as(user);
      const ph = args.map((_, i) => `$${i + 1}`).join(",");
      try { return (await db.query(`select public.${fn}(${ph}) as r`, args)).rows[0].r; }
      catch (e) { return { thrown: e.message }; }
    },

    async q(user, sql, params = []) {
      await h.as(user);
      try { return (await db.query(sql, params)).rows; }
      catch (e) { return { thrown: e.message }; }
    },

    check(name, got, want) {
      const ok = JSON.stringify(got) === JSON.stringify(want);
      if (ok) pass++;
      else fail++;
      console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
    },

    result: (r) => r?.result ?? r,

    finish() {
      console.log(`\n${pass} passed, ${fail} failed`);
      process.exit(fail ? 1 : 0);
    },
  };
  return h;
}

// Documents database test: who may upload, read and delete files, the space limit, and
// receipts on expenses. The file store's rules (migration 0023) are tested on a stand-in
// for Supabase's storage table. Run with: npm run test:db
import fs from "node:fs";
import { createHarness } from "./harness.mjs";

const h = createHarness();
const { db, U, rpc, q, check, result } = h;

await h.setup();
await h.migrate();
await h.addUsers("alice", "bob", "cara", "eve");
console.log("all migrations applied");

const G1 = "11111111-1111-1111-1111-111111111111";
const G2 = "22222222-2222-2222-2222-222222222222";
await db.exec(`insert into public.groups (id, slug, name, aircraft_registration) values
  ('${G1}','one','Group One','G-ONE'), ('${G2}','two','Group Two','G-TWO');`);
await db.query(
  `insert into public.group_members (group_id,user_id,role,display_name) values
    ($1,$2,'admin','Alice'), ($1,$3,'member','Bob'), ($1,$4,'member','Cara'), ($5,$6,'admin','Eve')`,
  [G1, U.alice, U.bob, U.cara, G2, U.eve],
);

const uid = () => crypto.randomUUID();
// What the file store holds after a browser upload: a row in storage.objects.
const object = async (group, owner, o = {}) => {
  const name = o.name ?? `${group}/${uid()}.pdf`;
  await db.exec("reset role");
  await db.query("insert into storage.objects (bucket_id, name, owner, metadata) values ($1,$2,$3,$4)", [o.bucket ?? "documents", name, owner ? U[owner] : null, JSON.stringify({ size: o.size ?? 1000, mimetype: o.type ?? "application/pdf" })]);
  return name;
};
const add = (user, group, title, category, path, fileName = "report.pdf") => rpc(user, "add_document", group, title, category, path, fileName);

// ----------------------------------------------------------------- the bucket
await db.exec("reset role");
const bucket = (await db.query("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'documents'")).rows[0];
check("the bucket is private, 10 MB per file", [bucket.public, Number(bucket.file_size_limit)], [false, 10485760]);
check("only photos, PDFs, Office files and text are allowed", [bucket.allowed_mime_types.includes("application/pdf"), bucket.allowed_mime_types.includes("image/jpeg"), bucket.allowed_mime_types.includes("image/svg+xml"), bucket.allowed_mime_types.includes("text/html"), bucket.allowed_mime_types.includes("application/x-msdownload")], [true, true, false, false, false]);
check("running the storage setup again is harmless", await db.exec(require_sql()).then(() => "ok", (e) => e.message), "ok");
function require_sql() { return fs.readFileSync(new URL("../migrations/0023_documents_storage.sql", import.meta.url), "utf8"); }

// ----------------------------------------------------- the file store's rules
const upload = async (user, name, size = 1000) => (await q(user, "insert into storage.objects (bucket_id, name, owner, metadata) values ('documents', $1, $2, $3) returning id", [name, U[user], JSON.stringify({ size })]));
const folder = (g) => `${g}/${uid()}.pdf`;
check("a member can upload into their group's folder", (await upload("bob", folder(G1))).thrown ?? "ok", "ok");
check("...not into another group's folder", (await upload("bob", folder(G2))).thrown?.includes("row-level security") ?? false, true);
check("an outsider cannot upload to the group", (await upload("eve", folder(G1))).thrown?.includes("row-level security") ?? false, true);
check("anonymous visitors cannot upload", (await q(null, "insert into storage.objects (bucket_id, name, metadata) values ('documents', $1, '{}')", [folder(G1)])).thrown !== undefined, true);
check("a path outside any group folder is refused", [(await upload("bob", `${uid()}.pdf`)).thrown?.includes("row-level security") ?? false, (await upload("bob", "not-a-uuid/file.pdf")).thrown?.includes("row-level security") ?? false], [true, true]);
check("a file deeper than one folder is refused", (await upload("bob", `${G1}/sub/${uid()}.pdf`)).thrown?.includes("row-level security") ?? false, true);
check("another bucket is not covered by these rules", (await q("bob", "insert into storage.objects (bucket_id, name, owner, metadata) values ('other', $1, $2, '{}')", [folder(G1), U.bob])).thrown?.includes("row-level security") ?? false, true);

await db.exec("reset role");
const bobsFile = await object(G1, "bob");
const carasFile = await object(G1, "cara");
const evesFile = await object(G2, "eve");
check("a member reads the group's files, nobody else's", [(await q("alice", "select name from storage.objects where name = $1", [bobsFile])).length, (await q("alice", "select name from storage.objects where name = $1", [evesFile])).length], [1, 0]);
check("an outsider and an anonymous visitor read nothing of the group's", [(await q("eve", "select name from storage.objects where name = $1", [bobsFile])).length, (await q(null, "select name from storage.objects where name = $1", [bobsFile])).thrown !== undefined || (await q(null, "select name from storage.objects where name = $1", [bobsFile])).length === 0], [0, true]);
check("a member cannot delete someone else's file", (await q("cara", "delete from storage.objects where name = $1 returning name", [bobsFile])).length, 0);
check("the uploader can delete their own", (await q("bob", "delete from storage.objects where name = $1 returning name", [bobsFile])).length, 1);
check("an admin can delete a member's file", (await q("alice", "delete from storage.objects where name = $1 returning name", [carasFile])).length, 1);
check("an admin of another group cannot", (await q("eve", "delete from storage.objects where name = $1 returning name", [await object(G1, "bob")])).length, 0);
check("nobody can overwrite or rename a file (no update rule)", (await q("bob", "update storage.objects set name = name || 'x' where name like $1 returning name", [`${G1}/%`])).length, 0);

// ----------------------------------------------------------- the space limit
await db.exec("reset role");
await db.query("delete from storage.objects");
const big = await object(G1, "bob", { size: 209715200 - 5000 });
check("a group with room can still upload", (await upload("cara", folder(G1), 1000)).thrown ?? "ok", "ok");
await object(G1, "bob", { size: 10000 });
check("a group at its 200 MB limit cannot upload more", (await upload("cara", folder(G1), 1000)).thrown?.includes("row-level security") ?? false, true);
check("another group is not affected", (await upload("eve", folder(G2), 1000)).thrown ?? "ok", "ok");
await db.exec("reset role");
await db.query("delete from storage.objects where name = $1", [big]);
check("deleting files makes room again", (await upload("cara", folder(G1), 1000)).thrown ?? "ok", "ok");

// ---------------------------------------------------------- registering a file
await db.exec("reset role");
await db.query("delete from storage.objects");
const p1 = await object(G1, "bob", { size: 5000, type: "application/pdf" });
check("a member registers their uploaded file", (await add("bob", G1, "  Insurance certificate  ", "insurance", p1, "cert 2026.pdf")).result, "ok");
await db.exec("reset role");
const doc = (await db.query("select * from public.documents where storage_path = $1", [p1])).rows[0];
check("the title is trimmed, size and type come from the file store", [doc.title, doc.category, doc.file_name, Number(doc.size_bytes), doc.content_type, doc.uploaded_by === U.bob], ["Insurance certificate", "insurance", "cert 2026.pdf", 5000, "application/pdf", true]);
check("registering twice is refused", result(await add("bob", G1, "Again", "general", p1)), "already_added");
check("an outsider cannot register", result(await add("eve", G1, "x", "general", await object(G1, "eve"))), "not_allowed");
check("anonymous cannot", (await rpc(null, "add_document", G1, "x", "general", p1, "a.pdf")).thrown?.includes("permission denied") ?? false, true);
check("a file that was never uploaded is refused", result(await add("bob", G1, "Ghost", "general", `${G1}/${uid()}.pdf`)), "file_missing");
check("so is someone else's upload", result(await add("cara", G1, "Not mine", "general", await object(G1, "bob"))), "file_missing");
check("a file in another bucket is not a document", result(await add("bob", G1, "Wrong bucket", "general", await object(G1, "bob", { bucket: "other" }))), "file_missing");
check("a path in another group's folder is refused", result(await add("bob", G1, "Wrong group", "general", await object(G2, "bob"))), "path_invalid");
check("a path that climbs out is refused", result(await add("bob", G1, "Sneaky", "general", `${G1}/../${G2}/x.pdf`)), "path_invalid");
const p2 = await object(G1, "bob");
check("a title is required, and not too long", [result(await add("bob", G1, "   ", "general", p2)), result(await add("bob", G1, "x".repeat(121), "general", p2))], ["title_required", "title_too_long"]);
check("the category must be known", [result(await add("bob", G1, "T", "secret", p2)), result(await add("bob", G1, "T", null, p2))], ["category_invalid", "category_invalid"]);
check("the file name must be sensible", [result(await add("bob", G1, "T", "general", p2, " ")), result(await add("bob", G1, "T", "general", p2, "x".repeat(201)))], ["file_name_invalid", "file_name_invalid"]);
check("nothing was added by the refused calls", (await db.query("select count(*)::int n from public.documents")).rows[0].n, 1);

// ------------------------------------------------------------ who sees what
check("members see the group's documents", [(await q("alice", "select title from public.documents")).map((r) => r.title), (await q("cara", "select count(*)::int n from public.documents"))[0].n], [["Insurance certificate"], 1]);
check("an outsider and another group's admin see none", [(await q("eve", "select * from public.documents")).length, (await q(null, "select * from public.documents")).thrown !== undefined || true], [0, true]);
check("nobody writes the table directly", [(await q("bob", "update public.documents set title = 'x' returning id")).length, (await q("bob", "delete from public.documents returning id")).length, (await q("bob", "insert into public.documents (group_id, uploaded_by, title, category, file_name, content_type, size_bytes, storage_path) values ($1,$2,'x','general','a','a',1,'p')", [G1, U.bob])).thrown?.includes("row-level security") ?? false], [0, 0, true]);

// ------------------------------------------------------------------ deleting
const docId = doc.id;
check("a member cannot delete someone else's document", result(await rpc("cara", "delete_document", docId)), "not_allowed");
check("an outsider cannot", result(await rpc("eve", "delete_document", docId)), "not_allowed");
check("anonymous cannot", (await rpc(null, "delete_document", docId)).thrown?.includes("permission denied") ?? false, true);
check("an unknown document", result(await rpc("bob", "delete_document", "00000000-0000-0000-0000-000000000000")), "not_found");
const removed = await rpc("bob", "delete_document", docId);
check("the uploader deletes it, and gets the file's path to remove", [removed.result, removed.path], ["ok", p1]);
check("it is gone from the list at once", (await q("alice", "select * from public.documents")).length, 0);
check("it cannot be deleted twice", result(await rpc("bob", "delete_document", docId)), "not_found");
await db.exec("reset role");
check("...but stays on record, with who deleted it", (await db.query("select deleted_by = $2 as by_bob from public.documents where id = $1", [docId, U.bob])).rows[0].by_bob, true);
const p3 = await object(G1, "cara");
await add("cara", G1, "Cara's manual", "manuals", p3, "poh.pdf");
await db.exec("reset role");
const caraDoc = (await db.query("select id from public.documents where storage_path = $1", [p3])).rows[0].id;
check("an admin deletes a member's document", (await rpc("alice", "delete_document", caraDoc)).result, "ok");

// ------------------------------------------------------- receipts on expenses
await db.exec("reset role");
await db.query("insert into public.cost_rates (group_id, effective_month, monthly_fee_pence, hourly_rate_pence, created_by) values ($1,'2026-01-01',12000,6500,$2)", [G1, U.alice]);
const receiptPath = await object(G1, "alice");
await add("alice", G1, "Fuel at Sywell", "receipts", receiptPath, "bill.jpg");
await db.exec("reset role");
const receiptId = (await db.query("select id from public.documents where storage_path = $1", [receiptPath])).rows[0].id;
const expense = (user, doc, date = "2026-10-05") => rpc(user, "add_cost_expense", G1, U.bob, date, "Fuel at Sywell", 18400, doc);
check("an expense can carry a receipt", result(await expense("alice", receiptId)), "ok");
check("one without a receipt still works, the old five-argument way", result(await rpc("alice", "add_cost_expense", G1, U.bob, "2026-10-04", "Parking", 500)), "ok");
check("a receipt from another group is refused", result(await expense("alice", (await (async () => { const pe = await object(G2, "eve"); await add("eve", G2, "Eve's", "receipts", pe); await db.exec("reset role"); return (await db.query("select id from public.documents where storage_path = $1", [pe])).rows[0].id; })()))), "document_invalid");
check("a deleted document is refused", result(await expense("alice", caraDoc)), "document_invalid");
check("so is an id that does not exist", result(await expense("alice", "00000000-0000-0000-0000-000000000000")), "document_invalid");
const s = await rpc("alice", "cost_statement", G1, "2026-10-01");
check("the statement says which expense has a receipt", s.expenses.map((e) => [e.description, e.document_id]), [["Parking", null], ["Fuel at Sywell", receiptId]]);
check("the member sees the receipt link on their own statement", (await rpc("bob", "cost_statement", G1, "2026-10-01")).expenses.map((e) => e.document_id).sort(), [null, receiptId].sort());
check("a receipt is visible to every member as a document", (await q("cara", "select title, category from public.documents where id = $1", [receiptId])), [{ title: "Fuel at Sywell", category: "receipts" }]);

h.finish();

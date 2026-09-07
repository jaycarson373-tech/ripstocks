// Run with PGLITE_MODULE pointing to an independently installed PGlite module.
// No project or production database credentials are used by this test.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");

test("Postgres reservations are atomic, deduplicated, precise, and server-only", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    // PGlite already includes gen_random_uuid(), but does not bundle pgcrypto.
    const base = (await readFile(new URL("../supabase/pons-automation.sql", import.meta.url), "utf8")).replace("create extension if not exists pgcrypto;", "");
    await db.exec(base);
    const migration = await readFile(new URL("../supabase/pack-reinvestment.sql", import.meta.url), "utf8");
    await db.exec(migration);
    await db.exec(migration);
    await db.query("select public.acquire_automation_lock($1)", ["test-worker"]);
    const contract = "0x0000000000000000000000000000000000000001";
    const treasury = "0x0000000000000000000000000000000000000002";
    const scope = `4663:${contract}:${treasury}`;
    const epoch = { id: "epoch-1", scope, chain_id: 4663, pack_contract: contract, treasury, epoch_key: "2026-09-07T12:00:00Z", scan_from_block: "1", scan_to_block: "100", scan_block_hash: "0xabc", budget_atoms: "20000000" };
    const receipts = [{ request_id: "1", amount_atoms: "20000000", transaction_hash: "0xdef", block_hash: "0xabc", block_number: "99" }];
    const lots = [{ id: "lot-1", lot_index: 0, usd_atoms: "5000000" }, { id: "lot-2", lot_index: 1, usd_atoms: "15000000" }];
    const reserve = (e, r, l, holder = "test-worker") => db.query("select public.reserve_pack_reinvestment($1::jsonb,$2::jsonb,$3::jsonb,$4) as result", [JSON.stringify(e), JSON.stringify(r), JSON.stringify(l), holder]);
    await assert.rejects(reserve(epoch, receipts, lots, "other-worker"), /lease/);
    const first = (await reserve(epoch, receipts, lots)).rows[0].result;
    assert.equal(first.budget_atoms, "20000000");
    assert.equal((await reserve(epoch, receipts, lots)).rows[0].result.id, "epoch-1");
    assert.equal((await db.query("select count(*)::int as n from public.pack_sale_receipts")).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::int as n from public.pack_reinvestment_lots")).rows[0].n, 2);
    const next = { ...epoch, id: "epoch-2", epoch_key: "2026-09-07T13:00:00Z", scan_from_block: "101", scan_to_block: "200" };
    const nextReceipts = [{ ...receipts[0], block_number: "150", transaction_hash: "0xghi" }];
    const nextLots = lots.map(lot => ({ ...lot, id: lot.id + "-next" }));
    await assert.rejects(reserve(next, nextReceipts, nextLots), /previous epoch is incomplete/);
    await db.query("update public.pack_reinvestment_epochs set status='complete' where id='epoch-1'");
    await assert.rejects(reserve(next, nextReceipts, nextLots), /duplicate key/);
    assert.equal((await db.query("select count(*)::int as n from public.pack_reinvestment_epochs")).rows[0].n, 1, "duplicate receipt rolls back epoch insertion");
    await assert.rejects(reserve(next, [{ ...nextReceipts[0], request_id: "2" }], [{ ...nextLots[0], usd_atoms: "10000000" }]), /do not reconcile/);
    await assert.rejects(reserve(next, [{ ...nextReceipts[0], request_id: "2", block_number: "201" }], nextLots), /outside scan/);
    await db.query("update public.pack_reinvestment_lots set token_amount_atoms=$1 where id='lot-1'", ["1000000000000000001"]);
    assert.equal((await db.query("select token_amount_atoms from public.pack_reinvestment_lots where id='lot-1'")).rows[0].token_amount_atoms, "1000000000000000001");
    await db.exec("set role anon");
    await assert.rejects(db.query("select * from public.pack_reinvestment_transactions"), /permission denied/);
    await assert.rejects(reserve(next, nextReceipts, nextLots), /permission denied/);
    await db.exec("reset role");
  } finally { await db.close(); }
});

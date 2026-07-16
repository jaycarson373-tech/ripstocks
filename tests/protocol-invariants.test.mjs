import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const protocol = await readFile(new URL("../lib/protocol.ts", import.meta.url), "utf8");
const schema = await readFile(new URL("../supabase/protocol.sql", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("one shared 20-minute interval drives the product", () => {
  assert.match(protocol, /AIRDROP_INTERVAL_MINUTES = 20/);
  assert.doesNotMatch(page, /hourly|60 minutes|every hour/i);
  assert.match(schema, /interval '20 minutes'/);
});

test("protocol fees split exactly 75\/25", () => {
  assert.match(schema, /gross_fee_usdc\*\.75/);
  assert.match(schema, /pack_ev_reserve_amount/);
  assert.match(protocol, /HOLDER_AIRDROP_FEE_BPS = 7_500/);
  assert.match(protocol, /PACK_EV_RESERVE_FEE_BPS = 2_500/);
});

test("pack inventory and holder treasury use separate ledgers", () => {
  assert.match(schema, /pack_inventory_ledger/);
  assert.match(schema, /holder_airdrop_treasury_ledger/);
  assert.match(schema, /pack_ev_reserve_ledger/);
  assert.match(schema, /protocol_wallets/);
  assert.match(schema, /'pack_inventory','holder_airdrop','pack_ev_reserve'/);
  assert.match(schema, /protocol_fee_sweeps/);
});

test("EV is calculated, never a fixed promise", () => {
  assert.match(protocol, /remainingStockInventory \/ packsRemaining/);
  assert.doesNotMatch(page, /EV[^\n]*\$\d/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const protocol = await readFile(new URL("../lib/protocol.ts", import.meta.url), "utf8");
const schema = await readFile(new URL("../supabase/protocol.sql", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const wallet = await readFile(new URL("../lib/solana-wallet.ts", import.meta.url), "utf8");

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
  assert.match(schema, /'main_treasury','holder_airdrop'/);
  assert.match(schema, /protocol_fee_sweeps/);
  assert.match(schema, /retained_in_main_treasury/);
  assert.doesNotMatch(protocol, /PACK_EV_RESERVE_WALLET/);
});

test("EV is calculated, never a fixed promise", () => {
  assert.match(protocol, /remainingStockInventory \/ packsRemaining/);
  assert.doesNotMatch(page, /EV[^\n]*\$\d/);
});

test("automatic restocks preserve their funding source", () => {
  assert.match(schema, /inventory_restock_jobs/);
  assert.match(schema, /source in \('pack_sale','pack_ev_reserve'\)/);
  assert.match(page, /RESTOCK INVENTORY/);
  assert.doesNotMatch(page, /HOLDER AIRDROP TREASURY",snapshot\.holderAirdropTreasury/);
});

test("wallet supports Phantom, Backpack, trusted reconnect and disconnect", () => {
  assert.match(wallet, /phantom\?\.solana/);
  assert.match(wallet, /backpack\?\.solana/);
  assert.match(page, /onlyIfTrusted: true/);
  assert.match(page, /providerRef\.current\?\.disconnect/);
  assert.match(page, />DISCONNECT</);
});

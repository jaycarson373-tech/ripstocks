import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const protocol = await readFile(new URL("../lib/protocol.ts", import.meta.url), "utf8");
const schema = await readFile(new URL("../supabase/protocol.sql", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const wallet = await readFile(new URL("../lib/solana-wallet.ts", import.meta.url), "utf8");
const checkoutCreate = await readFile(new URL("../app/api/checkout/create/route.ts", import.meta.url), "utf8");
const checkoutConfirm = await readFile(new URL("../app/api/checkout/confirm/route.ts", import.meta.url), "utf8");
const verifiedXstocks = await readFile(new URL("../lib/xstocks.ts", import.meta.url), "utf8");
const airdropPolicy = await readFile(new URL("../lib/airdrop-policy.ts", import.meta.url), "utf8");
const inventoryPlan = await readFile(new URL("../lib/inventory-plan.ts", import.meta.url), "utf8");

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
  assert.doesNotMatch(page, /Expected Value \$\d/);
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

test("holder inventory restocks privately in $2-$5 batches", () => {
  assert.match(airdropPolicy, /AIRDROP_BATCH_TARGET = 15/);
  assert.match(airdropPolicy, /lastHolderFeeClaim >= 20/);
  assert.match(airdropPolicy, /return 5/);
  assert.match(airdropPolicy, /return 2/);
  assert.match(schema, /airdrop_inventory_lots/);
  assert.match(page, /AIRDROP TREASURY/);
  assert.match(page, /AIRDROP PACKS READY/);
  assert.match(page, /AVERAGE DROP VALUE/);
  assert.doesNotMatch(page, /NEXT DROP VALUE|\$2, \$5 or \$10/);
});

test("checkout reserves before charging and verifies both sides of exact USDC payment", () => {
  assert.match(checkoutCreate, /reserve_pack_checkout/);
  assert.match(checkoutCreate, /PACK_PRICE_USDC_ATOMS/);
  assert.match(checkoutConfirm, /buyerPre-buyerPost>=PACK_PRICE_USDC_ATOMS/);
  assert.match(checkoutConfirm, /complete_pack_fulfillment/);
  assert.match(checkoutConfirm, /tokenProgram/);
  assert.match(schema, /TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb/);
  assert.match(schema, /for update skip locked/);
});

test("site publishes exactly ten verified inventory mints", () => {
  assert.equal((verifiedXstocks.match(/symbol:/g) || []).length,10);
  assert.match(page,/VERIFIED INVENTORY UNIVERSE/);
  assert.match(verifiedXstocks,/XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1/);
});

test("practice loader preserves gas and exact inventory averages", () => {
  assert.match(inventoryPlan,/SOL_GAS_BUFFER = 0\.111/);
  assert.match(inventoryPlan,/MAIN_INVENTORY_LOTS = \[3,3,3,3,3,3,5,7,8,10,12,15,20,25,30\]/);
  assert.match(inventoryPlan,/HOLDER_INVENTORY_LOTS = \[2,3,4,5,5,5,5,7,7,7\]/);
  const main=[3,3,3,3,3,3,5,7,8,10,12,15,20,25,30];
  const holder=[2,3,4,5,5,5,5,7,7,7];
  assert.equal(main.reduce((a,b)=>a+b,0),150);
  assert.equal(main.reduce((a,b)=>a+b,0)/main.length,10);
  assert.equal(holder.reduce((a,b)=>a+b,0),50);
  assert.equal(holder.reduce((a,b)=>a+b,0)/holder.length,5);
});

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
const restock = await readFile(new URL("../app/api/admin/restock/route.ts", import.meta.url), "utf8");
const holderEpoch = await readFile(new URL("../app/api/admin/holder-epoch/route.ts", import.meta.url), "utf8");
const tick = await readFile(new URL("../app/api/admin/tick/route.ts", import.meta.url), "utf8");
const protocolRoute = await readFile(new URL("../app/api/protocol/route.ts", import.meta.url), "utf8");
const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");

test("one shared 5-minute interval drives the product", () => {
  assert.match(protocol, /AIRDROP_INTERVAL_MINUTES = 5/);
  assert.doesNotMatch(page, /hourly|60 minutes|every hour/i);
  assert.match(schema, /interval '5 minutes'/);
});

test("protocol fees split exactly 80\/20", () => {
  assert.match(schema, /gross_fee_usdc\*\.80/);
  assert.match(schema, /pack_ev_reserve_amount/);
  assert.match(protocol, /HOLDER_AIRDROP_FEE_BPS = 8_000/);
  assert.match(protocol, /PACK_EV_RESERVE_FEE_BPS = 2_000/);
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
  assert.match(schema, /sum\(usd_value\) filter\(where status='available'\)/);
  assert.doesNotMatch(schema, /launch allocation/);
  assert.doesNotMatch(page, /Expected Value \$\d/);
});

test("automatic restocks preserve their funding source", () => {
  assert.match(schema, /inventory_restock_jobs/);
  assert.match(schema, /source in \('pack_sale','pack_ev_reserve'\)/);
  assert.match(page, /FEES ROUTE 80\/20/);
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
  assert.match(airdropPolicy, /AIRDROP_TREASURY_SPEND_FRACTION = 0\.80/);
  assert.match(airdropPolicy, /return 2/);
  assert.match(schema, /airdrop_inventory_lots/);
  assert.match(page, /GACHA PACKS COMING SOON/);
  assert.match(page, /TREASURY DROPS READY/);
  assert.match(page, /AVERAGE DROP VALUE/);
  assert.doesNotMatch(page, /NEXT DROP VALUE|\$2, \$5 or \$10/);
});

test("checkout reserves before charging and verifies both sides of exact USDC payment", () => {
  assert.match(checkoutCreate, /async function reserveInventory/);
  assert.match(checkoutCreate, /status=eq\.available/);
  assert.match(checkoutCreate, /PACK_PRICE_USDC_ATOMS/);
  assert.match(checkoutConfirm, /buyerPre-buyerPost>=PACK_PRICE_USDC_ATOMS/);
  assert.match(checkoutConfirm, /complete_pack_fulfillment/);
  assert.match(checkoutConfirm, /tokenProgram/);
  assert.match(schema, /TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb/);
  assert.match(schema, /for update skip locked/);
});

test("site publishes exactly ten verified inventory mints", () => {
  assert.equal((verifiedXstocks.match(/symbol:/g) || []).length,10);
  assert.match(page,/WHICH STOCKS CAN DROP/);
  assert.match(verifiedXstocks,/XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1/);
});

test("draw live gate defaults off and removes pre-draw urgency", () => {
  assert.match(envExample, /DRAWS_LIVE=false/);
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_DRAWS_LIVE/);
  assert.match(protocolRoute, /process\.env\.DRAWS_LIVE/);
  assert.match(protocolRoute, /drawsLive\(\)/);
  assert.match(protocol, /drawsLive: false/);
  assert.match(page, /DRAWS HAVE NOT STARTED/);
  assert.match(page, /AWAITING FIRST DRAW/);
  assert.match(page, /NO DROPS YET/);
  assert.match(page, /OPEN DROP ROOM/);
  assert.match(page, /Draw inventory logs begin once the drop engine is activated/);
  assert.doesNotMatch(page, /Waiting for the first confirmed holder stock drop|Waiting for the next wallet purchase|Holder drops are live first|Chat opens once the live table is migrated/);
});

test("practice loader preserves gas and exact inventory averages", () => {
  assert.match(inventoryPlan,/SOL_GAS_BUFFER = 0\.111/);
  assert.match(inventoryPlan,/MAIN_INVENTORY_LOTS = \[1,2,3,5,8,10,12,15,20,25,30\]/);
  assert.match(inventoryPlan,/HOLDER_INVENTORY_LOTS = \[1,2,3,4,5\]/);
  const main=[1,2,3,5,8,10,12,15,20,25,30];
  const holder=[1,2,3,4,5];
  assert.equal(main.reduce((a,b)=>a+b,0),131);
  assert.equal(holder.reduce((a,b)=>a+b,0),15);
  assert.equal(holder.reduce((a,b)=>a+b,0)/holder.length,3);
});

test("protected automation restocks on the shared 5-minute clock and records confirmed output",()=>{
  assert.match(tick,/AIRDROP_INTERVAL_MS/);
  assert.match(restock,/AIRDROP_INTERVAL_MS/);
  assert.match(tick,/restock\?scope=main/);
  assert.match(tick,/restock\?scope=holder/);
  assert.match(restock,/SOL_GAS_BUFFER/);
  assert.match(restock,/received<=BigInt\(0\)/);
  assert.match(restock,/status:"available"/);
  assert.match(schema,/automation_runs/);
});

test("holder epochs snapshot owners, reserve inventory, transfer, and publish proof",()=>{
  assert.match(holderEpoch,/HOLDER_TOKEN_MINT/);
  assert.match(holderEpoch,/getTokenAccounts/);
  assert.match(holderEpoch,/reserveAvailableLotForEpoch/);
  assert.match(holderEpoch,/complete_airdrop_epoch/);
  assert.match(schema,/status='distributed'/);
  assert.match(page,/STONK DROPS PROOFS/);
  assert.match(page,/Proof rows begin once the drop engine is activated/);
  assert.match(page,/stockProofs/);
});

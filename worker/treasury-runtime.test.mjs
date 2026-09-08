import test from "node:test";
import assert from "node:assert/strict";
import { packConfig } from "./pack-config.mjs";
import { treasuryConfig, validateTreasury, recoverTreasuryTransaction, resumeTreasuryPurchase, indexSettlements, settlePendingPack } from "./treasury-runtime.mjs";
import { ponsClaimRequest, ponsSweepRequest, ponsV2Adapter, validatePonsLaunch } from "./pons-v2-adapter.mjs";
import { planLots } from "./pack-reinvestment.mjs";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { supabaseHeaders } from "./supabase-headers.mjs";
import { directPoolKey, minimumOutput, HOOD_V4_SWAP_ADAPTER } from "./uniswap-v4.mjs";
test("modern Supabase server keys are not sent as bearer JWTs", () => {
  assert.deepEqual(supabaseHeaders("sb_secret_test"), { apikey: "sb_secret_test" });
  assert.equal(supabaseHeaders("legacy-service-role").Authorization, "Bearer legacy-service-role");
  assert.throws(() => supabaseHeaders("sb_publishable_test"), /backend secret/);
});
const env = { AUTOMATION_MODE: "dry-run", AUTOMATION_PRIVATE_KEY: "01".repeat(32), STOCKRIPS_PACK_CONTRACT: "0x" + "11".repeat(20), SWAP_PROVIDER: "uniswap-v4", SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" };
test("direct Robinhood v4 route uses sorted pool currencies and bounded slippage", () => {
  const key = directPoolKey("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", 3000, 60);
  assert.equal(key.currency0.toLowerCase(), "0x117cc2133c37b721f49de2a7a74833232b3b4c0c");
  assert.equal(minimumOutput(1_000_000n, 100), 990_000n);
  assert.match(HOOD_V4_SWAP_ADAPTER, /^0x[0-9A-Fa-f]{40}$/);
  assert.throws(() => minimumOutput(1n, 501), /0–500/);
});
test("Railway deployment artifact matches current contract source", () => {
  const artifact = JSON.parse(readFileSync(new URL("./artifacts/StonkRips.json", import.meta.url)));
  const source = readFileSync(new URL("../contracts/StonkRips.sol", import.meta.url));
  assert.equal(artifact.sourceSha256, createHash("sha256").update(source).digest("hex"));
  assert.equal(artifact.abi.find(item => item.type === "constructor").inputs.length, 3);
  assert(artifact.bytecode.object.length > 100);
});
test("treasury works without creator key or Pons CA; defaults off", () => {
  const cfg = treasuryConfig(env);
  assert.equal(cfg.priceAtoms, 20_000_000n);
  assert.equal(cfg.stocks.length, 10);
  assert.equal(cfg.ponsToken, undefined);
  assert.equal(cfg.creatorPrivateKey, undefined);
  assert.equal(cfg.reinvestEnabled, false);
  assert.equal(cfg.settlementDelaySeconds, 1);
  assert.throws(() => treasuryConfig({ ...env, PACK_SETTLEMENT_DELAY_SECONDS: "61" }), /60 or less/);
  assert.equal(treasuryConfig({}).mode, "off");
});
test("faster settlement still refuses to deliver before the future block is available", async () => {
  let requestReads = 0;
  const ctx = {
    scope: "future-block-test", cfg: { packContract: env.STOCKRIPS_PACK_CONTRACT, settlementDelaySeconds: 0 },
    publicClient: {
      readContract: async ({ functionName }) => {
        if (functionName === "activeRequestId") return 1n;
        requestReads++;
        return ["buyer", "commitment", "seed", 100n, false];
      },
      getBlockNumber: async () => 100n,
    },
    store: { transaction: () => assert.fail("Must not create a delivery transaction before entropy is ready") },
  };
  await settlePendingPack(ctx);
  await settlePendingPack(ctx);
  assert.equal(requestReads, 1);
});
test("Pons remains disabled by default and both live gates must move together", async () => {
  assert.equal(treasuryConfig({ ...env, PONS_TOKEN_ADDRESS: "legacy", PONS_V2_FACTORY: "legacy" }).mode, "dry-run");
  assert.throws(() => treasuryConfig({ ...env, CREATOR_FEE_CLAIM_ENABLED: "true" }), /enabled together/);
  assert.throws(() => treasuryConfig({ ...env, HOLDER_REWARDS_ENABLED: "true" }), /enabled together/);
  assert.equal(ponsV2Adapter().enabled, false);
});
test("Pons v2 validation binds the token, USDG pair, and separate fee recipient", async () => {
  const token = "0x" + "22".repeat(20);
  const recipient = "0x" + "33".repeat(20);
  const feeAsset = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
  const launch = { token, creatorFeeRecipient: recipient, pairToken: feeAsset, exists: true };
  const publicClient = { readContract: async () => launch };
  assert.equal((await validatePonsLaunch({ publicClient, factory: "0x" + "44".repeat(20), token, recipient, feeAsset })).exists, true);
  await assert.rejects(validatePonsLaunch({ publicClient, factory: "0x" + "44".repeat(20), token, recipient: "0x" + "55".repeat(20), feeAsset }), /configured Pons fee wallet/);
  assert.match(ponsClaimRequest("0x" + "66".repeat(20), feeAsset).data, /^0x[0-9a-f]+$/);
  assert.equal(ponsSweepRequest({ ...launch, curve: "0x" + "77".repeat(20), phase: 2 }), null);
  assert.match(ponsSweepRequest({ ...launch, curve: "0x" + "77".repeat(20), phase: 0 }).data, /^0x[0-9a-f]+$/);
});
test("Pons hourly configuration requires a separate Pons fee key and a USDG pair", () => {
  const enabled = {
    ...env,
    PONS_PRIVATE_KEY: "02".repeat(32),
    CREATOR_FEE_CLAIM_ENABLED: "true",
    HOLDER_REWARDS_ENABLED: "true",
    PONS_TOKEN_ADDRESS: "0x" + "22".repeat(20),
    PONS_TOKEN_START_BLOCK: "123",
    PONS_V2_FACTORY: "0x" + "44".repeat(20),
    PONS_FEE_ESCROW: "0x" + "66".repeat(20),
    PONS_FEE_ASSET_ADDRESS: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  };
  const cfg = treasuryConfig(enabled);
  assert.equal(cfg.ponsEnabled, true);
  assert.match(cfg.ponsSignerKey, /^0x[0-9a-f]{64}$/i);
  assert.equal(cfg.pons.tokensPerTicket, "10000");
  assert.throws(() => treasuryConfig({ ...enabled, PONS_PRIVATE_KEY: "" }), /PONS_PRIVATE_KEY is required/);
  assert.throws(() => treasuryConfig({ ...enabled, PONS_FEE_ASSET_ADDRESS: "0x" + "77".repeat(20) }), /USDG-paired/);
});
test("future prices preserve every atom without assuming twenty-dollar sales", () => {
  for (const price of [7_500_000n, 30_000_000n, 100_000_000n]) {
    const budget = price * 3n;
    const lots = planLots(budget, "0x" + "12".repeat(32), "different-pack", price, packConfig().restockLotUsd);
    assert.equal(lots.reduce((sum, lot) => sum + BigInt(lot.usd_atoms), 0n), budget);
    assert(lots.every(lot => BigInt(lot.usd_atoms) > 0n));
  }
  assert.throws(() => packConfig("UNKNOWN"), /Unknown pack/);
});
test("wrong network and mismatched price fail closed", async () => {
  const address = "0x" + "11".repeat(20);
  const cfg = treasuryConfig(env);
  const ctx = { cfg, account: { address }, publicClient: { getChainId: async () => 4663, readContract: async ({ functionName }) => functionName === "packPrice" ? cfg.priceAtoms : functionName === "approvedStock" ? true : address } };
  await validateTreasury(ctx);
  ctx.publicClient.getChainId = async () => 1;
  await assert.rejects(validateTreasury(ctx), /4663/);
  ctx.publicClient.getChainId = async () => 4663;
  ctx.publicClient.readContract = async ({ functionName }) => functionName === "packPrice" ? 30_000_000n : address;
  await assert.rejects(validateTreasury(ctx), /price/);
});
test("dry run cannot broadcast a pending signed transaction", async () => {
  await assert.rejects(recoverTreasuryTransaction({ cfg: { mode: "dry-run" }, store: { pendingTransaction: async () => ({ id: "pending" }) } }), /dry run sends nothing/);
});
test("disabling reinvestment prevents rebroadcast of a pending restock", async () => {
  await assert.rejects(recoverTreasuryTransaction({ scope: "scope", cfg: { mode: "live", reinvestEnabled: false }, store: { pendingTransaction: async () => ({ lot_id: "reserved-sale-lot" }) } }), /paused/);
});
test("completed initial purchase retry never accesses a wallet", async () => {
  await resumeTreasuryPurchase({ store: { patch: () => { throw new Error("must not patch"); } } }, { completed_at: "2026-09-07T00:00:00Z" });
});
test("empty chain activity produces no invented settlement rows", async () => {
  let writes = 0;
  await indexSettlements({ cfg: { mode: "live", packStartBlock: 10n }, scope: "test", lease: async () => {}, store: { rows: async () => [] }, audit: { request: async () => { writes++; } }, publicClient: { getBlockNumber: async () => 30n, getLogs: async () => [] } });
  assert.equal(writes, 0);
});

import { readFileSync } from "node:fs";
import { STOCK_TOKENS } from "./pons-core.mjs";

const catalog = JSON.parse(readFileSync(new URL("../config/packs.json", import.meta.url), "utf8"));
export function holderRewardsConfig() {
  const tokensPerTicket = String(catalog.holderRewards?.tokensPerTicket || "");
  if (!/^[1-9][0-9]*$/.test(tokensPerTicket)) throw new Error("Invalid holder ticket configuration");
  return { tokensPerTicket };
}
export function packConfig(id = catalog.activePackId) {
  const pack = catalog.packs.find(item => item.id === id);
  if (!pack || !/^[1-9][0-9]*$/.test(pack.priceUsdgAtoms)) throw new Error("Unknown pack or invalid USDG price");
  if (typeof pack.enabled !== "boolean") throw new Error("Invalid pack enabled state");
  if (typeof pack.visualTheme !== "string" || !pack.visualTheme.trim()) throw new Error("Invalid pack visual theme");
  if (pack.selectionModel !== "uniform-funded-inventory-slots") throw new Error("Invalid pack selection model");
  if (!Number.isSafeInteger(pack.inventoryRequirements?.publicAvailabilityFloorUsd) || pack.inventoryRequirements.publicAvailabilityFloorUsd < 0) throw new Error("Invalid public availability floor");
  const stocks = pack.symbols.map(symbol => STOCK_TOKENS.find(stock => stock.symbol === symbol));
  if (!stocks.length || stocks.some(stock => !stock) || new Set(pack.symbols).size !== stocks.length) throw new Error("Invalid configured stock universe");
  if (!pack.restockLotUsd.length || new Set(pack.restockLotUsd).size !== pack.restockLotUsd.length || pack.restockLotUsd.some(value => !Number.isSafeInteger(value) || value < 1)) throw new Error("Invalid restock budgets");
  if (!Number.isSafeInteger(pack.targetReturnBps) || pack.targetReturnBps < 1 || pack.targetReturnBps > 10_000) throw new Error("Invalid pack target return");
  const tiers = pack.rarity?.tiers;
  if (typeof pack.rarity?.publishOdds !== "boolean" || !Array.isArray(tiers) || !tiers.length) throw new Error("Invalid rarity configuration");
  if (new Set(tiers.map(tier => tier.id)).size !== tiers.length) throw new Error("Duplicate rarity tier");
  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index];
    const previousMax = index === 0 ? 0 : tiers[index - 1].maxUsdExclusive;
    if (typeof tier.id !== "string" || !tier.id || typeof tier.label !== "string" || !tier.label || !/^#[0-9a-f]{6}$/i.test(tier.color)) throw new Error("Invalid rarity tier display");
    if (tier.weightBps !== null && (!Number.isSafeInteger(tier.weightBps) || tier.weightBps < 0 || tier.weightBps > 10_000)) throw new Error("Invalid rarity tier weight");
    if (!Number.isFinite(tier.minUsd) || tier.minUsd !== previousMax) throw new Error("Rarity tiers must be contiguous");
    if (index === tiers.length - 1) {
      if (tier.maxUsdExclusive !== null) throw new Error("Final rarity tier must be unbounded");
    } else if (!Number.isFinite(tier.maxUsdExclusive) || tier.maxUsdExclusive <= tier.minUsd) {
      throw new Error("Invalid rarity tier range");
    }
  }
  if (pack.rarity.publishOdds && (tiers.some(tier => tier.weightBps === null) || tiers.reduce((sum, tier) => sum + tier.weightBps, 0) !== 10_000)) throw new Error("Published rarity odds must total 10000 bps");
  if (!Array.isArray(pack.initialSeedPlanUsd) || !pack.initialSeedPlanUsd.length || pack.initialSeedPlanUsd.some(value => !pack.restockLotUsd.includes(value))) throw new Error("Invalid initial seed plan");
  const seedTotal = pack.initialSeedPlanUsd.reduce((sum, value) => sum + value, 0) * 1_000_000;
  const seedTarget = Number(pack.priceUsdgAtoms) * pack.initialSeedPlanUsd.length * pack.targetReturnBps / 10_000;
  if (seedTotal !== seedTarget) throw new Error("Initial seed plan does not match target return");
  return { ...pack, priceAtoms: BigInt(pack.priceUsdgAtoms), stocks };
}

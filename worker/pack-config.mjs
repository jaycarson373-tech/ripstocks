import { readFileSync } from "node:fs";
import { STOCK_TOKENS } from "./pons-core.mjs";

const catalog = JSON.parse(readFileSync(new URL("../config/packs.json", import.meta.url), "utf8"));
export function packConfig(id = catalog.activePackId) {
  const pack = catalog.packs.find(item => item.id === id);
  if (!pack || !/^[1-9][0-9]*$/.test(pack.priceUsdgAtoms)) throw new Error("Unknown pack or invalid USDG price");
  const stocks = pack.symbols.map(symbol => STOCK_TOKENS.find(stock => stock.symbol === symbol));
  if (!stocks.length || stocks.some(stock => !stock) || new Set(pack.symbols).size !== stocks.length) throw new Error("Invalid configured stock universe");
  if (!pack.restockLotUsd.length || new Set(pack.restockLotUsd).size !== pack.restockLotUsd.length || pack.restockLotUsd.some(value => !Number.isSafeInteger(value) || value < 1)) throw new Error("Invalid restock budgets");
  if (!Number.isSafeInteger(pack.targetReturnBps) || pack.targetReturnBps < 1 || pack.targetReturnBps > 10_000) throw new Error("Invalid pack target return");
  if (!Array.isArray(pack.initialSeedPlanUsd) || !pack.initialSeedPlanUsd.length || pack.initialSeedPlanUsd.some(value => !pack.restockLotUsd.includes(value))) throw new Error("Invalid initial seed plan");
  const seedTotal = pack.initialSeedPlanUsd.reduce((sum, value) => sum + value, 0) * 1_000_000;
  const seedTarget = Number(pack.priceUsdgAtoms) * pack.initialSeedPlanUsd.length * pack.targetReturnBps / 10_000;
  if (seedTotal !== seedTarget) throw new Error("Initial seed plan does not match target return");
  return { ...pack, priceAtoms: BigInt(pack.priceUsdgAtoms), stocks };
}

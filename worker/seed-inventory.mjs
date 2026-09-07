import { buyInventory } from "./treasury-buy.mjs";
import { packConfig } from "./pack-config.mjs";

// Reuses immutable purchase IDs and the durable journal on every retry.
const pack = packConfig(process.env.PACK_ID);
const values = (process.env.INITIAL_PRIZE_USD_VALUES || "5,10,15,20,20,25,30,35,40,50").split(",");
const batch = process.env.SEED_BATCH_ID;
if (!batch || !/^[a-zA-Z0-9_-]{1,48}$/.test(batch)) throw new Error("Set a stable SEED_BATCH_ID and reuse it when resuming");
if (values.length > 50 || values.some(value => !/^\d+(\.\d{1,6})?$/.test(value) || Number(value) <= 0)) throw new Error("Invalid seed budgets");
const execute = process.env.SEED_INVENTORY_CONFIRM === "I_UNDERSTAND";
for (const [index, usdg] of values.entries()) {
  await buyInventory({ id: `${batch}-${index}`, symbol: pack.stocks[index % pack.stocks.length].symbol, usdg, execute });
}

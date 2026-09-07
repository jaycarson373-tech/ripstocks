import catalog from "@/config/packs.json";
import { STOCK_TOKENS as registry } from "./stock-tokens";

export const ACTIVE_PACK = catalog.packs.find(pack => pack.id === catalog.activePackId)!;
if (!ACTIVE_PACK) throw new Error("Active pack configuration missing");
export const PACK_PRICE_USD = Number(ACTIVE_PACK.priceUsdgAtoms) / 1_000_000;
export const PACK_STOCKS = registry.filter(stock => ACTIVE_PACK.symbols.includes(stock.symbol));
if (PACK_STOCKS.length !== ACTIVE_PACK.symbols.length) throw new Error("Unsupported stock in pack configuration");

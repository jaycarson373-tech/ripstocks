import catalog from "@/config/packs.json";
import { STOCK_TOKENS as registry } from "./stock-tokens";
import { rarityForValue as classifyRarity, type RarityTier } from "./rarity";

export const ACTIVE_PACK = catalog.packs.find(pack => pack.id === catalog.activePackId)!;
if (!ACTIVE_PACK) throw new Error("Active pack configuration missing");
if (!/^[1-9][0-9]*$/.test(catalog.holderRewards.tokensPerTicket)) throw new Error("Invalid holder ticket configuration");
export const HOLDER_TOKENS_PER_TICKET = catalog.holderRewards.tokensPerTicket;
export const PACK_PRICE_USD = Number(ACTIVE_PACK.priceUsdgAtoms) / 1_000_000;
export const PACK_STOCKS = registry.filter(stock => ACTIVE_PACK.symbols.includes(stock.symbol));
if (PACK_STOCKS.length !== ACTIVE_PACK.symbols.length) throw new Error("Unsupported stock in pack configuration");
export const PACK_RARITIES = ACTIVE_PACK.rarity.tiers as RarityTier[];
export const PACK_RARITY_ODDS_PUBLISHED = ACTIVE_PACK.rarity.publishOdds;
export function rarityForValue(valueUsd: number) {
  return classifyRarity(valueUsd, PACK_RARITIES);
}

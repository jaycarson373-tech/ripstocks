export type CaseReelItem<TStock, TRarity> = {
  stock: TStock;
  rarity: TRarity;
  winning: boolean;
};

export function buildCaseReel<TStock extends { symbol: string }, TRarity>(
  stocks: TStock[],
  winner: TStock,
  winnerRarity: TRarity,
  rarityForStock: (stock: TStock) => TRarity,
  winnerIndex = 45,
  trailingItems = 6,
): CaseReelItem<TStock, TRarity>[] {
  if (!stocks.length || winnerIndex < 0 || trailingItems < 1) throw new Error("Invalid case reel configuration");
  const seed = winner.symbol.split("").reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return Array.from({ length: winnerIndex + trailingItems }, (_, index) => {
    const winning = index === winnerIndex;
    const stock = winning ? winner : stocks[(index * 7 + seed) % stocks.length];
    return { stock, rarity: winning ? winnerRarity : rarityForStock(stock), winning };
  });
}

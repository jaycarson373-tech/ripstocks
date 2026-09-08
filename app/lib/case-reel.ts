export type CaseReelItem<TStock, TRarity> = {
  stock: TStock;
  rarity: TRarity;
  winning: boolean;
};

export const CASE_REVEAL_TIMING = { introMs: 450, spinMs: 6_500, lockMs: 650 } as const;

// Positions are tile units, not pixels, so resizing cannot change the winner.
export function planReelLanding(position: number, replay: boolean) {
  return { index: replay ? 45 : Math.ceil(position) + 4, durationMs: replay ? CASE_REVEAL_TIMING.spinMs : 1_000 };
}

export function reelPositionAt(start: number, target: number, progress: number) {
  const p = Math.max(0, Math.min(1, progress));
  return start + (target - start) * (1 - Math.pow(1 - p, 3));
}

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

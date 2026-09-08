export type CaseReelItem<TStock, TRarity> = {
  stock: TStock;
  rarity: TRarity;
  winning: boolean;
};

export const CASE_REVEAL_TIMING = { introMs: 2_000, spinMs: 6_000, lockMs: 200 } as const;
export const PACK_OPENING_INTRO_MS = CASE_REVEAL_TIMING.introMs;
export const CASE_WINNER_INDEX = 45;

export function reelPositionAt(start: number, target: number, progress: number) {
  const p = Math.max(0, Math.min(1, progress));
  return start + (target - start) * (1 - Math.pow(1 - p, 3));
}

// Transaction timing cannot alter this curve or start another animation.
export function fixedReelPosition(elapsedMs: number) {
  return reelPositionAt(10, CASE_WINNER_INDEX, elapsedMs / CASE_REVEAL_TIMING.spinMs);
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

export type CaseReelItem<TStock, TRarity> = {
  stock: TStock;
  rarity: TRarity;
  winning: boolean;
};

export const CASE_REVEAL_TIMING = { introMs: 450, spinMs: 6_500, lockMs: 650 } as const;
export const PACK_OPENING_INTRO_MS = 2_000;
export const MIN_PAID_SPIN_MS = 4_500;

// Positions are tile units, not pixels, so resizing cannot change the winner.
export function planReelLanding(position: number, replay: boolean, elapsedSpinMs = MIN_PAID_SPIN_MS) {
  const durationMs = replay ? CASE_REVEAL_TIMING.spinMs : Math.max(1_000, MIN_PAID_SPIN_MS - elapsedSpinMs);
  return { index: replay ? 45 : Math.ceil(position) + Math.max(4, Math.ceil(durationMs / 1_000 * 6)), durationMs };
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

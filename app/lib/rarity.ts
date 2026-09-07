export type RarityTier = {
  id: string;
  label: string;
  color: string;
  minUsd: number;
  maxUsdExclusive: number | null;
  weightBps: number | null;
};

export function rarityForValue(valueUsd: number, tiers: RarityTier[]) {
  if (!Number.isFinite(valueUsd) || valueUsd < 0) return tiers[0];
  return tiers.find((tier) => valueUsd >= tier.minUsd && (tier.maxUsdExclusive === null || valueUsd < tier.maxUsdExclusive)) || tiers[0];
}

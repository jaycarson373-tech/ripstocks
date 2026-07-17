export const AIRDROP_BATCH_TARGET = 15;
export const AIRDROP_REFILL_THRESHOLD = 3;
export const AIRDROP_TREASURY_SPEND_FRACTION = 0.75;

export function airdropLotBudget(lastHolderFeeClaim: number) {
  return Math.max(1, Math.min(30, Math.floor(lastHolderFeeClaim)));
}

export function planAirdropRestock(treasuryValue: number, lastHolderFeeClaim: number, packsReady: number) {
  if (packsReady > AIRDROP_REFILL_THRESHOLD) return { packBudget:0, packsToBuy:0, spendBudget:0 };
  const packBudget = airdropLotBudget(lastHolderFeeClaim);
  const slots = Math.max(0, AIRDROP_BATCH_TARGET - packsReady);
  const spendBudget = Math.max(0, treasuryValue * AIRDROP_TREASURY_SPEND_FRACTION);
  const packsToBuy = Math.min(slots, Math.floor(spendBudget / packBudget));
  return { packBudget, packsToBuy, spendBudget: packsToBuy * packBudget };
}

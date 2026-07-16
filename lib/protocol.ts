export const AIRDROP_INTERVAL_MINUTES = 20 as const;
export const AIRDROP_INTERVAL_MS = AIRDROP_INTERVAL_MINUTES * 60 * 1000;
export const HOLDER_AIRDROP_FEE_BPS = 7_500 as const;
export const PACK_EV_RESERVE_FEE_BPS = 2_500 as const;

export const PROTOCOL_WALLET_ENV = {
  mainTreasury: "MAIN_TREASURY_WALLET",
  holderAirdrop: "HOLDER_AIRDROP_WALLET",
} as const;

export type ProtocolSnapshot = {
  serverNow: string;
  epochEndsAt: string;
  packInventoryValue: number;
  remainingStockInventory: number;
  packsRemaining: number;
  totalPacksOpened: number;
  inventoryPurchases: number;
  inventoryAssets: number;
  holderAirdropTreasury: number;
  holderPacksAvailable: number;
  averageHolderDropValue: number;
  packEvReserve: number;
  currentPackEv: number;
  totalHolderDrops: number;
  totalValueAirdropped: number;
  proofs: Array<{winner:string;pack:string;stock:string;value:number;time:string;signature:string}>;
  recentPacks: Array<{wallet:string;pack:string;stock:string;value:number;time:string;paymentSignature:string;fulfillmentSignature:string}>;
};

export function synchronizedEpochEndsAt(now = Date.now()) {
  return new Date((Math.floor(now / AIRDROP_INTERVAL_MS) + 1) * AIRDROP_INTERVAL_MS);
}

export function calculatePackEv(remainingStockInventory: number, packsRemaining: number) {
  return packsRemaining > 0 ? remainingStockInventory / packsRemaining : 0;
}

export const emptySnapshot = (): ProtocolSnapshot => ({
  serverNow: new Date().toISOString(), epochEndsAt: synchronizedEpochEndsAt().toISOString(),
  packInventoryValue: 0, remainingStockInventory: 0, packsRemaining: 0,
  totalPacksOpened: 0, inventoryPurchases: 0, inventoryAssets: 0,
  holderAirdropTreasury: 0, holderPacksAvailable: 0, averageHolderDropValue: 0, packEvReserve: 0, currentPackEv: 0,
  totalHolderDrops: 0, totalValueAirdropped: 0, proofs: [], recentPacks: [],
});

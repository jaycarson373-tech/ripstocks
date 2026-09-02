export type StockToken = {
  symbol: string;
  name: string;
  address: `0x${string}`;
  logoUrl: string;
  color: string;
};

// The pack contract and fee worker use this same ten-token launch rotation.
// Route availability is still verified by 0x at execution time.
export const STOCK_TOKENS: StockToken[] = [
  { symbol: "SPY", name: "SPDR S&P 500 ETF", address: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", logoUrl: "/stock-logos/spy.png", color: "#21a179" },
  { symbol: "AAPL", name: "Apple", address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", logoUrl: "/stock-logos/aapl.png", color: "#f4f7ee" },
  { symbol: "NVDA", name: "NVIDIA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", logoUrl: "/stock-logos/nvda.png", color: "#76b900" },
  { symbol: "TSLA", name: "Tesla", address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", logoUrl: "/stock-logos/tsla.png", color: "#e82127" },
  { symbol: "MSFT", name: "Microsoft", address: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", logoUrl: "/stock-logos/msft.png", color: "#00a4ef" },
  { symbol: "GOOGL", name: "Alphabet", address: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", logoUrl: "/stock-logos/googl.png", color: "#4285f4" },
  { symbol: "AMZN", name: "Amazon", address: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", logoUrl: "/stock-logos/amzn.png", color: "#ff9900" },
  { symbol: "META", name: "Meta Platforms", address: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", logoUrl: "/stock-logos/meta.png", color: "#168aff" },
  { symbol: "QQQ", name: "Invesco QQQ", address: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68", logoUrl: "/stock-logos/qqq.png", color: "#4c68d7" },
  { symbol: "COIN", name: "Coinbase", address: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b", logoUrl: "/stock-logos/coin.png", color: "#1652f0" },
];

export const STOCK_TOKEN_BY_ADDRESS = new Map(
  STOCK_TOKENS.map((stock) => [stock.address.toLowerCase(), stock]),
);

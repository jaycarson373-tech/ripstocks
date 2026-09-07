export type StockToken = {
  symbol: string;
  name: string;
  address: `0x${string}`;
  logoUrl: string;
  color: string;
};

// Official active Robinhood Chain Stock Tokens. HOOD is intentionally absent:
// Robinhood's asset registry does not currently publish a HOOD Stock Token.
export const STOCK_TOKENS: StockToken[] = [
  { symbol: "SPY", name: "SPDR S&P 500 ETF Trust", address: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", logoUrl: "/stock-logos/spy.png", color: "#21a179" },
  { symbol: "NVDA", name: "NVIDIA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", logoUrl: "/stock-logos/nvda.png", color: "#76b900" },
  { symbol: "TSLA", name: "Tesla", address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", logoUrl: "/stock-logos/tsla.png", color: "#e82127" },
  { symbol: "GME", name: "GameStop", address: "0x1b0E319c6A659F002271B69dB8A7df2F911c153E", logoUrl: "/stock-logos/gme.svg", color: "#e51b23" },
  { symbol: "PLTR", name: "Palantir Technologies", address: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A", logoUrl: "/stock-logos/pltr.svg", color: "#f4f7ee" },
  { symbol: "COIN", name: "Coinbase", address: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b", logoUrl: "/stock-logos/coin.png", color: "#1652f0" },
  { symbol: "RKLB", name: "Rocket Lab", address: "0x3b14C39E89D60D627b42a1A4CA45b5bb45Fc12e2", logoUrl: "/stock-logos/rklb.svg", color: "#f4f7ee" },
  { symbol: "SPCX", name: "SpaceX Class A", address: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa", logoUrl: "/stock-logos/spcx.svg", color: "#f4f7ee" },
  { symbol: "AAPL", name: "Apple", address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", logoUrl: "/stock-logos/aapl.png", color: "#f4f7ee" },
  { symbol: "MRVL", name: "Marvell Technology", address: "0x62fd0668e10D8B72339BE2DCF7643001688ff13B", logoUrl: "/stock-logos/mrvl.svg", color: "#d71920" },
];

export const STOCK_TOKEN_BY_ADDRESS = new Map(
  STOCK_TOKENS.map((stock) => [stock.address.toLowerCase(), stock]),
);

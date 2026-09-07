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
  { symbol: "SPY", name: "SPDR S&P 500 ETF Trust", address: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0x117cc2133c37b721f49de2a7a74833232b3b4c0c.png", color: "#21a179" },
  { symbol: "NVDA", name: "NVIDIA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec.png", color: "#76b900" },
  { symbol: "TSLA", name: "Tesla", address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0x322f0929c4625ed5bad873c95208d54e1c003b2d.png", color: "#e82127" },
  { symbol: "GME", name: "GameStop", address: "0x1b0E319c6A659F002271B69dB8A7df2F911c153E", logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0x1b0e319c6a659f002271b69db8a7df2f911c153e.png", color: "#e51b23" },
  { symbol: "PLTR", name: "Palantir Technologies", address: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A", logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a.png", color: "#f4f7ee" },
  { symbol: "COIN", name: "Coinbase", address: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b", logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0x6330d8c3178a418788df01a47479c0ce7ccf450b.png", color: "#1652f0" },
  { symbol: "RKLB", name: "Rocket Lab", address: "0x3b14C39E89D60D627b42a1A4CA45b5bb45Fc12e2", logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0x3b14c39e89d60d627b42a1a4ca45b5bb45fc12e2.png", color: "#f4f7ee" },
  { symbol: "SPCX", name: "SpaceX Class A", address: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa", logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea.png", color: "#f4f7ee" },
  { symbol: "AAPL", name: "Apple", address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0xaf3d76f1834a1d425780943c99ea8a608f8a93f9.png", color: "#f4f7ee" },
];

export const STOCK_TOKEN_BY_ADDRESS = new Map(
  STOCK_TOKENS.map((stock) => [stock.address.toLowerCase(), stock]),
);

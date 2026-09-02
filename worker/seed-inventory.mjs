import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CANONICAL_SPY,
  ROBINHOOD_CHAIN_ID,
  STOCK_TOKENS,
  addressEnv,
  decimalToScaled,
  required,
  usdMicrosForTokenAmount,
} from "./pons-core.mjs";

const DEFAULT_PRIZE_VALUES = [5, 10, 15, 20, 20, 25, 30, 35, 40, 50];
const robinhood = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});
const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
]);
const packAbi = parseAbi([
  "function owner() view returns (address)",
  "function treasury() view returns (address)",
  "function packsEnabled() view returns (bool)",
  "function activeRequestId() view returns (uint256)",
  "function inventoryCount() view returns (uint256)",
  "function approvedStock(address token) view returns (bool)",
  "function loadPrize(address token,uint256 tokenAmount,uint256 declaredUsdMicros)",
]);

function output(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({ event, ...fields })}\n`);
}

function privateKey(value) {
  const raw = required("AUTOMATION_PRIVATE_KEY", value);
  const normalized = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) throw new Error("AUTOMATION_PRIVATE_KEY must be a 32-byte hex key");
  return normalized;
}

function prizeValues(value) {
  if (!value?.trim()) return DEFAULT_PRIZE_VALUES;
  const values = value.split(",").map((item) => Number(item.trim()));
  if (values.length !== STOCK_TOKENS.length || values.some((item) => !Number.isFinite(item) || item <= 0)) {
    throw new Error(`INITIAL_PRIZE_USD_VALUES must contain ${STOCK_TOKENS.length} positive USD values`);
  }
  return values;
}

async function tokenBalance(publicClient, token, account) {
  return publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account] });
}

async function waitForSuccess(publicClient, hash, timeout = 180_000) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2, timeout });
  if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
  return receipt;
}

async function approve(publicClient, walletClient, account, token, spender, amount) {
  const allowance = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account.address, spender] });
  if (allowance >= amount) return null;
  const hash = await walletClient.writeContract({ account, address: token, abi: erc20Abi, functionName: "approve", args: [spender, amount] });
  await waitForSuccess(publicClient, hash);
  return hash;
}

async function zeroX(cfg, account, endpoint, buyToken, sellAmount) {
  const query = new URLSearchParams({
    chainId: String(ROBINHOOD_CHAIN_ID),
    sellToken: getAddress(CANONICAL_SPY),
    buyToken,
    sellAmount: sellAmount.toString(),
    taker: account.address,
    slippageBps: String(cfg.slippageBps),
  });
  const response = await fetch(`https://api.0x.org/swap/allowance-holder/${endpoint}?${query}`, {
    headers: { "0x-api-key": cfg.zeroXKey, "0x-version": "v2" },
  });
  if (!response.ok) throw new Error(`0x ${endpoint} ${response.status}: ${await response.text()}`);
  const quote = await response.json();
  if (quote.liquidityAvailable === false || !quote.buyAmount) throw new Error("0x returned no Stock Token liquidity");
  return quote;
}

async function prices() {
  const [assetsResponse, ...priceResponses] = await Promise.all([
    fetch("https://api.robinhood.com/rhj/assets"),
    ...STOCK_TOKENS.map((stock) => fetch(`https://api.robinhood.com/rhj/prices/${stock.symbol}`)),
  ]);
  if (!assetsResponse.ok || priceResponses.some((response) => !response.ok)) throw new Error("Robinhood Stock Token pricing is unavailable");
  const assets = (await assetsResponse.json()).assets || [];
  const result = new Map();
  for (let index = 0; index < STOCK_TOKENS.length; index += 1) {
    const stock = STOCK_TOKENS[index];
    const quotes = (await priceResponses[index].json()).quotes || [];
    const quote = quotes.find((item) => item.tokenSymbol === stock.symbol);
    const asset = assets.find((item) => item.tokenSymbol === stock.symbol);
    if (!quote?.bid || !quote?.ask || !asset?.currentMultiplier || quote.isTradingHalt) throw new Error(`${stock.symbol} is not currently priceable`);
    result.set(stock.symbol, { bid: quote.bid, ask: quote.ask, multiplier: asset.currentMultiplier });
  }
  return result;
}

function quoteAtomsForUsd(usd, spyPrice) {
  const usdMicros = decimalToScaled(usd, 6);
  const priceMicros = decimalToScaled(spyPrice.ask, 6);
  const multiplierAtoms = decimalToScaled(spyPrice.multiplier, 18);
  const numerator = usdMicros * 10n ** 36n;
  const denominator = priceMicros * multiplierAtoms;
  return (numerator + denominator - 1n) / denominator;
}

async function main() {
  if (process.env.SEED_INVENTORY_CONFIRM !== "I_UNDERSTAND") throw new Error("Set SEED_INVENTORY_CONFIRM=I_UNDERSTAND only for the confirmed funded mainnet seed");
  const cfg = {
    rpcUrl: process.env.ROBINHOOD_RPC_URL?.trim() || robinhood.rpcUrls.default.http[0],
    packContract: addressEnv("STOCKRIPS_PACK_CONTRACT", process.env.STOCKRIPS_PACK_CONTRACT),
    zeroXKey: required("ZEROX_API_KEY", process.env.ZEROX_API_KEY),
    slippageBps: Number.parseInt(process.env.ZEROX_SLIPPAGE_BPS || "100", 10),
    values: prizeValues(process.env.INITIAL_PRIZE_USD_VALUES),
  };
  const account = privateKeyToAccount(privateKey(process.env.AUTOMATION_PRIVATE_KEY));
  const transport = http(cfg.rpcUrl, { retryCount: 3, retryDelay: 1_000, timeout: 30_000 });
  const publicClient = createPublicClient({ chain: robinhood, transport });
  const walletClient = createWalletClient({ account, chain: robinhood, transport });
  if (await publicClient.getChainId() !== ROBINHOOD_CHAIN_ID) throw new Error("RPC is not Robinhood Chain mainnet");

  const [owner, treasury, packsEnabled, activeRequestId, inventoryCount] = await Promise.all([
    publicClient.readContract({ address: cfg.packContract, abi: packAbi, functionName: "owner" }),
    publicClient.readContract({ address: cfg.packContract, abi: packAbi, functionName: "treasury" }),
    publicClient.readContract({ address: cfg.packContract, abi: packAbi, functionName: "packsEnabled" }),
    publicClient.readContract({ address: cfg.packContract, abi: packAbi, functionName: "activeRequestId" }),
    publicClient.readContract({ address: cfg.packContract, abi: packAbi, functionName: "inventoryCount" }),
  ]);
  if (getAddress(owner) !== account.address || getAddress(treasury) !== account.address) throw new Error("Automation wallet must own and fund the pack contract");
  if (packsEnabled || activeRequestId !== 0n) throw new Error("Seed only while packs are disabled and no request is active");
  if (inventoryCount !== 0n && process.env.ALLOW_NONEMPTY_SEED !== "true") throw new Error("Inventory is not empty; refusing to duplicate the initial seed");

  const priceMap = await prices();
  const spyPrice = priceMap.get("SPY");
  const plans = cfg.values.map((usd, index) => ({
    stock: STOCK_TOKENS[index],
    targetUsd: usd,
    sellAmount: quoteAtomsForUsd(usd, spyPrice),
  }));
  const totalSell = plans.reduce((sum, plan) => sum + plan.sellAmount, 0n);
  const available = await tokenBalance(publicClient, getAddress(CANONICAL_SPY), account.address);
  if (available < totalSell) throw new Error("Automation wallet does not hold enough canonical SPY for the configured seed schedule");

  await Promise.all(plans.map(async (plan) => {
    const approved = await publicClient.readContract({ address: cfg.packContract, abi: packAbi, functionName: "approvedStock", args: [plan.stock.address] });
    if (!approved) throw new Error(`${plan.stock.symbol} is not approved by the pack contract`);
    if (plan.stock.address !== getAddress(CANONICAL_SPY)) await zeroX(cfg, account, "price", plan.stock.address, plan.sellAmount);
  }));

  for (const plan of plans) {
    let amount = plan.sellAmount;
    let swapTransaction = null;
    if (plan.stock.address !== getAddress(CANONICAL_SPY)) {
      const quote = await zeroX(cfg, account, "quote", plan.stock.address, plan.sellAmount);
      const spender = quote.issues?.allowance?.spender || quote.allowanceTarget;
      if (!spender || !quote.transaction?.to || !quote.transaction?.data) throw new Error(`0x omitted executable fields for ${plan.stock.symbol}`);
      await approve(publicClient, walletClient, account, getAddress(CANONICAL_SPY), getAddress(spender), plan.sellAmount);
      const before = await tokenBalance(publicClient, plan.stock.address, account.address);
      swapTransaction = await walletClient.sendTransaction({
        account,
        to: getAddress(quote.transaction.to),
        data: quote.transaction.data,
        value: BigInt(quote.transaction.value || "0"),
        gas: quote.transaction.gas ? BigInt(quote.transaction.gas) : undefined,
      });
      await waitForSuccess(publicClient, swapTransaction);
      amount = (await tokenBalance(publicClient, plan.stock.address, account.address)) - before;
      if (amount <= 0n || amount < BigInt(quote.minBuyAmount || 0)) throw new Error(`${plan.stock.symbol} output was below its quoted minimum`);
    }
    const stockPrice = priceMap.get(plan.stock.symbol);
    const declaredUsdMicros = usdMicrosForTokenAmount(amount, stockPrice.bid, stockPrice.multiplier, 18);
    await approve(publicClient, walletClient, account, plan.stock.address, cfg.packContract, amount);
    const loadTransaction = await walletClient.writeContract({
      account,
      address: cfg.packContract,
      abi: packAbi,
      functionName: "loadPrize",
      args: [plan.stock.address, amount, declaredUsdMicros],
    });
    await waitForSuccess(publicClient, loadTransaction);
    output("seed_prize_loaded", {
      symbol: plan.stock.symbol,
      targetUsd: plan.targetUsd,
      tokenAmountAtoms: amount.toString(),
      declaredUsdMicros: declaredUsdMicros.toString(),
      swapTransaction,
      loadTransaction,
    });
  }
  output("seed_inventory_complete", { fundedPacksAdded: plans.length, packsRemainDisabled: true });
}

main().catch((error) => {
  output("seed_inventory_failed", { reason: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});

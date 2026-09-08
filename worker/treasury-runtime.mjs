import { randomUUID } from "node:crypto";
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, getAddress, http, parseAbi, parseAbiItem } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { addressEnv, basisPoints, parseMode, positiveInteger, required, usdMicrosForTokenAmount, discoverContractStartBlock } from "./pons-core.mjs";
import { CANONICAL_USDG } from "./pons-core.mjs";
import { holderRewardsConfig, packConfig } from "./pack-config.mjs";
import { supabaseHeaders } from "./supabase-headers.mjs";
import { ReinvestmentStore, ReinvestmentReverted, durableTransaction, processReinvestmentLot, saleFromReceipt } from "./pack-reinvestment.mjs";
import { quoteDirectV4 } from "./uniswap-v4.mjs";

export const chain = defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } } });
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const pendingPackSeenAt = new Map();

async function fetchLiveJson(url) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (response.ok) return response.json();
    if (response.status !== 429 && response.status < 500) throw new Error("Live stock valuation unavailable");
    if (attempt < 3) await wait(750 * (2 ** attempt));
  }
  throw new Error("Live stock valuation unavailable");
}
const packAbi = parseAbi([
  "function owner() view returns (address)", "function treasury() view returns (address)",
  "function packPrice() view returns (uint256)", "function approvedStock(address) view returns (bool)",
  "function activeRequestId() view returns (uint256)",
  "function requests(uint256) view returns (address,bytes32,bytes32,uint256,bool)",
  "function settlePack(uint256) returns (address,uint256,uint256)"
]);
const delivery = parseAbiItem("event PrizeDelivered(uint256 indexed requestId,address indexed buyer,address indexed token,uint256 tokenAmount,uint256 declaredUsdMicros)");

export function treasuryConfig(env = process.env, forceMode) {
  const mode = parseMode(forceMode || env.AUTOMATION_MODE || "off");
  const pollSeconds = Number(env.WORKER_POLL_SECONDS || 30);
  if (!Number.isSafeInteger(pollSeconds) || pollSeconds < 5 || pollSeconds > 300) throw new Error("WORKER_POLL_SECONDS must be 5–300");
  const settlementDelaySeconds = positiveInteger("PACK_SETTLEMENT_DELAY_SECONDS", env.PACK_SETTLEMENT_DELAY_SECONDS, 12);
  if (settlementDelaySeconds > 60) throw new Error("PACK_SETTLEMENT_DELAY_SECONDS must be 60 or less");
  if (mode === "off") return { mode, pollSeconds, ponsEnabled: false };
  const pack = packConfig(env.PACK_ID);
  let signerKey = required("AUTOMATION_PRIVATE_KEY", env.AUTOMATION_PRIVATE_KEY);
  if (!signerKey.startsWith("0x")) signerKey = `0x${signerKey}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(signerKey)) throw new Error("AUTOMATION_PRIVATE_KEY must be a 32-byte EVM key");
  const database = new URL(required("SUPABASE_URL", env.SUPABASE_URL));
  if (database.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(database.hostname) || database.username || database.password || database.port || database.search || database.hash || !["", "/"].includes(database.pathname)) throw new Error("Invalid Supabase project URL");
  const swapProvider = (env.SWAP_PROVIDER || "uniswap-v4").trim();
  if (!["uniswap-v4", "0x"].includes(swapProvider)) throw new Error("SWAP_PROVIDER must be uniswap-v4 or 0x");
  const slippageBps = Number(env.SWAP_SLIPPAGE_BPS || env.ZEROX_SLIPPAGE_BPS || 100);
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 500) throw new Error("SWAP_SLIPPAGE_BPS must be 0–500");
  const claimsEnabled = env.CREATOR_FEE_CLAIM_ENABLED === "true";
  const rewardsEnabled = env.HOLDER_REWARDS_ENABLED === "true";
  if (claimsEnabled !== rewardsEnabled) throw new Error("Creator fee claims and holder rewards must be enabled together after the Pons dry run");
  const ponsEnabled = claimsEnabled && rewardsEnabled;
  const pons = ponsEnabled ? {
    token: addressEnv("PONS_TOKEN_ADDRESS", env.PONS_TOKEN_ADDRESS),
    tokenStartBlock: BigInt(required("PONS_TOKEN_START_BLOCK", env.PONS_TOKEN_START_BLOCK)),
    factory: addressEnv("PONS_V2_FACTORY", env.PONS_V2_FACTORY),
    escrow: addressEnv("PONS_FEE_ESCROW", env.PONS_FEE_ESCROW),
    feeAsset: addressEnv("PONS_FEE_ASSET_ADDRESS", env.PONS_FEE_ASSET_ADDRESS),
    tokensPerTicket: required("TOKENS_PER_TICKET", env.TOKENS_PER_TICKET || holderRewardsConfig().tokensPerTicket),
    holderShareBps: basisPoints("HOLDER_DROP_SHARE_BPS", env.HOLDER_DROP_SHARE_BPS, 5_000),
    confirmationBlocks: positiveInteger("PONS_CONFIRMATION_BLOCKS", env.PONS_CONFIRMATION_BLOCKS, 12),
    exclusions: (env.PONS_HOLDER_EXCLUSIONS || "").split(",").map(value => value.trim()).filter(Boolean).map(value => addressEnv("PONS_HOLDER_EXCLUSIONS", value)),
  } : null;
  if (pons && pons.feeAsset.toLowerCase() !== CANONICAL_USDG.toLowerCase()) throw new Error("The first verified Pons automation release requires a USDG-paired launch");
  return { ...pack, mode, pollSeconds, settlementDelaySeconds, signerKey, ponsEnabled, pons,
    rpcUrl: env.ROBINHOOD_RPC_URL?.trim() || chain.rpcUrls.default.http[0],
    packContract: addressEnv("STOCKRIPS_PACK_CONTRACT", env.STOCKRIPS_PACK_CONTRACT),
    packStartBlock: env.PACK_CONTRACT_START_BLOCK ? BigInt(env.PACK_CONTRACT_START_BLOCK) : null,
    swapProvider, zeroXKey: swapProvider === "0x" ? required("ZEROX_API_KEY", env.ZEROX_API_KEY) : null, slippageBps,
    supabaseUrl: database.origin, supabaseKey: required("SUPABASE_SERVICE_ROLE_KEY", env.SUPABASE_SERVICE_ROLE_KEY),
    reinvestEnabled: env.PACK_RECEIPT_REINVEST_ENABLED === "true"
  };
}

export class TreasuryAudit {
  constructor(cfg) { this.url = cfg.supabaseUrl; this.key = cfg.supabaseKey; }
  async request(path, init = {}) {
    const response = await fetch(`${this.url}/rest/v1/${path}`, { ...init, redirect: "error", signal: AbortSignal.timeout(15000), headers: { ...supabaseHeaders(this.key), "Content-Type": "application/json", ...init.headers } });
    if (!response.ok) throw new Error(`Treasury database request failed (HTTP ${response.status})`);
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  }
  acquire(holder) { return this.request("rpc/acquire_automation_lock", { method: "POST", body: JSON.stringify({ p_holder: holder, p_ttl_seconds: 900 }) }); }
  release(holder) { return this.request("rpc/release_automation_lock", { method: "POST", body: JSON.stringify({ p_holder: holder }) }); }
}
export function treasuryContext(cfg) {
  const account = privateKeyToAccount(cfg.signerKey);
  const transport = http(cfg.rpcUrl, { retryCount: 2, timeout: 20000 });
  const audit = new TreasuryAudit(cfg);
  const holder = `${account.address}:${randomUUID()}`;
  return { cfg, account, audit, holder, scope: `4663:${cfg.packContract.toLowerCase()}:${account.address.toLowerCase()}`,
    publicClient: createPublicClient({ chain, transport }), walletClient: createWalletClient({ account, chain, transport }),
    store: new ReinvestmentStore(audit),
    lease: async () => { if (!await audit.acquire(holder)) throw new Error("Another treasury operation holds the lease"); },
    log: (event, fields = {}) => console.log(JSON.stringify({ event, ...fields })),
    quote: async (sellToken, buyToken, amount) => {
      if (cfg.swapProvider === "uniswap-v4") return quoteDirectV4({ publicClient: createPublicClient({ chain, transport }), account: account.address, sellToken, buyToken, amount, slippageBps: cfg.slippageBps });
      const query = new URLSearchParams({ chainId: "4663", sellToken, buyToken, sellAmount: amount.toString(), taker: account.address, slippageBps: String(cfg.slippageBps) });
      const response = await fetch(`https://api.0x.org/swap/allowance-holder/quote?${query}`, { headers: { "0x-api-key": cfg.zeroXKey, "0x-version": "v2" }, signal: AbortSignal.timeout(20000), redirect: "error" });
      if (!response.ok) throw new Error(`0x quote unavailable (HTTP ${response.status})`);
      const quote = await response.json();
      const spender = quote.issues?.allowance?.spender || quote.allowanceTarget;
      if (quote.liquidityAvailable === false || !quote.transaction?.to || !quote.transaction?.data || !spender) throw new Error("No executable stock route");
      return { ...quote, spender: getAddress(spender), transaction: { ...quote.transaction, to: getAddress(quote.transaction.to) } };
    },
    stockValue: async (stock, amount) => {
      const [prices, assets] = await Promise.all([
        fetchLiveJson(`https://api.robinhood.com/rhj/prices/${stock.symbol}`),
        fetchLiveJson("https://api.robinhood.com/rhj/assets"),
      ]);
      const quote = prices.quotes?.find(item => item.tokenSymbol === stock.symbol);
      const asset = assets.assets?.find(item => item.tokenSymbol === stock.symbol);
      if (!quote?.bid || !asset?.currentMultiplier || quote.isTradingHalt) throw new Error("Stock has no usable current valuation");
      return usdMicrosForTokenAmount(amount, quote.bid, asset.currentMultiplier, 18);
    }
  };
}

export async function validateTreasury(ctx) {
  if (await ctx.publicClient.getChainId() !== 4663) throw new Error("RPC is not Robinhood Chain 4663");
  const read = functionName => ctx.publicClient.readContract({ address: ctx.cfg.packContract, abi: packAbi, functionName });
  const [owner, treasury, price] = await Promise.all([read("owner"), read("treasury"), read("packPrice")]);
  if (getAddress(owner) !== ctx.account.address || getAddress(treasury) !== ctx.account.address) throw new Error("Treasury signer must own this pack contract and receive its settled USDG");
  if (price !== ctx.cfg.priceAtoms) throw new Error("Pack contract price differs from catalog; refusing to operate");
  for (const stock of ctx.cfg.stocks) {
    if (!await ctx.publicClient.readContract({ address: ctx.cfg.packContract, abi: packAbi, functionName: "approvedStock", args: [stock.address] })) throw new Error("Configured Stock Token is not approved by pack contract");
  }
}

export async function recoverTreasuryTransaction(ctx) {
  const pending = await ctx.store.pendingTransaction(ctx.scope);
  if (!pending) return;
  if (ctx.cfg.mode !== "live") throw new Error("Pending signed treasury transaction requires live reconciliation; dry run sends nothing");
  if (pending.lot_id.includes(":pons:")) {
    const epoch = (await ctx.store.rows("pons_hourly_epochs", `id=eq.${encodeURIComponent(pending.lot_id)}&limit=1`))?.[0];
    const expectedScope = ctx.cfg.ponsEnabled ? `4663:pons:${ctx.cfg.pons.token.toLowerCase()}:${ctx.account.address.toLowerCase()}` : "";
    if (!ctx.cfg.ponsEnabled || !epoch || epoch.scope !== expectedScope) throw new Error("Signed Pons transaction has no matching enabled epoch");
  } else if (pending.lot_id.startsWith(`${ctx.scope}:purchase:`)) {
    const purchase = (await ctx.store.rows("treasury_purchases", `id=eq.${encodeURIComponent(pending.lot_id)}&limit=1`))?.[0];
    if (!purchase || purchase.scope !== ctx.scope) throw new Error("Signed purchase has no matching treasury budget");
  } else if (pending.lot_id.startsWith(`${ctx.scope}:settle:`)) {
    if (pending.step !== "settle") throw new Error("Invalid settlement journal operation");
  } else {
    if (!ctx.cfg.reinvestEnabled) throw new Error("Pending restock is paused; review before re-enabling receipt reinvestment");
    const epoch = await ctx.store.pending(ctx.scope);
    if (!epoch || !(await ctx.store.lots(epoch.id)).some(lot => lot.id === pending.lot_id)
      || (await ctx.publicClient.getBlock({ blockNumber: BigInt(epoch.scan_to_block) })).hash !== epoch.scan_block_hash) throw new Error("Signed restock has no canonical reserved sale budget");
  }
  try { await durableTransaction(ctx, { id: pending.lot_id }, pending.step, () => { throw new Error("Must reuse persisted signed transaction"); }); }
  catch (error) { if (!(error instanceof ReinvestmentReverted)) throw error; }
}

export async function resumeTreasuryPurchase(ctx, purchase) {
  const store = Object.create(ctx.store);
  store.patch = (table, id, patch) => ctx.store.patch(table === "pack_reinvestment_lots" ? "treasury_purchases" : table, id, patch);
  await processReinvestmentLot({ ...ctx, store }, { id: purchase.id, epoch_key: purchase.id }, purchase);
}

export async function settlePendingPack(ctx) {
  const id = await ctx.publicClient.readContract({ address: ctx.cfg.packContract, abi: packAbi, functionName: "activeRequestId" });
  if (!id) { pendingPackSeenAt.clear(); return; }
  const pendingKey = `${ctx.scope}:${id}`;
  const firstSeenAt = pendingPackSeenAt.get(pendingKey);
  if (!firstSeenAt) { pendingPackSeenAt.set(pendingKey, Date.now()); return; }
  if (Date.now() - firstSeenAt < ctx.cfg.settlementDelaySeconds * 1000) return;
  const request = await ctx.publicClient.readContract({ address: ctx.cfg.packContract, abi: packAbi, functionName: "requests", args: [id] });
  // The operator settles as soon as the future-block outcome is available so
  // buyers never need a second wallet transaction to receive their prize.
  if (request[4] || await ctx.publicClient.getBlockNumber() <= request[3]) return;
  try {
    await durableTransaction(ctx, { id: `${ctx.scope}:settle:${id}`, scope: ctx.scope }, "settle", async () => {
      await ctx.publicClient.simulateContract({ account: ctx.account, address: ctx.cfg.packContract, abi: packAbi, functionName: "settlePack", args: [id] });
      return { to: ctx.cfg.packContract, data: encodeFunctionData({ abi: packAbi, functionName: "settlePack", args: [id] }), value: 0n };
    });
    pendingPackSeenAt.delete(pendingKey);
  } catch (error) {
    if ((error.shortMessage || error.message || "").includes("ENTROPY_NOT_READY")) return;
    if (!(error instanceof ReinvestmentReverted)) throw error;
  }
}

export async function indexSettlements(ctx) {
  const latest = await ctx.publicClient.getBlockNumber();
  if (latest < 12n) return;
  const last = (await ctx.store.rows("pack_settlements", `scope=eq.${encodeURIComponent(ctx.scope)}&order=block_number.desc&limit=1`))?.[0];
  if (last && (await ctx.publicClient.getBlock({ blockNumber: BigInt(last.block_number) })).hash !== last.block_hash) throw new Error("Settlement checkpoint reorganized; operator reconciliation required");
  const start = last ? BigInt(last.block_number) : ctx.cfg.packStartBlock ?? await discoverContractStartBlock(latest, blockNumber => ctx.publicClient.getBytecode({ address: ctx.cfg.packContract, blockNumber }));
  const end = latest - 12n;
  for (let from = start; from <= end; from += 2000n) {
    await ctx.lease();
    const logs = await ctx.publicClient.getLogs({ address: ctx.cfg.packContract, event: delivery, fromBlock: from, toBlock: from + 1999n > end ? end : from + 1999n });
    for (const log of logs) {
      if (log.removed) throw new Error("Removed settlement log");
      const receipt = await ctx.publicClient.getTransactionReceipt({ hash: log.transactionHash });
      if (receipt.blockHash !== log.blockHash || receipt.blockNumber > end) throw new Error("Settlement changed during indexing");
      const sale = saleFromReceipt(receipt, ctx.cfg.packContract, ctx.account.address, ctx.cfg.priceAtoms);
      if (!sale) throw new Error("Delivered event does not reconcile with actual USDG payment and Stock Token transfer");
      if ((await ctx.publicClient.getBlock({ blockNumber: receipt.blockNumber })).hash !== receipt.blockHash) throw new Error("Settlement is not canonical");
      if (ctx.cfg.mode === "live") await ctx.audit.request("pack_settlements", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ id: `${ctx.scope}:${sale.request_id}`, scope: ctx.scope, ...sale }) });
      else ctx.log("verified_settlement_dry_run", { transactionHash: sale.transaction_hash });
    }
  }
}

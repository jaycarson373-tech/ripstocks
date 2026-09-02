import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  parseAbi,
  parseAbiItem,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CANONICAL_SPY,
  PONS_V2_FACTORY,
  PONS_V2_FEE_ESCROW,
  addressEnv,
  applyTransfers,
  basisPoints,
  deriveSeed,
  deterministicStockOrder,
  epochKey,
  parseMode,
  positiveInteger,
  required,
  splitAmount,
  ticketUnit,
  usdMicrosForTokenAmount,
  weightedWinner,
} from "./pons-core.mjs";

const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

const factoryAbi = parseAbi([
  "function getLaunchedToken(address token) view returns ((address token,address curve,address deployer,address creatorFeeRecipient,address pairToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorTaxBps,bool buybackEnabled,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))",
]);
const escrowAbi = parseAbi([
  "function balanceOfToken(address recipient,address token) view returns (uint256)",
  "function claimToken(address token) returns (uint256 amount)",
]);
const curveAbi = parseAbi(["function sweepFees(uint256 minBuybackTokensOut)"]);
const erc20Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function transfer(address recipient,uint256 amount) returns (bool)",
]);
const packAbi = parseAbi([
  "function owner() view returns (address)",
  "function treasury() view returns (address)",
  "function approvedStock(address token) view returns (bool)",
  "function inventoryCount() view returns (uint256)",
  "function activeRequestId() view returns (uint256)",
  "function requests(uint256 requestId) view returns (address buyer,bytes32 commitment,bytes32 fallbackSeed,uint256 entropyBlock,bool settled)",
  "function settlePack(uint256 requestId) returns (address token,uint256 tokenAmount,uint256 declaredUsdMicros)",
  "function loadPrize(address token,uint256 tokenAmount,uint256 declaredUsdMicros)",
]);
const transferEvent = parseAbiItem("event Transfer(address indexed from,address indexed to,uint256 value)");
const TERMINAL = new Set(["complete", "no_fees", "dry_run"]);

function log(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function privateKey(value) {
  const raw = required("AUTOMATION_PRIVATE_KEY", value);
  const normalized = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) throw new Error("AUTOMATION_PRIVATE_KEY must be a 32-byte hex key");
  return normalized;
}

function readConfig() {
  const mode = parseMode(process.env.AUTOMATION_MODE || "off");
  const pollSeconds = positiveInteger("WORKER_POLL_SECONDS", process.env.WORKER_POLL_SECONDS, 60);
  if (mode === "off") return { mode, pollSeconds };
  const cfg = {
    mode,
    pollSeconds,
    rpcUrl: required("ROBINHOOD_RPC_URL", process.env.ROBINHOOD_RPC_URL),
    signerKey: privateKey(process.env.AUTOMATION_PRIVATE_KEY),
    ponsToken: addressEnv("PONS_TOKEN_ADDRESS", process.env.PONS_TOKEN_ADDRESS),
    ponsTokenStartBlock: BigInt(required("PONS_TOKEN_START_BLOCK", process.env.PONS_TOKEN_START_BLOCK)),
    packContract: addressEnv("STOCKRIPS_PACK_CONTRACT", process.env.STOCKRIPS_PACK_CONTRACT),
    ponsFactory: addressEnv("PONS_V2_FACTORY", process.env.PONS_V2_FACTORY || PONS_V2_FACTORY),
    feeEscrow: addressEnv("PONS_FEE_ESCROW", process.env.PONS_FEE_ESCROW || PONS_V2_FEE_ESCROW),
    quoteToken: addressEnv("PONS_QUOTE_TOKEN", process.env.PONS_QUOTE_TOKEN || CANONICAL_SPY),
    zeroXKey: required("ZEROX_API_KEY", process.env.ZEROX_API_KEY),
    slippageBps: basisPoints("ZEROX_SLIPPAGE_BPS", process.env.ZEROX_SLIPPAGE_BPS, 100),
    supabaseUrl: required("SUPABASE_URL", process.env.SUPABASE_URL).replace(/\/$/, ""),
    supabaseKey: required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY),
    intervalMinutes: positiveInteger("DROP_INTERVAL_MINUTES", process.env.DROP_INTERVAL_MINUTES, 60),
    feeSplitBps: basisPoints("FEE_SPLIT_BPS", process.env.FEE_SPLIT_BPS, 5_000),
    tokensPerTicket: process.env.TOKENS_PER_TICKET || "250000",
    chunkSize: positiveInteger("HOLDER_LOG_CHUNK_SIZE", process.env.HOLDER_LOG_CHUNK_SIZE, 2_000),
    excluded: (process.env.HOLDER_EXCLUDE_ADDRESSES || "").split(",").map((value) => value.trim()).filter(Boolean).map(getAddress),
  };
  if (cfg.intervalMinutes !== 60) throw new Error("DROP_INTERVAL_MINUTES must remain 60 for the published hourly mechanic");
  if (cfg.feeSplitBps !== 5_000) throw new Error("FEE_SPLIT_BPS must remain 5000 for the published 50/50 split");
  if (cfg.quoteToken !== getAddress(CANONICAL_SPY)) throw new Error("PONS_QUOTE_TOKEN must be canonical SPY for this deployment");
  return cfg;
}

class AuditStore {
  constructor(url, key) {
    this.url = url;
    this.headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  }

  async request(path, init = {}) {
    const response = await fetch(`${this.url}/rest/v1/${path}`, { ...init, headers: { ...this.headers, ...init.headers } });
    if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async acquire(holder) {
    return this.request("rpc/acquire_automation_lock", { method: "POST", body: JSON.stringify({ p_holder: holder, p_ttl_seconds: 900 }) });
  }

  async release(holder) {
    await this.request("rpc/release_automation_lock", { method: "POST", body: JSON.stringify({ p_holder: holder }) });
  }

  async getEpoch(key) {
    const rows = await this.request(`pons_epochs?epoch_key=eq.${encodeURIComponent(key)}&select=*&limit=1`);
    return rows?.[0] || null;
  }

  async getPendingEpoch() {
    const statuses = "created,claiming,awaiting_seed,holder_drop_swap,holder_drop_send,inventory_swap,inventory_load";
    const rows = await this.request(`pons_epochs?status=in.(${statuses})&select=*&order=epoch_key.asc&limit=1`);
    return rows?.[0] || null;
  }

  async insertEpoch(row) {
    const rows = await this.request("pons_epochs", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify(row),
    });
    return rows?.[0] || this.getEpoch(row.epoch_key);
  }

  async updateEpoch(key, patch) {
    const rows = await this.request(`pons_epochs?epoch_key=eq.${encodeURIComponent(key)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    });
    if (!rows?.[0]) throw new Error(`Epoch ${key} disappeared during update`);
    return rows[0];
  }
}

function clients(cfg) {
  const account = privateKeyToAccount(cfg.signerKey);
  const transport = http(cfg.rpcUrl, { retryCount: 3, retryDelay: 1_000, timeout: 30_000 });
  return {
    account,
    publicClient: createPublicClient({ chain: robinhood, transport }),
    walletClient: createWalletClient({ account, chain: robinhood, transport }),
  };
}

async function validateOnchain(cfg, publicClient, account) {
  const launch = await publicClient.readContract({ address: cfg.ponsFactory, abi: factoryAbi, functionName: "getLaunchedToken", args: [cfg.ponsToken] });
  if (!launch.exists || getAddress(launch.token) !== cfg.ponsToken) throw new Error("PONS_TOKEN_ADDRESS is not a Pons v2 launch from the configured factory");
  if (getAddress(launch.pairToken) !== cfg.quoteToken) throw new Error("The Pons launch is not paired to canonical SPY");
  if (getAddress(launch.creatorFeeRecipient) !== account.address) throw new Error("The automation signer is not the Pons creator-fee recipient");
  const [owner, treasury] = await Promise.all([
    publicClient.readContract({ address: cfg.packContract, abi: packAbi, functionName: "owner" }),
    publicClient.readContract({ address: cfg.packContract, abi: packAbi, functionName: "treasury" }),
  ]);
  if (getAddress(owner) !== account.address) throw new Error("The automation signer is not the StonkRips pack-contract owner");
  if (getAddress(treasury) !== account.address) throw new Error("The pack treasury must be the same automation wallet for this configuration");
  return launch;
}

async function maybeSweepCurve(cfg, launch, publicClient, walletClient, account) {
  if (Number(launch.phase) !== 0 || launch.buybackEnabled || getAddress(launch.deployer) !== account.address) return null;
  const hash = await walletClient.writeContract({ account, address: getAddress(launch.curve), abi: curveAbi, functionName: "sweepFees", args: [0n] });
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000 });
  return hash;
}

async function settleReadyPack(cfg, publicClient, walletClient, account) {
  const requestId = await publicClient.readContract({ address: cfg.packContract, abi: packAbi, functionName: "activeRequestId" });
  if (requestId === 0n) return null;
  const request = await publicClient.readContract({ address: cfg.packContract, abi: packAbi, functionName: "requests", args: [requestId] });
  const entropyBlock = BigInt(request[3]);
  if (request[4] || await publicClient.getBlockNumber() <= entropyBlock) return null;
  const hash = await walletClient.writeContract({
    account,
    address: cfg.packContract,
    abi: packAbi,
    functionName: "settlePack",
    args: [requestId],
  });
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000 });
  log("pack_request_settled", { requestId: requestId.toString(), transactionHash: hash });
  return hash;
}

async function tokenBalance(publicClient, token, account) {
  return publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account] });
}

async function approveIfNeeded(publicClient, walletClient, account, token, spender, amount) {
  const allowance = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account.address, spender] });
  if (allowance >= amount) return null;
  const hash = await walletClient.writeContract({ account, address: token, abi: erc20Abi, functionName: "approve", args: [spender, amount] });
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000 });
  return hash;
}

async function zeroXQuote(cfg, account, sellToken, buyToken, sellAmount) {
  const query = new URLSearchParams({
    chainId: "4663",
    sellToken,
    buyToken,
    sellAmount: sellAmount.toString(),
    taker: account.address,
    slippageBps: String(cfg.slippageBps),
  });
  const response = await fetch(`https://api.0x.org/swap/allowance-holder/quote?${query}`, {
    headers: { "0x-api-key": cfg.zeroXKey, "0x-version": "v2" },
  });
  if (!response.ok) throw new Error(`0x quote ${response.status}: ${await response.text()}`);
  const quote = await response.json();
  if (quote.liquidityAvailable === false || !quote.transaction?.to || !quote.transaction?.data || !quote.buyAmount) throw new Error("0x returned no executable Stock Token liquidity");
  const spender = quote.issues?.allowance?.spender || quote.allowanceTarget;
  if (!spender) throw new Error("0x quote omitted its allowance spender");
  return { ...quote, spender: getAddress(spender), transaction: { ...quote.transaction, to: getAddress(quote.transaction.to) } };
}

async function swapIntoFirstLiquidStock(cfg, publicClient, walletClient, account, sellToken, sellAmount, order) {
  const available = await tokenBalance(publicClient, sellToken, account.address);
  if (available < sellAmount) throw new Error("Automation wallet does not hold the recorded fee budget");
  let lastError;
  for (const stock of order) {
    try {
      if (stock.address === sellToken) return { stock, amount: sellAmount, swapTx: null, approvalTx: null };
      const quote = await zeroXQuote(cfg, account, sellToken, stock.address, sellAmount);
      const approvalTx = await approveIfNeeded(publicClient, walletClient, account, sellToken, quote.spender, sellAmount);
      const before = await tokenBalance(publicClient, stock.address, account.address);
      const swapTx = await walletClient.sendTransaction({
        account,
        to: quote.transaction.to,
        data: quote.transaction.data,
        value: BigInt(quote.transaction.value || "0"),
        gas: quote.transaction.gas ? BigInt(quote.transaction.gas) : undefined,
      });
      await publicClient.waitForTransactionReceipt({ hash: swapTx, confirmations: 2, timeout: 180_000 });
      const after = await tokenBalance(publicClient, stock.address, account.address);
      const amount = after - before;
      if (amount <= 0n || amount < BigInt(quote.minBuyAmount || 0)) throw new Error("Stock Token output was below the quoted minimum");
      return { stock, amount, swapTx, approvalTx };
    } catch (error) {
      lastError = error;
      log("stock_route_unavailable", { symbol: stock.symbol, reason: String(error instanceof Error ? error.message : error).slice(0, 220) });
    }
  }
  throw new Error(`No funded route for the ten-token rotation: ${lastError instanceof Error ? lastError.message : lastError}`);
}

async function stockUsdMicros(stock, amount) {
  const [priceResponse, assetsResponse] = await Promise.all([
    fetch(`https://api.robinhood.com/rhj/prices/${stock.symbol}`),
    fetch("https://api.robinhood.com/rhj/assets"),
  ]);
  if (!priceResponse.ok || !assetsResponse.ok) throw new Error(`Robinhood price lookup failed for ${stock.symbol}`);
  const prices = await priceResponse.json();
  const assets = await assetsResponse.json();
  const quote = prices.quotes?.find((item) => item.tokenSymbol === stock.symbol);
  const asset = assets.assets?.find((item) => item.tokenSymbol === stock.symbol);
  if (!quote?.bid || !asset?.currentMultiplier || quote.isTradingHalt) throw new Error(`No usable live price for ${stock.symbol}`);
  return usdMicrosForTokenAmount(amount, quote.bid, asset.currentMultiplier, 18);
}

async function holderSnapshot(cfg, publicClient, snapshotBlock, launch, account) {
  const logs = [];
  for (let from = cfg.ponsTokenStartBlock; from <= snapshotBlock; from += BigInt(cfg.chunkSize)) {
    const to = from + BigInt(cfg.chunkSize - 1) > snapshotBlock ? snapshotBlock : from + BigInt(cfg.chunkSize - 1);
    logs.push(...await publicClient.getLogs({ address: cfg.ponsToken, event: transferEvent, fromBlock: from, toBlock: to }));
  }
  const excluded = new Set([
    "0x0000000000000000000000000000000000000000",
    "0x000000000000000000000000000000000000dEaD",
    cfg.ponsFactory,
    cfg.feeEscrow,
    cfg.packContract,
    getAddress(launch.curve),
    account.address,
    ...cfg.excluded,
  ].map((value) => value.toLowerCase()));
  const candidates = applyTransfers(logs).filter((candidate) => !excluded.has(candidate.address.toLowerCase()));
  const eligible = [];
  for (let index = 0; index < candidates.length; index += 12) {
    const group = candidates.slice(index, index + 12);
    const codes = await Promise.all(group.map((candidate) => publicClient.getBytecode({ address: candidate.address, blockNumber: snapshotBlock })));
    group.forEach((candidate, candidateIndex) => { if (!codes[candidateIndex]) eligible.push(candidate); });
  }
  return eligible;
}

async function processEpoch(cfg, store, epoch, launch, publicClient, walletClient, account) {
  const key = epoch.epoch_key;
  if (TERMINAL.has(epoch.status)) return epoch;

  if (epoch.status === "created") {
    let sweepTx = null;
    if (cfg.mode === "live") sweepTx = await maybeSweepCurve(cfg, launch, publicClient, walletClient, account);
    const owed = await publicClient.readContract({ address: cfg.feeEscrow, abi: escrowAbi, functionName: "balanceOfToken", args: [account.address, cfg.quoteToken] });
    if (owed === 0n) return store.updateEpoch(key, { status: "no_fees", sweep_tx: sweepTx, fee_amount_atoms: "0", completed_at: new Date().toISOString() });
    const [dropBudget, treasuryBudget] = splitAmount(owed, cfg.feeSplitBps);
    if (dropBudget === 0n || treasuryBudget === 0n) {
      return store.updateEpoch(key, { status: "no_fees", sweep_tx: sweepTx, fee_amount_atoms: owed.toString(), completed_at: new Date().toISOString() });
    }
    if (cfg.mode === "dry-run") {
      return store.updateEpoch(key, {
        status: "dry_run",
        fee_amount_atoms: owed.toString(),
        holder_drop_budget_atoms: dropBudget.toString(),
        inventory_budget_atoms: treasuryBudget.toString(),
        completed_at: new Date().toISOString(),
      });
    }
    const preclaim = await tokenBalance(publicClient, cfg.quoteToken, account.address);
    epoch = await store.updateEpoch(key, { status: "claiming", sweep_tx: sweepTx, fee_amount_atoms: owed.toString(), preclaim_balance_atoms: preclaim.toString() });
  }

  if (epoch.status === "claiming") {
    const preclaim = BigInt(epoch.preclaim_balance_atoms);
    let claimTx = epoch.claim_tx;
    if (!claimTx) {
      const stillOwed = await publicClient.readContract({ address: cfg.feeEscrow, abi: escrowAbi, functionName: "balanceOfToken", args: [account.address, cfg.quoteToken] });
      const currentBalance = await tokenBalance(publicClient, cfg.quoteToken, account.address);
      if (stillOwed === 0n && currentBalance > preclaim) {
        claimTx = "recovered-from-balance-delta";
      } else {
        claimTx = await walletClient.writeContract({ account, address: cfg.feeEscrow, abi: escrowAbi, functionName: "claimToken", args: [cfg.quoteToken] });
        epoch = await store.updateEpoch(key, { claim_tx: claimTx });
        await publicClient.waitForTransactionReceipt({ hash: claimTx, confirmations: 2, timeout: 120_000 });
      }
    } else if (claimTx.startsWith("0x")) {
      await publicClient.waitForTransactionReceipt({ hash: claimTx, confirmations: 2, timeout: 120_000 });
    }
    const claimed = (await tokenBalance(publicClient, cfg.quoteToken, account.address)) - preclaim;
    if (claimed <= 0n) throw new Error("Pons fee claim produced no SPY balance increase");
    const [dropBudget, treasuryBudget] = splitAmount(claimed, cfg.feeSplitBps);
    const snapshotBlock = await publicClient.getBlockNumber();
    epoch = await store.updateEpoch(key, {
      status: "awaiting_seed",
      claim_tx: claimTx,
      fee_amount_atoms: claimed.toString(),
      holder_drop_budget_atoms: dropBudget.toString(),
      inventory_budget_atoms: treasuryBudget.toString(),
      snapshot_block: snapshotBlock.toString(),
      seed_block: (snapshotBlock + 20n).toString(),
    });
  }

  if (epoch.status === "awaiting_seed") {
    const seedBlock = BigInt(epoch.seed_block);
    if (await publicClient.getBlockNumber() <= seedBlock) return epoch;
    const block = await publicClient.getBlock({ blockNumber: seedBlock });
    if (!block.hash) throw new Error("Seed block hash is unavailable");
    const decimals = await publicClient.readContract({ address: cfg.ponsToken, abi: erc20Abi, functionName: "decimals" });
    const unit = ticketUnit(cfg.tokensPerTicket, Number(decimals));
    const candidates = await holderSnapshot(cfg, publicClient, BigInt(epoch.snapshot_block), launch, account);
    const result = weightedWinner(candidates, deriveSeed(block.hash, key, "holder"), unit);
    const dropOrder = deterministicStockOrder(block.hash, key, "holder-drop");
    const inventoryOrder = deterministicStockOrder(block.hash, key, "inventory");
    epoch = await store.updateEpoch(key, {
      status: "holder_drop_swap",
      seed_hash: block.hash,
      winner_address: result.winner,
      total_tickets: result.totalTickets.toString(),
      winning_ticket: result.winningTicket.toString(),
      drop_stock_symbol: dropOrder[0].symbol,
      inventory_stock_symbol: inventoryOrder[0].symbol,
    });
  }

  if (epoch.status === "holder_drop_swap") {
    const order = deterministicStockOrder(epoch.seed_hash, key, "holder-drop");
    const drop = await swapIntoFirstLiquidStock(cfg, publicClient, walletClient, account, cfg.quoteToken, BigInt(epoch.holder_drop_budget_atoms), order);
    epoch = await store.updateEpoch(key, {
      status: "holder_drop_send",
      drop_stock_symbol: drop.stock.symbol,
      drop_stock_address: drop.stock.address,
      drop_stock_amount_atoms: drop.amount.toString(),
      drop_swap_tx: drop.swapTx,
      drop_approval_tx: drop.approvalTx,
    });
  }

  if (epoch.status === "holder_drop_send") {
    const hash = await walletClient.writeContract({
      account,
      address: getAddress(epoch.drop_stock_address),
      abi: erc20Abi,
      functionName: "transfer",
      args: [getAddress(epoch.winner_address), BigInt(epoch.drop_stock_amount_atoms)],
    });
    await publicClient.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000 });
    epoch = await store.updateEpoch(key, { status: "inventory_swap", holder_drop_tx: hash });
  }

  if (epoch.status === "inventory_swap") {
    const order = deterministicStockOrder(epoch.seed_hash, key, "inventory");
    const inventory = await swapIntoFirstLiquidStock(cfg, publicClient, walletClient, account, cfg.quoteToken, BigInt(epoch.inventory_budget_atoms), order);
    const usdMicros = await stockUsdMicros(inventory.stock, inventory.amount);
    if (usdMicros <= 0n) throw new Error("Inventory valuation was zero");
    epoch = await store.updateEpoch(key, {
      status: "inventory_load",
      inventory_stock_symbol: inventory.stock.symbol,
      inventory_stock_address: inventory.stock.address,
      inventory_stock_amount_atoms: inventory.amount.toString(),
      inventory_value_usd_micros: usdMicros.toString(),
      inventory_swap_tx: inventory.swapTx,
      inventory_approval_tx: inventory.approvalTx,
    });
  }

  if (epoch.status === "inventory_load") {
    const token = getAddress(epoch.inventory_stock_address);
    const amount = BigInt(epoch.inventory_stock_amount_atoms);
    const approved = await publicClient.readContract({ address: cfg.packContract, abi: packAbi, functionName: "approvedStock", args: [token] });
    if (!approved) throw new Error(`${epoch.inventory_stock_symbol} is not approved by the pack contract`);
    const approvalTx = await approveIfNeeded(publicClient, walletClient, account, token, cfg.packContract, amount);
    const beforeCount = await publicClient.readContract({ address: cfg.packContract, abi: packAbi, functionName: "inventoryCount" });
    const inventoryTx = await walletClient.writeContract({
      account,
      address: cfg.packContract,
      abi: packAbi,
      functionName: "loadPrize",
      args: [token, amount, BigInt(epoch.inventory_value_usd_micros)],
    });
    await publicClient.waitForTransactionReceipt({ hash: inventoryTx, confirmations: 2, timeout: 120_000 });
    const afterCount = await publicClient.readContract({ address: cfg.packContract, abi: packAbi, functionName: "inventoryCount" });
    if (afterCount !== beforeCount + 1n) throw new Error("Pack inventory count did not increase after loadPrize");
    epoch = await store.updateEpoch(key, {
      status: "complete",
      pack_approval_tx: approvalTx,
      inventory_load_tx: inventoryTx,
      completed_at: new Date().toISOString(),
    });
  }
  return epoch;
}

async function tick(cfg) {
  const store = new AuditStore(cfg.supabaseUrl, cfg.supabaseKey);
  const { publicClient, walletClient, account } = clients(cfg);
  const holder = `${account.address}:${process.pid}`;
  if (!await store.acquire(holder)) {
    log("tick_skipped_locked");
    return;
  }
  let epoch;
  try {
    const launch = await validateOnchain(cfg, publicClient, account);
    if (cfg.mode === "live") await settleReadyPack(cfg, publicClient, walletClient, account);
    epoch = await store.getPendingEpoch();
    if (!epoch) {
      const key = epochKey(new Date(), cfg.intervalMinutes);
      epoch = await store.getEpoch(key) || await store.insertEpoch({
        epoch_key: key,
        status: "created",
        automation_mode: cfg.mode,
        pons_token_address: cfg.ponsToken,
        fee_asset_address: cfg.quoteToken,
      });
    }
    const key = epoch.epoch_key;
    const result = await processEpoch(cfg, store, epoch, launch, publicClient, walletClient, account);
    log("tick_complete", { epoch: key, status: result.status });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 1_500);
    log("tick_error", { reason: message });
    // Preserve the last durable stage so the same epoch can resume instead of
    // becoming stranded in a generic error state.
    if (epoch?.epoch_key) await store.updateEpoch(epoch.epoch_key, { error: message }).catch(() => undefined);
  } finally {
    await store.release(holder).catch(() => undefined);
  }
}

async function main() {
  let cfg;
  try {
    cfg = readConfig();
  } catch (error) {
    log("configuration_error", { reason: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
    return;
  }
  if (cfg.mode === "off") {
    log("worker_safe_off", { message: "Set AUTOMATION_MODE=dry-run only after all required values are configured." });
    while (true) await sleep(cfg.pollSeconds * 1_000);
  }
  log("worker_started", { mode: cfg.mode, intervalMinutes: cfg.intervalMinutes });
  while (true) {
    await tick(cfg);
    await sleep(cfg.pollSeconds * 1_000);
  }
}

await main();

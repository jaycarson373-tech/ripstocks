import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  parseAbi,
  parseAbiItem,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CANONICAL_SPY,
  PONS_V2_FACTORY,
  PONS_V2_FEE_LOCKER,
  addressEnv,
  applyTransfers,
  basisPoints,
  deriveSeed,
  deterministicStockOrder,
  discoverContractStartBlock,
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
  "function getLaunchedToken(address token) view returns ((address token,address deployer,address pairedToken,address positionManager,uint256 positionId,uint256 dexId,uint256 launchConfigId,uint256 restrictionsEndBlock,uint256 supply,bool isToken0,uint24 poolFee,bool exists,uint256 initialBuyAmount))",
]);
const feeLockerAbi = parseAbi([
  "function collectFees(address token) returns (uint256 amount0,uint256 amount1)",
  "function feeRedirects(address token) view returns (address)",
]);
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
    ponsTokenStartBlock: process.env.PONS_TOKEN_START_BLOCK?.trim() ? BigInt(process.env.PONS_TOKEN_START_BLOCK) : null,
    packContract: addressEnv("STOCKRIPS_PACK_CONTRACT", process.env.STOCKRIPS_PACK_CONTRACT),
    ponsFactory: addressEnv("PONS_V2_FACTORY", process.env.PONS_V2_FACTORY || PONS_V2_FACTORY),
    feeLocker: addressEnv("PONS_FEE_LOCKER", process.env.PONS_FEE_LOCKER || PONS_V2_FEE_LOCKER),
    quoteToken: addressEnv("PONS_QUOTE_TOKEN", process.env.PONS_QUOTE_TOKEN || CANONICAL_SPY),
    zeroXKey: required("ZEROX_API_KEY", process.env.ZEROX_API_KEY),
    slippageBps: basisPoints("ZEROX_SLIPPAGE_BPS", process.env.ZEROX_SLIPPAGE_BPS, 100),
    supabaseUrl: required("SUPABASE_URL", process.env.SUPABASE_URL).replace(/\/$/, ""),
    supabaseKey: required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY),
    intervalMinutes: positiveInteger("DROP_INTERVAL_MINUTES", process.env.DROP_INTERVAL_MINUTES, 60),
    feeSplitBps: basisPoints("FEE_SPLIT_BPS", process.env.FEE_SPLIT_BPS, 5_000),
    tokensPerTicket: process.env.TOKENS_PER_TICKET || "250",
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
  if (getAddress(launch.pairedToken) !== cfg.quoteToken) throw new Error("The Pons launch is not paired to canonical SPY");
  const redirect = await publicClient.readContract({ address: cfg.feeLocker, abi: feeLockerAbi, functionName: "feeRedirects", args: [cfg.ponsToken] });
  const recipient = getAddress(redirect) === zeroAddress ? getAddress(launch.deployer) : getAddress(redirect);
  if (recipient !== account.address) throw new Error("The automation signer is not the current Pons creator-fee recipient");
  const [owner, treasury] = await Promise.all([
    publicClient.readContract({ address: cfg.packContract, abi: packAbi, functionName: "owner" }),
    publicClient.readContract({ address: cfg.packContract, abi: packAbi, functionName: "treasury" }),
  ]);
  if (getAddress(owner) !== account.address) throw new Error("The automation signer is not the StonkRips pack-contract owner");
  if (getAddress(treasury) !== account.address) throw new Error("The pack treasury must be the same automation wallet for this configuration");
  return launch;
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

async function waitForSuccess(publicClient, hash, timeout = 120_000) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2, timeout });
  if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
  return receipt;
}

async function approveIfNeeded(publicClient, walletClient, account, token, spender, amount, onBroadcast) {
  // A previously broadcast approval is part of the durable epoch state; finish
  // confirming it before deciding whether another approval is necessary.
  const allowance = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account.address, spender] });
  if (allowance >= amount) return null;
  const hash = await walletClient.writeContract({ account, address: token, abi: erc20Abi, functionName: "approve", args: [spender, amount] });
  if (onBroadcast) await onBroadcast(hash);
  await waitForSuccess(publicClient, hash);
  return hash;
}

async function zeroXRequest(cfg, account, endpoint, sellToken, buyToken, sellAmount) {
  const query = new URLSearchParams({
    chainId: "4663",
    sellToken,
    buyToken,
    sellAmount: sellAmount.toString(),
    taker: account.address,
    slippageBps: String(cfg.slippageBps),
  });
  const response = await fetch(`https://api.0x.org/swap/allowance-holder/${endpoint}?${query}`, {
    headers: { "0x-api-key": cfg.zeroXKey, "0x-version": "v2" },
  });
  if (!response.ok) throw new Error(`0x ${endpoint} ${response.status}: ${await response.text()}`);
  return response.json();
}

async function zeroXPrice(cfg, account, sellToken, buyToken, sellAmount) {
  const price = await zeroXRequest(cfg, account, "price", sellToken, buyToken, sellAmount);
  if (price.liquidityAvailable === false || !price.buyAmount) throw new Error("0x returned no Stock Token price route");
  return BigInt(price.buyAmount);
}

async function zeroXQuote(cfg, account, sellToken, buyToken, sellAmount) {
  const quote = await zeroXRequest(cfg, account, "quote", sellToken, buyToken, sellAmount);
  if (quote.liquidityAvailable === false || !quote.transaction?.to || !quote.transaction?.data || !quote.buyAmount) throw new Error("0x returned no executable Stock Token liquidity");
  const spender = quote.issues?.allowance?.spender || quote.allowanceTarget;
  if (!spender) throw new Error("0x quote omitted its allowance spender");
  return { ...quote, spender: getAddress(spender), transaction: { ...quote.transaction, to: getAddress(quote.transaction.to) } };
}

async function swapIntoFirstLiquidStock(cfg, publicClient, walletClient, account, sellToken, sellAmount, order, hooks = {}) {
  const available = await tokenBalance(publicClient, sellToken, account.address);
  if (available < sellAmount) throw new Error("Automation wallet does not hold the recorded fee budget");
  let lastError;
  for (const stock of order) {
    let routeLocked = false;
    try {
      if (stock.address === sellToken) {
        if (hooks.onRoute) await hooks.onRoute(stock, 0n);
        return { stock, amount: sellAmount, swapTx: null, approvalTx: null };
      }
      const before = hooks.beforeBalance == null
        ? await tokenBalance(publicClient, stock.address, account.address)
        : BigInt(hooks.beforeBalance);
      if (hooks.existingSwapTx) {
        await waitForSuccess(publicClient, hooks.existingSwapTx, 180_000);
        const after = await tokenBalance(publicClient, stock.address, account.address);
        const amount = after - before;
        if (amount <= 0n) throw new Error("Recorded swap produced no recoverable Stock Token output");
        return { stock, amount, swapTx: hooks.existingSwapTx, approvalTx: hooks.existingApprovalTx || null };
      }
      const quote = await zeroXQuote(cfg, account, sellToken, stock.address, sellAmount);
      if (hooks.onRoute) await hooks.onRoute(stock, before);
      routeLocked = true;
      const approvalTx = await approveIfNeeded(publicClient, walletClient, account, sellToken, quote.spender, sellAmount, hooks.onApproval);
      const swapTx = await walletClient.sendTransaction({
        account,
        to: quote.transaction.to,
        data: quote.transaction.data,
        value: BigInt(quote.transaction.value || "0"),
        gas: quote.transaction.gas ? BigInt(quote.transaction.gas) : undefined,
      });
      if (hooks.onSwap) await hooks.onSwap(swapTx);
      await waitForSuccess(publicClient, swapTx, 180_000);
      const after = await tokenBalance(publicClient, stock.address, account.address);
      const amount = after - before;
      if (amount <= 0n || amount < BigInt(quote.minBuyAmount || 0)) throw new Error("Stock Token output was below the quoted minimum");
      return { stock, amount, swapTx, approvalTx };
    } catch (error) {
      if (routeLocked || hooks.existingSwapTx) throw error;
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
    cfg.feeLocker,
    cfg.packContract,
    getAddress(launch.positionManager),
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

async function resolveTokenStartBlock(cfg, publicClient) {
  if (cfg.ponsTokenStartBlock != null) return cfg.ponsTokenStartBlock;
  const latest = await publicClient.getBlockNumber();
  cfg.ponsTokenStartBlock = await discoverContractStartBlock(
    latest,
    (blockNumber) => publicClient.getBytecode({ address: cfg.ponsToken, blockNumber }),
  );
  log("pons_token_start_block_discovered", { blockNumber: cfg.ponsTokenStartBlock.toString() });
  return cfg.ponsTokenStartBlock;
}

async function previewCollectableFees(cfg, launch, publicClient, account) {
  const { result } = await publicClient.simulateContract({
    account,
    address: cfg.feeLocker,
    abi: feeLockerAbi,
    functionName: "collectFees",
    args: [cfg.ponsToken],
  });
  const amount0 = BigInt(result[0]);
  const amount1 = BigInt(result[1]);
  return launch.isToken0
    ? { ponsAmount: amount0, quoteAmount: amount1 }
    : { ponsAmount: amount1, quoteAmount: amount0 };
}

async function processEpoch(cfg, store, epoch, launch, publicClient, walletClient, account) {
  const key = epoch.epoch_key;
  if (TERMINAL.has(epoch.status)) return epoch;

  if (epoch.status === "created") {
    const preview = await previewCollectableFees(cfg, launch, publicClient, account);
    const convertedPreview = preview.ponsAmount > 0n
      ? await zeroXPrice(cfg, account, cfg.ponsToken, cfg.quoteToken, preview.ponsAmount)
      : 0n;
    const owed = preview.quoteAmount + convertedPreview;
    if (owed === 0n) return store.updateEpoch(key, { status: "no_fees", fee_amount_atoms: "0", completed_at: new Date().toISOString() });
    const [dropBudget, treasuryBudget] = splitAmount(owed, cfg.feeSplitBps);
    if (dropBudget === 0n || treasuryBudget === 0n) {
      return store.updateEpoch(key, { status: "no_fees", fee_amount_atoms: owed.toString(), completed_at: new Date().toISOString() });
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
    const [prePonsBalance, preQuoteBalance] = await Promise.all([
      tokenBalance(publicClient, cfg.ponsToken, account.address),
      tokenBalance(publicClient, cfg.quoteToken, account.address),
    ]);
    // The two budget fields temporarily hold the pre-claim balances while this
    // stage is pending. They are replaced with the actual 50/50 budgets below.
    epoch = await store.updateEpoch(key, {
      status: "claiming",
      fee_amount_atoms: owed.toString(),
      preclaim_balance_atoms: preQuoteBalance.toString(),
      holder_drop_budget_atoms: prePonsBalance.toString(),
      inventory_budget_atoms: preQuoteBalance.toString(),
    });
  }

  if (epoch.status === "claiming") {
    const prePonsBalance = BigInt(epoch.holder_drop_budget_atoms);
    const preQuoteBalance = BigInt(epoch.preclaim_balance_atoms);
    let claimTx = epoch.claim_tx;
    if (!claimTx) {
      claimTx = await walletClient.writeContract({
        account,
        address: cfg.feeLocker,
        abi: feeLockerAbi,
        functionName: "collectFees",
        args: [cfg.ponsToken],
      });
      epoch = await store.updateEpoch(key, { claim_tx: claimTx });
      await waitForSuccess(publicClient, claimTx);
    } else if (claimTx.startsWith("0x")) {
      await waitForSuccess(publicClient, claimTx);
    }

    const currentPonsBalance = await tokenBalance(publicClient, cfg.ponsToken, account.address);
    const ponsFees = currentPonsBalance > prePonsBalance ? currentPonsBalance - prePonsBalance : 0n;
    if (ponsFees > 0n && !epoch.sweep_tx) {
      await swapIntoFirstLiquidStock(
        cfg,
        publicClient,
        walletClient,
        account,
        cfg.ponsToken,
        ponsFees,
        [{ symbol: "SPY", address: cfg.quoteToken }],
        {
          beforeBalance: preQuoteBalance,
          onSwap: async (hash) => { epoch = await store.updateEpoch(key, { sweep_tx: hash }); },
        },
      );
    } else if (epoch.sweep_tx?.startsWith("0x")) {
      await waitForSuccess(publicClient, epoch.sweep_tx, 180_000);
    }

    const currentQuoteBalance = await tokenBalance(publicClient, cfg.quoteToken, account.address);
    const claimed = currentQuoteBalance > preQuoteBalance ? currentQuoteBalance - preQuoteBalance : 0n;
    if (claimed <= 0n) throw new Error("Pons fee collection produced no canonical SPY balance increase");
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
    let order = deterministicStockOrder(epoch.seed_hash, key, "holder-drop");
    if (epoch.drop_stock_address) order = order.filter((stock) => stock.address === getAddress(epoch.drop_stock_address));
    const drop = await swapIntoFirstLiquidStock(
      cfg,
      publicClient,
      walletClient,
      account,
      cfg.quoteToken,
      BigInt(epoch.holder_drop_budget_atoms),
      order,
      {
        beforeBalance: epoch.drop_stock_address ? epoch.drop_stock_amount_atoms : undefined,
        existingSwapTx: epoch.drop_swap_tx,
        existingApprovalTx: epoch.drop_approval_tx,
        onRoute: async (stock, before) => {
          epoch = await store.updateEpoch(key, {
            drop_stock_symbol: stock.symbol,
            drop_stock_address: stock.address,
            drop_stock_amount_atoms: before.toString(),
          });
        },
        onApproval: async (hash) => { epoch = await store.updateEpoch(key, { drop_approval_tx: hash }); },
        onSwap: async (hash) => { epoch = await store.updateEpoch(key, { drop_swap_tx: hash }); },
      },
    );
    epoch = await store.updateEpoch(key, {
      status: "holder_drop_send",
      drop_stock_symbol: drop.stock.symbol,
      drop_stock_address: drop.stock.address,
      drop_stock_amount_atoms: drop.amount.toString(),
      drop_swap_tx: drop.swapTx,
      drop_approval_tx: drop.approvalTx || epoch.drop_approval_tx,
    });
  }

  if (epoch.status === "holder_drop_send") {
    let hash = epoch.holder_drop_tx;
    if (!hash) {
      hash = await walletClient.writeContract({
        account,
        address: getAddress(epoch.drop_stock_address),
        abi: erc20Abi,
        functionName: "transfer",
        args: [getAddress(epoch.winner_address), BigInt(epoch.drop_stock_amount_atoms)],
      });
      epoch = await store.updateEpoch(key, { holder_drop_tx: hash });
    }
    await waitForSuccess(publicClient, hash);
    epoch = await store.updateEpoch(key, { status: "inventory_swap", holder_drop_tx: hash });
  }

  if (epoch.status === "inventory_swap") {
    let order = deterministicStockOrder(epoch.seed_hash, key, "inventory");
    if (epoch.inventory_stock_address) order = order.filter((stock) => stock.address === getAddress(epoch.inventory_stock_address));
    const inventory = await swapIntoFirstLiquidStock(
      cfg,
      publicClient,
      walletClient,
      account,
      cfg.quoteToken,
      BigInt(epoch.inventory_budget_atoms),
      order,
      {
        beforeBalance: epoch.inventory_stock_address ? epoch.inventory_stock_amount_atoms : undefined,
        existingSwapTx: epoch.inventory_swap_tx,
        existingApprovalTx: epoch.inventory_approval_tx,
        onRoute: async (stock, before) => {
          epoch = await store.updateEpoch(key, {
            inventory_stock_symbol: stock.symbol,
            inventory_stock_address: stock.address,
            inventory_stock_amount_atoms: before.toString(),
          });
        },
        onApproval: async (hash) => { epoch = await store.updateEpoch(key, { inventory_approval_tx: hash }); },
        onSwap: async (hash) => { epoch = await store.updateEpoch(key, { inventory_swap_tx: hash }); },
      },
    );
    const usdMicros = await stockUsdMicros(inventory.stock, inventory.amount);
    if (usdMicros <= 0n) throw new Error("Inventory valuation was zero");
    epoch = await store.updateEpoch(key, {
      status: "inventory_load",
      inventory_stock_symbol: inventory.stock.symbol,
      inventory_stock_address: inventory.stock.address,
      inventory_stock_amount_atoms: inventory.amount.toString(),
      inventory_value_usd_micros: usdMicros.toString(),
      inventory_swap_tx: inventory.swapTx,
      inventory_approval_tx: inventory.approvalTx || epoch.inventory_approval_tx,
    });
  }

  if (epoch.status === "inventory_load") {
    const token = getAddress(epoch.inventory_stock_address);
    const amount = BigInt(epoch.inventory_stock_amount_atoms);
    const approved = await publicClient.readContract({ address: cfg.packContract, abi: packAbi, functionName: "approvedStock", args: [token] });
    if (!approved) throw new Error(`${epoch.inventory_stock_symbol} is not approved by the pack contract`);
    const approvalTx = await approveIfNeeded(
      publicClient,
      walletClient,
      account,
      token,
      cfg.packContract,
      amount,
      async (hash) => { epoch = await store.updateEpoch(key, { pack_approval_tx: hash }); },
    );
    const beforeCount = await publicClient.readContract({ address: cfg.packContract, abi: packAbi, functionName: "inventoryCount" });
    const resumingInventoryLoad = Boolean(epoch.inventory_load_tx);
    let inventoryTx = epoch.inventory_load_tx;
    if (!inventoryTx) {
      inventoryTx = await walletClient.writeContract({
        account,
        address: cfg.packContract,
        abi: packAbi,
        functionName: "loadPrize",
        args: [token, amount, BigInt(epoch.inventory_value_usd_micros)],
      });
      epoch = await store.updateEpoch(key, { inventory_load_tx: inventoryTx });
    }
    await waitForSuccess(publicClient, inventoryTx);
    const afterCount = await publicClient.readContract({ address: cfg.packContract, abi: packAbi, functionName: "inventoryCount" });
    if (resumingInventoryLoad ? afterCount < beforeCount : afterCount !== beforeCount + 1n) throw new Error("Pack inventory count did not increase after loadPrize");
    epoch = await store.updateEpoch(key, {
      status: "complete",
      pack_approval_tx: approvalTx || epoch.pack_approval_tx,
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
    await resolveTokenStartBlock(cfg, publicClient);
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

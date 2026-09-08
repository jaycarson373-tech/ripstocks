import { encodeFunctionData, getAddress, parseAbi, parseAbiItem } from "viem";
import { CANONICAL_USDG, ROBINHOOD_CHAIN_ID, deterministicStockOrder, eligibleHolderSnapshot, epochKey, splitAmount, ticketUnit, weightedWinner } from "./pons-core.mjs";
import { durableTransaction, receivedStockAtoms, ReinvestmentReverted } from "./pack-reinvestment.mjs";
import { ponsV2Adapter } from "./pons-v2-adapter.mjs";

const transferEvent = parseAbiItem("event Transfer(address indexed from,address indexed to,uint256 value)");
const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
]);
const packAbi = parseAbi([
  "function activeRequestId() view returns (uint256)",
  "function approvedStock(address) view returns (bool)",
  "function loadPrize(address,uint256,uint256)",
]);
const same = (a, b) => getAddress(a) === getAddress(b);

export class PonsHourlyStore {
  constructor(audit) { this.audit = audit; }
  rows(table, query) { return this.audit.request(`${table}?${query}`); }
  async epoch(scope, key) { return (await this.rows("pons_hourly_epochs", `scope=eq.${encodeURIComponent(scope)}&epoch_key=eq.${encodeURIComponent(key)}&limit=1`))?.[0]; }
  async holders(epochId) { return this.rows("pons_holder_snapshots", `epoch_id=eq.${encodeURIComponent(epochId)}&order=holder_address.asc&limit=50000`); }
  reserve(epoch, holders, lockHolder) { return this.audit.request("rpc/reserve_pons_hourly_epoch", { method: "POST", body: JSON.stringify({ p_epoch: epoch, p_holders: holders, p_holder: lockHolder }) }); }
  async patch(table, id, values) {
    const rows = await this.audit.request(`${table}?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(values) });
    if (!rows?.[0]) throw new Error("Pons hourly audit record disappeared");
    return rows[0];
  }
  async transaction(id) { return (await this.rows("pack_reinvestment_transactions", `id=eq.${encodeURIComponent(id)}&limit=1`))?.[0]; }
  async saveTransaction(row) {
    await this.audit.request("pack_reinvestment_transactions", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(row) });
    const saved = await this.transaction(row.id);
    if (!saved) throw new Error("Signed Pons transaction was not durably stored; refusing broadcast");
    return saved;
  }
}

export function ponsScope(cfg, account, ponsAccount) {
  return `${ROBINHOOD_CHAIN_ID}:pons:${cfg.pons.token.toLowerCase()}:${account.toLowerCase()}:${ponsAccount.toLowerCase()}`;
}

export async function buildErc20HolderSnapshot(ctx, snapshotBlock) {
  const { token, tokenStartBlock, tokensPerTicket, exclusions } = ctx.cfg.pons;
  if (tokenStartBlock > snapshotBlock) throw new Error("Pons token did not exist at the snapshot block");
  const decimals = await ctx.publicClient.readContract({ address: token, abi: erc20, functionName: "decimals", blockNumber: snapshotBlock });
  const logs = [];
  for (let from = tokenStartBlock; from <= snapshotBlock; from += 2_000n) {
    await ctx.lease();
    logs.push(...await ctx.publicClient.getLogs({ address: token, event: transferEvent, fromBlock: from, toBlock: from + 1_999n > snapshotBlock ? snapshotBlock : from + 1_999n }));
  }
  const systemWallets = [ctx.account.address, ctx.ponsAccount?.address, ctx.cfg.packContract, ctx.cfg.pons.escrow, ctx.cfg.pons.factory, ...exclusions].filter(Boolean);
  return eligibleHolderSnapshot(logs, systemWallets, ticketUnit(tokensPerTicket, decimals));
}

function validateQuote(quote, stock, budget) {
  if (!same(quote.sellToken, CANONICAL_USDG) || !same(quote.buyToken, stock.address)
    || BigInt(quote.sellAmount || 0) !== budget || BigInt(quote.minBuyAmount || 0) <= 0n
    || BigInt(quote.transaction?.value || 0) !== 0n) throw new Error("Pons stock quote does not match the reserved USDG budget");
}

async function approve(ctx, epoch, token, spender, amount, step) {
  const existing = await ctx.store.transaction(`${epoch.id}:${step}`);
  if (existing) return durableTransaction(ctx, epoch, step, () => { throw new Error("Recorded approval must be reused"); });
  const allowance = await ctx.publicClient.readContract({ address: token, abi: erc20, functionName: "allowance", args: [ctx.account.address, spender] });
  if (allowance >= amount) return null;
  return durableTransaction(ctx, epoch, step, async () => ({ to: token, data: encodeFunctionData({ abi: erc20, functionName: "approve", args: [spender, amount] }), value: 0n }));
}

async function chooseStock(ctx, epoch, purpose, budget, seedHash) {
  const addressField = `${purpose}_stock_address`;
  const symbolField = `${purpose}_stock_symbol`;
  if (epoch[addressField]) return { address: getAddress(epoch[addressField]), symbol: epoch[symbolField] };
  for (const stock of deterministicStockOrder(seedHash, epoch.id, purpose).filter(candidate => ctx.cfg.stocks.some(allowed => same(candidate.address, allowed.address)))) {
    try {
      const quote = await ctx.quote(CANONICAL_USDG, stock.address, budget);
      validateQuote(quote, stock, budget);
      epoch = await ctx.store.patch("pons_hourly_epochs", epoch.id, { [addressField]: stock.address, [symbolField]: stock.symbol });
      return { address: getAddress(epoch[addressField]), symbol: epoch[symbolField] };
    } catch { /* Try the next configured Stock Token before signing anything. */ }
  }
  throw new Error(`No executable Stock Token route for ${purpose}`);
}

async function buyStock(ctx, epoch, purpose, budget, seedHash) {
  const amountField = `${purpose}_stock_amount_atoms`;
  const txField = `${purpose}_swap_tx`;
  const stock = await chooseStock(ctx, epoch, purpose, budget, seedHash);
  if (epoch[amountField]) return { epoch, stock, amount: BigInt(epoch[amountField]) };
  const receipt = await durableTransaction(ctx, epoch, `${purpose}_swap`, async () => {
    const balance = await ctx.publicClient.readContract({ address: CANONICAL_USDG, abi: erc20, functionName: "balanceOf", args: [ctx.account.address] });
    if (balance < budget) throw new Error("Automation wallet USDG is below its reserved Pons budget");
    const quote = await ctx.quote(CANONICAL_USDG, stock.address, budget);
    validateQuote(quote, stock, budget);
    await approve(ctx, epoch, CANONICAL_USDG, quote.spender, budget, `${purpose}_usdg_approval`);
    return { to: quote.transaction.to, data: quote.transaction.data, value: 0n };
  });
  const amount = receivedStockAtoms(receipt, stock.address, ctx.account.address);
  const spent = -receivedStockAtoms(receipt, CANONICAL_USDG, ctx.account.address);
  if (amount <= 0n || spent !== budget) throw new Error("Confirmed Pons stock purchase does not match its reserved budget");
  epoch = await ctx.store.patch("pons_hourly_epochs", epoch.id, { [amountField]: amount.toString(), [txField]: receipt.transactionHash });
  return { epoch, stock, amount };
}

async function sendHolderDrop(ctx, epoch, stock, amount) {
  if (epoch.holder_drop_tx) return epoch;
  const receipt = await durableTransaction(ctx, epoch, "holder_drop_send", async () => ({
    to: stock.address,
    data: encodeFunctionData({ abi: erc20, functionName: "transfer", args: [getAddress(epoch.winner_address), amount] }),
    value: 0n,
  }));
  if (receivedStockAtoms(receipt, stock.address, epoch.winner_address) !== amount) throw new Error("Holder drop receipt does not prove the exact Stock Token delivery");
  return ctx.store.patch("pons_hourly_epochs", epoch.id, { holder_drop_tx: receipt.transactionHash, status: "holder_sent" });
}

async function loadInventory(ctx, epoch, stock, amount) {
  if (epoch.inventory_load_tx) return epoch;
  if (await ctx.publicClient.readContract({ address: ctx.cfg.packContract, abi: packAbi, functionName: "activeRequestId" }) !== 0n) return epoch;
  if (!await ctx.publicClient.readContract({ address: ctx.cfg.packContract, abi: packAbi, functionName: "approvedStock", args: [stock.address] })) throw new Error("Pons inventory stock is not approved by the pack contract");
  const declaredUsdMicros = epoch.inventory_value_usd_micros
    ? BigInt(epoch.inventory_value_usd_micros)
    : await ctx.stockValue(stock, amount);
  if (declaredUsdMicros <= 0n) throw new Error("Pons inventory lot has no usable current valuation");
  if (!epoch.inventory_value_usd_micros) epoch = await ctx.store.patch("pons_hourly_epochs", epoch.id, { inventory_value_usd_micros: declaredUsdMicros.toString() });
  await approve(ctx, epoch, stock.address, ctx.cfg.packContract, amount, "inventory_stock_approval");
  const receipt = await durableTransaction(ctx, epoch, "inventory_load", async () => {
    const { request } = await ctx.publicClient.simulateContract({ account: ctx.account, address: ctx.cfg.packContract, abi: packAbi, functionName: "loadPrize", args: [stock.address, amount, declaredUsdMicros] });
    return { to: request.address, data: encodeFunctionData(request), value: 0n };
  });
  if (receivedStockAtoms(receipt, stock.address, ctx.cfg.packContract) !== amount) throw new Error("Inventory load receipt does not prove the exact Stock Token transfer");
  return ctx.store.patch("pons_hourly_epochs", epoch.id, { inventory_load_tx: receipt.transactionHash, status: "complete", completed_at: new Date().toISOString() });
}

export async function runPonsHourly(baseCtx, now = new Date()) {
  if (!baseCtx.cfg.ponsEnabled || baseCtx.cfg.mode === "off") return;
  if (!baseCtx.ponsAccount || !baseCtx.ponsWalletClient) throw new Error("Pons fee wallet is not configured");
  const ctx = { ...baseCtx, store: new PonsHourlyStore(baseCtx.audit) };
  const ponsCtx = { ...ctx, account: ctx.ponsAccount, walletClient: ctx.ponsWalletClient };
  const scope = ponsScope(ctx.cfg, ctx.account.address, ctx.ponsAccount.address);
  const key = epochKey(now);
  let epoch = await ctx.store.epoch(scope, key);
  const adapter = ponsV2Adapter(ctx.cfg.pons);
  if (!epoch) {
    if (await ctx.publicClient.getChainId() !== ROBINHOOD_CHAIN_ID) throw new Error("Pons automation requires Robinhood Chain 4663");
    const latest = await ctx.publicClient.getBlockNumber();
    if (latest <= BigInt(ctx.cfg.pons.confirmationBlocks)) return;
    const snapshotBlock = latest - BigInt(ctx.cfg.pons.confirmationBlocks);
    const snapshotHeader = await ctx.publicClient.getBlock({ blockNumber: snapshotBlock });
    const snapshot = await buildErc20HolderSnapshot(ctx, snapshotBlock);
    if ((await ctx.publicClient.getBlock({ blockNumber: snapshotBlock })).hash !== snapshotHeader.hash) throw new Error("Holder snapshot block reorganized during construction");
    const launch = await adapter.validate(ctx.publicClient, ctx.ponsAccount.address);
    const claimable = await adapter.claimable(ctx.publicClient, ctx.ponsAccount.address);
    const [holderBudget, inventoryBudget] = splitAmount(claimable, ctx.cfg.pons.holderShareBps);
    const status = snapshot.totalTickets === 0n ? "no_holders" : "created";
    const id = `${scope}:${key}`;
    const row = {
      id, scope, epoch_key: key, status, automation_mode: ctx.cfg.mode,
      pons_token_address: ctx.cfg.pons.token.toLowerCase(), fee_asset_address: ctx.cfg.pons.feeAsset.toLowerCase(),
      pons_curve_address: launch.curve.toLowerCase(), pons_phase: Number(launch.phase),
      snapshot_block: snapshotBlock.toString(), snapshot_block_hash: snapshotHeader.hash,
      snapshot_hash: snapshot.snapshotHash,
      claimable_atoms: claimable.toString(), holder_budget_atoms: holderBudget.toString(), inventory_budget_atoms: inventoryBudget.toString(),
      total_tickets: snapshot.totalTickets.toString(),
    };
    if (ctx.cfg.mode === "dry-run") {
      ctx.log("pons_hourly_dry_run", { epoch: key, status, claimableAtoms: claimable.toString(), eligibleHolders: snapshot.holders.length, totalTickets: snapshot.totalTickets.toString() });
      return;
    }
    epoch = await ctx.store.reserve(row, snapshot.holders.map(holder => ({ epoch_id: id, holder_address: holder.address.toLowerCase(), balance_atoms: holder.balance.toString(), tickets: holder.tickets.toString() })), ctx.holder);
  }
  if (["complete", "no_fees", "no_holders"].includes(epoch.status) || ctx.cfg.mode !== "live") return;
  if (epoch.status === "created") {
    const launch = await adapter.validate(ctx.publicClient, ctx.ponsAccount.address);
    if (!same(launch.curve, epoch.pons_curve_address) || Number(launch.phase) !== Number(epoch.pons_phase)) throw new Error("Pons launch phase changed during the reserved epoch");
    const sweepRequest = adapter.sweepRequest(launch);
    if (sweepRequest && !epoch.sweep_tx) {
      const sweepReceipt = await durableTransaction(ponsCtx, epoch, "pons_sweep", () => sweepRequest);
      epoch = await ctx.store.patch("pons_hourly_epochs", epoch.id, { sweep_tx: sweepReceipt.transactionHash });
    }
    const claimable = await adapter.claimable(ctx.publicClient, ctx.ponsAccount.address);
    if (claimable < 2n) {
      await ctx.store.patch("pons_hourly_epochs", epoch.id, { claimable_atoms: claimable.toString(), holder_budget_atoms: "0", inventory_budget_atoms: "0", status: "no_fees", completed_at: new Date().toISOString() });
      return;
    }
    const [holderBudget, inventoryBudget] = splitAmount(claimable, ctx.cfg.pons.holderShareBps);
    epoch = await ctx.store.patch("pons_hourly_epochs", epoch.id, { claimable_atoms: claimable.toString(), holder_budget_atoms: holderBudget.toString(), inventory_budget_atoms: inventoryBudget.toString(), status: "claim_ready" });
  }
  if (epoch.status === "claim_ready") {
    const receipt = await durableTransaction(ponsCtx, epoch, "pons_claim", () => adapter.claimRequest());
    const claimed = receivedStockAtoms(receipt, ctx.cfg.pons.feeAsset, ctx.ponsAccount.address);
    if (claimed < 2n) throw new Error("Confirmed Pons claim did not deliver the recorded fee asset");
    if (!same(ctx.ponsAccount.address, ctx.account.address)) {
      const forwarded = await durableTransaction(ponsCtx, epoch, "pons_fee_forward", () => ({
        to: ctx.cfg.pons.feeAsset,
        data: encodeFunctionData({ abi: erc20, functionName: "transfer", args: [ctx.account.address, claimed] }),
        value: 0n,
      }));
      if (receivedStockAtoms(forwarded, ctx.cfg.pons.feeAsset, ctx.account.address) !== claimed
        || receivedStockAtoms(forwarded, ctx.cfg.pons.feeAsset, ctx.ponsAccount.address) !== -claimed) {
        throw new Error("Confirmed Pons fee forwarding transaction does not reconcile");
      }
    }
    const [holderBudget, inventoryBudget] = splitAmount(claimed, ctx.cfg.pons.holderShareBps);
    const seedBlock = await ctx.publicClient.getBlockNumber() + BigInt(ctx.cfg.pons.confirmationBlocks);
    epoch = await ctx.store.patch("pons_hourly_epochs", epoch.id, { claim_tx: receipt.transactionHash, claimed_atoms: claimed.toString(), holder_budget_atoms: holderBudget.toString(), inventory_budget_atoms: inventoryBudget.toString(), seed_block: seedBlock.toString(), status: "awaiting_seed" });
  }
  const seedBlock = BigInt(epoch.seed_block);
  if (await ctx.publicClient.getBlockNumber() < seedBlock + BigInt(ctx.cfg.pons.confirmationBlocks)) return;
  const seedHeader = await ctx.publicClient.getBlock({ blockNumber: seedBlock });
  if (!epoch.seed_block_hash) epoch = await ctx.store.patch("pons_hourly_epochs", epoch.id, { seed_block_hash: seedHeader.hash });
  else if (epoch.seed_block_hash !== seedHeader.hash) throw new Error("Pons epoch seed block reorganized");
  if (!epoch.winner_address) {
    const holders = await ctx.store.holders(epoch.id);
    const selected = weightedWinner(holders.map(holder => ({ address: holder.holder_address, balance: BigInt(holder.tickets) })), BigInt(seedHeader.hash), 1n);
    epoch = await ctx.store.patch("pons_hourly_epochs", epoch.id, { winner_address: selected.winner.toLowerCase(), winning_ticket: selected.winningTicket.toString(), status: "winner_committed" });
  }
  try {
    if (!epoch.holder_drop_tx) {
      const holder = await buyStock(ctx, epoch, "holder", BigInt(epoch.holder_budget_atoms), seedHeader.hash);
      epoch = await sendHolderDrop(ctx, holder.epoch, holder.stock, holder.amount);
    }
    if (!epoch.inventory_load_tx) {
      const inventory = await buyStock(ctx, epoch, "inventory", BigInt(epoch.inventory_budget_atoms), seedHeader.hash);
      epoch = await loadInventory(ctx, inventory.epoch, inventory.stock, inventory.amount);
    }
  } catch (error) {
    if (error instanceof ReinvestmentReverted) throw error;
    await ctx.store.patch("pons_hourly_epochs", epoch.id, { status: "error", error: String(error?.message || error).slice(0, 500) });
    throw error;
  }
  if (epoch.status === "complete") ctx.log("pons_hourly_complete", { epoch: epoch.epoch_key, winner: epoch.winner_address, holderDropTx: epoch.holder_drop_tx, inventoryLoadTx: epoch.inventory_load_tx });
}

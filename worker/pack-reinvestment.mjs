import { decodeEventLog, encodeFunctionData, getAddress, keccak256, parseAbi, parseAbiItem } from "viem";
import { CANONICAL_USDG, ROBINHOOD_CHAIN_ID, deriveSeed, deterministicStockOrder, discoverContractStartBlock, epochKey } from "./pons-core.mjs";

export const SALE_ATOMS = 20_000_000n;
export const LOT_VALUES_USD = [5, 7, 8, 10, 12, 15, 18, 20, 25, 30, 40, 50, 75, 100];
const CONFIRMATIONS = 12n;
const transfer = parseAbiItem("event Transfer(address indexed from,address indexed to,uint256 value)");
const delivered = parseAbiItem("event PrizeDelivered(uint256 indexed requestId,address indexed buyer,address indexed token,uint256 tokenAmount,uint256 declaredUsdMicros)");
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);
const packAbi = parseAbi(["function activeRequestId() view returns (uint256)", "function approvedStock(address) view returns (bool)", "function loadPrize(address,uint256,uint256)"]);
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

function decode(log, event) {
  try { return decodeEventLog({ abi: [event], data: log.data, topics: log.topics }).args; } catch { return null; }
}

// An openPack request is NOT revenue. Only a successful settlement which paid
// this treasury in canonical USDG can enter the reinvestment ledger.
export function saleFromReceipt(receipt, contract, treasury, priceAtoms = SALE_ATOMS) {
  if (receipt.status !== "success") return null;
  const prizes = receipt.logs.filter(log => same(log.address, contract)).map(log => decode(log, delivered)).filter(Boolean);
  if (prizes.length !== 1) return null;
  const paid = receipt.logs.filter(log => same(log.address, CANONICAL_USDG)).map(log => decode(log, transfer))
    .filter(args => args && same(args.from, contract) && same(args.to, treasury));
  if (paid.length !== 1 || paid[0].value !== priceAtoms) return null;
  if (receivedStockAtoms(receipt, prizes[0].token, prizes[0].buyer) !== prizes[0].tokenAmount) return null;
  return {
    request_id: prizes[0].requestId.toString(),
    transaction_hash: receipt.transactionHash,
    block_number: receipt.blockNumber.toString(),
    block_hash: receipt.blockHash,
    amount_atoms: priceAtoms.toString(),
    buyer: prizes[0].buyer,
    stock_address: prizes[0].token,
    token_amount_atoms: prizes[0].tokenAmount.toString(),
    declared_usd_micros: prizes[0].declaredUsdMicros.toString(),
  };
}

export function receivedStockAtoms(receipt, token, wallet) {
  return receipt.logs.filter(log => same(log.address, token)).map(log => decode(log, transfer)).filter(Boolean)
    .reduce((total, args) => total + (same(args.to, wallet) ? args.value : 0n) - (same(args.from, wallet) ? args.value : 0n), 0n);
}

// Sizes are inventory purchase budgets, NOT user outcome probabilities. The
// persisted epoch seed makes retries reproduce the same fully funded partition.
export function planLots(budget, seed, epochId, priceAtoms = SALE_ATOMS, values = LOT_VALUES_USD) {
  let remaining = BigInt(budget);
  if (priceAtoms <= 0n || remaining < 0n || remaining % priceAtoms !== 0n) throw new Error("Reinvestment budget must consist of whole settled pack sales");
  const lots = [];
  while (remaining > 0n) {
    const units = values.map(value => BigInt(value) * 1_000_000n);
    const canCompose = target => {
      if (target === 0n) return true;
      if (target < 0n || target % 1_000_000n !== 0n) return false;
      const dollars = Number(target / 1_000_000n);
      const reachable = new Uint8Array(dollars + 1);
      reachable[0] = 1;
      for (let amount = 1; amount <= dollars; amount += 1) reachable[amount] = values.some(value => value <= amount && reachable[amount - value]);
      return Boolean(reachable[dollars]);
    };
    const options = units.filter(value => value > 0n && value <= remaining && canCompose(remaining - value));
    if (!options.length) options.push(remaining); // Exact sub-dollar remainder, never discarded.
    // Even a single sale can refill with varied sizes, e.g. 5 + 15 USDG.
    const smaller = options.filter(value => value < remaining);
    const choices = lots.length === 0 && remaining === priceAtoms && smaller.length ? smaller : options;
    const amount = choices[Number(deriveSeed(seed, epochId, `lot-size:${lots.length}`) % BigInt(choices.length))];
    lots.push({ id: `${epochId}:${lots.length}`, lot_index: lots.length, usd_atoms: amount.toString() });
    remaining -= amount;
    if (lots.length > 2000) throw new Error("Reinvestment backlog exceeds the bounded batch size; operator review required");
  }
  return lots;
}

export async function lastClosedBlock(publicClient, latest, boundarySeconds) {
  if (latest < CONFIRMATIONS) return null;
  let low = 0n;
  let high = latest - CONFIRMATIONS;
  if ((await publicClient.getBlock({ blockNumber: low })).timestamp >= boundarySeconds) return null;
  while (low < high) {
    const mid = (low + high + 1n) / 2n;
    if ((await publicClient.getBlock({ blockNumber: mid })).timestamp < boundarySeconds) low = mid;
    else high = mid - 1n;
  }
  return publicClient.getBlock({ blockNumber: low });
}

export class ReinvestmentStore {
  constructor(audit) { this.audit = audit; }
  async rows(table, query) { return this.audit.request(`${table}?${query}`); }
  async pending(scope) { return (await this.rows("pack_reinvestment_epochs", `scope=eq.${encodeURIComponent(scope)}&status=eq.planned&order=epoch_key.asc&limit=1`))?.[0]; }
  async latest(scope) { return (await this.rows("pack_reinvestment_epochs", `scope=eq.${encodeURIComponent(scope)}&order=epoch_key.desc&limit=1`))?.[0]; }
  async reserve(epoch, receipts, lots, holder) {
    return this.audit.request("rpc/reserve_pack_reinvestment", { method: "POST", body: JSON.stringify({ p_epoch: epoch, p_receipts: receipts, p_lots: lots, p_holder: holder }) });
  }
  async lots(epochId) { return this.rows("pack_reinvestment_lots", `epoch_id=eq.${encodeURIComponent(epochId)}&order=lot_index.asc&limit=2001`); }
  async patch(table, id, patch) {
    const rows = await this.audit.request(`${table}?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) });
    if (!rows?.[0]) throw new Error("Reinvestment audit record disappeared");
    return rows[0];
  }
  async transaction(id) { return (await this.rows("pack_reinvestment_transactions", `id=eq.${encodeURIComponent(id)}&limit=1`))?.[0]; }
  async pendingTransaction(scope) { return (await this.rows("pack_reinvestment_transactions", `scope=eq.${encodeURIComponent(scope)}&confirmed_at=is.null&order=created_at.asc&limit=1`))?.[0]; }
  async saveTransaction(row) {
    await this.audit.request("pack_reinvestment_transactions", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(row) });
    const saved = await this.transaction(row.id);
    if (!saved) throw new Error("Signed transaction was not durably stored; refusing broadcast");
    return saved;
  }
}

export class ReinvestmentReverted extends Error {}

// Persist the signed bytes and their hash BEFORE sending. A timeout/crash can
// only rebroadcast those exact bytes (same nonce/hash), never buy a second lot.
export async function durableTransaction({ store, publicClient, walletClient, account, lease }, lot, step, requestFactory) {
  const id = `${lot.id}:${step}`;
  let record = await store.transaction(id);
  if (!record) {
    await lease();
    const request = await requestFactory();
    const prepared = await walletClient.prepareTransactionRequest({ ...request, account, chain: walletClient.chain });
    const serialized = await walletClient.signTransaction({ ...prepared, account });
    record = await store.saveTransaction({ id, scope: lot.scope, lot_id: lot.id, step, transaction_hash: keccak256(serialized), serialized_transaction: serialized });
  }
  if (keccak256(record.serialized_transaction) !== record.transaction_hash) throw new Error("Reinvestment transaction journal hash mismatch");
  await lease();
  let receipt;
  try { receipt = await publicClient.getTransactionReceipt({ hash: record.transaction_hash }); }
  catch (error) { if (error.name !== "TransactionReceiptNotFoundError") throw error; }
  if (!receipt) {
    try { await walletClient.sendRawTransaction({ serializedTransaction: record.serialized_transaction }); }
    catch (error) {
      // If accepted despite a transport error, reconciliation may continue.
      // Otherwise leave the immutable journal intact for the next tick.
      try { await publicClient.getTransaction({ hash: record.transaction_hash }); } catch { throw error; }
    }
  }
  receipt = await publicClient.waitForTransactionReceipt({ hash: record.transaction_hash, confirmations: 2, timeout: 120_000 });
  await store.patch("pack_reinvestment_transactions", id, { confirmed_at: new Date().toISOString(), receipt_status: receipt.status });
  if (receipt.status !== "success") throw new ReinvestmentReverted(`Reinvestment ${step} reverted: ${record.transaction_hash}`);
  return receipt;
}

async function balance(ctx, token) {
  return ctx.publicClient.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [ctx.account.address] });
}

async function approve(ctx, lot, token, spender, amount, step) {
  const previous = await ctx.store.transaction(`${lot.id}:${step}`);
  if (previous) await durableTransaction(ctx, lot, step, () => { throw new Error("Existing approval must not be rebuilt"); });
  const allowance = await ctx.publicClient.readContract({ address: token, abi: erc20, functionName: "allowance", args: [ctx.account.address, spender] });
  if (allowance >= amount) return;
  if (previous) throw new Error("Recorded approval no longer covers the lot; operator review required");
  await durableTransaction(ctx, lot, step, async () => ({ to: token, data: encodeFunctionData({ abi: erc20, functionName: "approve", args: [spender, amount] }), value: 0n }));
}

export function validateSaleQuote(quote, stock, budget) {
  if (!same(quote.sellToken, CANONICAL_USDG) || !same(quote.buyToken, stock.address) || BigInt(quote.sellAmount || 0) !== budget
    || BigInt(quote.transaction?.value || 0) !== 0n || BigInt(quote.minBuyAmount || 0) <= 0n) {
    throw new Error("Sale restock quote does not match its exact USDG budget and Stock Token");
  }
}

export async function processReinvestmentLot(ctx, epoch, initialLot) {
  let lot = initialLot;
  if (lot.completed_at) return;
  const budget = BigInt(lot.usd_atoms);
  if (await ctx.publicClient.readContract({ address: ctx.cfg.packContract, abi: packAbi, functionName: "activeRequestId" }) !== 0n) return;
  if (!lot.stock_address) {
    let selected;
    for (const stock of deterministicStockOrder(epoch.scan_block_hash, epoch.id, `sale-stock:${lot.lot_index}`).filter(stock => !ctx.cfg.stocks || ctx.cfg.stocks.some(allowed => same(allowed.address, stock.address)))) {
      try {
        const quote = await ctx.quote(CANONICAL_USDG, stock.address, budget);
        validateSaleQuote(quote, stock, budget);
        selected = stock;
        break;
      } catch { /* Try only the existing allowlisted stock rotation, before any transaction. */ }
    }
    if (!selected) throw new Error("No liquid Stock Token route for this sale-funded lot");
    lot = await ctx.store.patch("pack_reinvestment_lots", lot.id, { stock_address: selected.address, stock_symbol: selected.symbol });
  }
  const stock = { address: getAddress(lot.stock_address), symbol: lot.stock_symbol };
  if (ctx.cfg.stocks && !ctx.cfg.stocks.some(allowed => same(allowed.address, stock.address))) throw new Error("Stock is outside the configured pack universe");
  if (!await ctx.publicClient.readContract({ address: ctx.cfg.packContract, abi: packAbi, functionName: "approvedStock", args: [stock.address] })) throw new Error("Sale-funded Stock Token is no longer approved");
  if (!lot.token_amount_atoms) {
    const receipt = await durableTransaction(ctx, lot, "swap", async () => {
      if (await balance(ctx, CANONICAL_USDG) < budget) throw new Error("Treasury USDG is below the reserved sale budget; no unrelated funds will be swept");
      const quote = await ctx.quote(CANONICAL_USDG, stock.address, budget);
      validateSaleQuote(quote, stock, budget);
      await approve(ctx, lot, CANONICAL_USDG, quote.spender, budget, "usdg_approval");
      return { to: quote.transaction.to, data: quote.transaction.data, value: 0n };
    });
    const amount = receivedStockAtoms(receipt, stock.address, ctx.account.address);
    const spent = -receivedStockAtoms(receipt, CANONICAL_USDG, ctx.account.address);
    if (amount <= 0n || spent !== budget) throw new Error("Confirmed swap does not match the reserved USDG debit and received stock amount");
    lot = await ctx.store.patch("pack_reinvestment_lots", lot.id, { token_amount_atoms: amount.toString() });
  }
  if (!lot.declared_usd_micros) {
    const usd = await ctx.stockValue(stock, BigInt(lot.token_amount_atoms));
    if (usd <= 0n) throw new Error("Sale-funded lot has no usable live valuation");
    lot = await ctx.store.patch("pack_reinvestment_lots", lot.id, { declared_usd_micros: usd.toString() });
  }
  // Once a load was signed, reconcile it before checking an allowance that a
  // successful load may already have consumed.
  if (!await ctx.store.transaction(`${lot.id}:load_0`)) await approve(ctx, lot, stock.address, ctx.cfg.packContract, BigInt(lot.token_amount_atoms), "stock_approval");
  // A buyer can lock inventory between simulation and inclusion. Only a proven
  // reverted load may be retried with a new nonce; a pending load never is.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const receipt = await durableTransaction(ctx, lot, `load_${attempt}`, async () => {
        const { request } = await ctx.publicClient.simulateContract({ account: ctx.account, address: ctx.cfg.packContract, abi: packAbi, functionName: "loadPrize", args: [stock.address, BigInt(lot.token_amount_atoms), BigInt(lot.declared_usd_micros)] });
        return { to: request.address, data: encodeFunctionData(request), value: 0n };
      });
      await ctx.store.patch("pack_reinvestment_lots", lot.id, { completed_at: new Date().toISOString(), load_transaction: receipt.transactionHash });
      ctx.log("pack_sale_lot_loaded", { epoch: epoch.epoch_key, lotId: lot.id, budgetUsdgAtoms: lot.usd_atoms, stock: stock.symbol, transactionHash: receipt.transactionHash });
      return;
    } catch (error) { if (!(error instanceof ReinvestmentReverted) || attempt === 4) throw error; }
  }
}

export async function runPackReinvestment(ctx, now = new Date()) {
  if (ctx.cfg.mode === "off") return;
  if (await ctx.publicClient.getChainId() !== ROBINHOOD_CHAIN_ID) throw new Error("Receipt reinvestment requires Robinhood Chain 4663");
  const scope = `${ROBINHOOD_CHAIN_ID}:${ctx.cfg.packContract.toLowerCase()}:${ctx.account.address.toLowerCase()}`;
  // A signed but unbroadcast transaction reserves the signer's nonce. Recover
  // it before fee claims or pack settlement may use that wallet again.
  let pendingTransaction;
  try { pendingTransaction = await ctx.store.pendingTransaction(scope); }
  catch (error) {
    if (!ctx.cfg.reinvestEnabled && /PGRST205|42P01/.test(error.message)) return;
    throw error;
  }
  if (pendingTransaction && ctx.cfg.mode === "live") {
    if (!ctx.cfg.reinvestEnabled) throw new Error("A signed reinvestment transaction needs reconciliation; keep automation off until reviewed");
    const reserved = await ctx.store.pending(scope);
    if (!reserved || (await ctx.publicClient.getBlock({ blockNumber: BigInt(reserved.scan_to_block) })).hash !== reserved.scan_block_hash) throw new Error("Pending transaction has no canonical reserved sale budget; operator reconciliation required");
    try {
      await durableTransaction(ctx, { id: pendingTransaction.lot_id }, pendingTransaction.step, () => { throw new Error("Pending transaction must not be rebuilt"); });
    } catch (error) { if (!(error instanceof ReinvestmentReverted)) throw error; }
  }
  if (!ctx.cfg.reinvestEnabled) return;
  let epoch = await ctx.store.pending(scope);
  if (!epoch) {
    const key = epochKey(now);
    const previous = await ctx.store.latest(scope);
    if (previous?.epoch_key && new Date(previous.epoch_key).getTime() >= new Date(key).getTime()) return;
    const latest = await ctx.publicClient.getBlockNumber();
    const cutoff = await lastClosedBlock(ctx.publicClient, latest, BigInt(Date.parse(key) / 1000));
    if (!cutoff) return;
    if (!previous && !await ctx.publicClient.getBytecode({ address: ctx.cfg.packContract, blockNumber: cutoff.number })) return;
    if (previous && (await ctx.publicClient.getBlock({ blockNumber: BigInt(previous.scan_to_block) })).hash !== previous.scan_block_hash) throw new Error("Reinvestment scan checkpoint reorganized; operator reconciliation required");
    const start = previous ? BigInt(previous.scan_to_block) + 1n : ctx.cfg.packStartBlock ?? await discoverContractStartBlock(cutoff.number, blockNumber => ctx.publicClient.getBytecode({ address: ctx.cfg.packContract, blockNumber }));
    if (start > cutoff.number) return;
    const receipts = [];
    const seen = new Set();
    for (let from = start; from <= cutoff.number; from += 2000n) {
      await ctx.lease();
      const logs = await ctx.publicClient.getLogs({ address: ctx.cfg.packContract, event: delivered, fromBlock: from, toBlock: from + 1999n > cutoff.number ? cutoff.number : from + 1999n });
      for (const log of logs) {
        if (log.removed) throw new Error("Reorganized pack sale log");
        if (seen.has(log.transactionHash)) continue;
        seen.add(log.transactionHash);
        const receipt = await ctx.publicClient.getTransactionReceipt({ hash: log.transactionHash });
        if (receipt.blockHash !== log.blockHash || receipt.blockNumber > cutoff.number) throw new Error("Pack settlement changed during receipt scan");
        const sale = saleFromReceipt(receipt, ctx.cfg.packContract, ctx.account.address, ctx.cfg.priceAtoms);
        if (sale) receipts.push(sale);
      }
    }
    if ((await ctx.publicClient.getBlock({ blockNumber: cutoff.number })).hash !== cutoff.hash) throw new Error("Reinvestment cutoff reorganized during scan");
    const budget = receipts.reduce((sum, row) => sum + BigInt(row.amount_atoms), 0n);
    const id = `${scope}:${key}`;
    const lots = planLots(budget, cutoff.hash, id, ctx.cfg.priceAtoms, ctx.cfg.restockLotUsd);
    epoch = { id, scope, epoch_key: key, chain_id: ROBINHOOD_CHAIN_ID, pack_contract: ctx.cfg.packContract.toLowerCase(), treasury: ctx.account.address.toLowerCase(), scan_from_block: start.toString(), scan_to_block: cutoff.number.toString(), scan_block_hash: cutoff.hash, budget_atoms: budget.toString(), status: lots.length ? "planned" : "complete" };
    if (ctx.cfg.mode === "dry-run") {
      ctx.log("pack_sale_reinvestment_dry_run", { epoch: key, settledSales: receipts.length, budgetUsdgAtoms: budget.toString(), lotBudgetsUsdgAtoms: lots.map(lot => lot.usd_atoms) });
      return;
    }
    await ctx.lease();
    epoch = await ctx.store.reserve(epoch, receipts, lots, ctx.holder);
  }
  // Mode changes never execute or consume a previously reserved live plan.
  if (ctx.cfg.mode !== "live" || epoch.status === "complete") return;
  if ((await ctx.publicClient.getBlock({ blockNumber: BigInt(epoch.scan_to_block) })).hash !== epoch.scan_block_hash) throw new Error("Reserved sale receipts reorganized; operator reconciliation required");
  const lots = await ctx.store.lots(epoch.id);
  if (lots.reduce((sum, lot) => sum + BigInt(lot.usd_atoms), 0n) !== BigInt(epoch.budget_atoms)) throw new Error("Reinvestment lot budgets do not reconcile");
  const pending = lots.find(lot => !lot.completed_at);
  if (pending) await processReinvestmentLot(ctx, epoch, pending);
  if (!pending || (await ctx.store.lots(epoch.id)).every(lot => lot.completed_at)) {
    await ctx.store.patch("pack_reinvestment_epochs", epoch.id, { status: "complete", completed_at: new Date().toISOString() });
    ctx.log("pack_sale_reinvestment_complete", { epoch: epoch.epoch_key, budgetUsdgAtoms: epoch.budget_atoms, fundedLots: lots.length });
  }
}

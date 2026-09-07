import test from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, keccak256, parseAbiItem } from "viem";
import { CANONICAL_USDG, STOCK_TOKENS } from "./pons-core.mjs";
import { durableTransaction, lastClosedBlock, LOT_VALUES_USD, planLots, processReinvestmentLot, receivedStockAtoms, runPackReinvestment, saleFromReceipt, validateSaleQuote } from "./pack-reinvestment.mjs";

const pack = "0x0000000000000000000000000000000000000001";
const treasury = "0x0000000000000000000000000000000000000002";
const buyer = "0x0000000000000000000000000000000000000003";
const router = "0x0000000000000000000000000000000000000004";
const hash = `0x${"ab".repeat(32)}`;
const transferEvent = parseAbiItem("event Transfer(address indexed from,address indexed to,uint256 value)");
const prizeEvent = parseAbiItem("event PrizeDelivered(uint256 indexed requestId,address indexed buyer,address indexed token,uint256 tokenAmount,uint256 declaredUsdMicros)");
function transferLog(token, from, to, value) {
  return { address: token, topics: encodeEventTopics({ abi: [transferEvent], args: { from, to } }), data: encodeAbiParameters([{ type: "uint256" }], [value]) };
}
function saleReceipt() {
  return { status: "success", transactionHash: hash, blockNumber: 100n, blockHash: hash, logs: [
    { address: pack, topics: encodeEventTopics({ abi: [prizeEvent], args: { requestId: 1n, buyer, token: STOCK_TOKENS[0].address } }), data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [123456789012345678n, 25_000_000n]) },
    transferLog(CANONICAL_USDG, pack, treasury, 20_000_000n),
    transferLog(STOCK_TOKENS[0].address, pack, buyer, 123456789012345678n),
  ] };
}

test("only a settled pack with its exact canonical USDG treasury payment counts", () => {
  const receipt = saleReceipt();
  assert.equal(saleFromReceipt(receipt, pack, treasury).amount_atoms, "20000000");
  assert.equal(saleFromReceipt({ ...receipt, status: "reverted" }, pack, treasury), null);
  assert.equal(saleFromReceipt({ ...receipt, logs: receipt.logs.slice(0, 2) }, pack, treasury), null, "an event without actual stock delivery is not a sale");
  assert.equal(saleFromReceipt({ ...receipt, logs: [receipt.logs[1]] }, pack, treasury), null);
  assert.equal(saleFromReceipt({ ...receipt, logs: [receipt.logs[0], transferLog(CANONICAL_USDG, buyer, treasury, 20_000_000n)] }, pack, treasury), null);
  assert.equal(saleFromReceipt({ ...receipt, logs: [receipt.logs[0], transferLog(CANONICAL_USDG, pack, buyer, 20_000_000n)] }, pack, treasury), null);
  assert.equal(saleFromReceipt({ ...receipt, logs: [receipt.logs[0], transferLog(STOCK_TOKENS[0].address, pack, treasury, 20_000_000n)] }, pack, treasury), null);
  assert.equal(saleFromReceipt({ ...receipt, logs: [receipt.logs[0], transferLog(CANONICAL_USDG, pack, treasury, 40_000_000n)] }, pack, treasury), null);
});

test("varied lot sizes preserve every USDG atom and are stable across restarts", () => {
  for (let sales = 1; sales <= 100; sales += 1) {
    const budget = BigInt(sales) * 20_000_000n;
    const lots = planLots(budget, hash, `hour:${sales}`);
    assert.equal(lots.reduce((sum, lot) => sum + BigInt(lot.usd_atoms), 0n), budget);
    assert(lots.every(lot => LOT_VALUES_USD.includes(Number(lot.usd_atoms) / 1e6)));
    assert.deepEqual(lots, planLots(budget, hash, `hour:${sales}`));
  }
  assert(planLots(20_000_000n, hash, "one").length > 1);
  assert.deepEqual(planLots(0n, hash, "empty"), []);
  assert.throws(() => planLots(19_000_000n, hash, "invalid"));
});

test("hourly cutoff excludes the current hour and the last twelve blocks", async () => {
  const client = { getBlock: async ({ blockNumber }) => ({ number: blockNumber, timestamp: blockNumber, hash }) };
  assert.equal((await lastClosedBlock(client, 200n, 150n)).number, 149n);
  assert.equal((await lastClosedBlock(client, 200n, 1000n)).number, 188n);
  assert.equal(await lastClosedBlock(client, 10n, 1000n), null);
});

test("stock output comes from swap receipt, not unrelated treasury balances", () => {
  const stock = STOCK_TOKENS[0].address;
  const receipt = { logs: [transferLog(stock, router, treasury, 100000000000000001n), transferLog(stock, treasury, router, 1n), transferLog(stock, buyer, pack, 9000000000000000000n)] };
  assert.equal(receivedStockAtoms(receipt, stock, treasury), 100000000000000000n);
});

test("quotes cannot exceed the recorded USDG budget or substitute assets/ETH", () => {
  const stock = STOCK_TOKENS[0];
  const quote = { sellToken: CANONICAL_USDG, buyToken: stock.address, sellAmount: "20000000", minBuyAmount: "1", transaction: { value: "0" } };
  validateSaleQuote(quote, stock, 20_000_000n);
  for (const patch of [{ sellAmount: "21000000" }, { sellToken: buyer }, { buyToken: buyer }, { minBuyAmount: "0" }, { transaction: { value: "1" } }]) assert.throws(() => validateSaleQuote({ ...quote, ...patch }, stock, 20_000_000n));
});

function transactionHarness() {
  const journal = new Map();
  const events = [];
  let failSave = false;
  let failSend = false;
  let receipt;
  const ctx = {
    account: { address: treasury },
    lease: async () => { events.push("lease"); },
    store: {
      transaction: async id => journal.get(id),
      saveTransaction: async row => { events.push("persist"); if (failSave) throw new Error("DB unavailable"); journal.set(row.id, row); return row; },
      patch: async (_table, id, patch) => { journal.set(id, { ...journal.get(id), ...patch }); return journal.get(id); },
    },
    publicClient: {
      getTransactionReceipt: async () => { if (receipt) return receipt; const error = new Error("not found"); error.name = "TransactionReceiptNotFoundError"; throw error; },
      getTransaction: async () => { throw new Error("not found"); },
      waitForTransactionReceipt: async ({ hash: txHash }) => receipt || { status: "success", transactionHash: txHash, logs: [] },
    },
    walletClient: {
      chain: { id: 4663 },
      prepareTransactionRequest: async request => { events.push("prepare"); return request; },
      signTransaction: async () => { events.push("sign"); return "0x1234"; },
      sendRawTransaction: async ({ serializedTransaction }) => { events.push(`broadcast:${serializedTransaction}`); if (failSend) throw new Error("connection lost"); },
    },
  };
  return { ctx, journal, events, failSave: () => { failSave = true; }, failSend: () => { failSend = true; }, succeedSend: () => { failSend = false; }, receipt: value => { receipt = value; } };
}

test("no broadcast occurs until the signed transaction is durably saved", async () => {
  const h = transactionHarness(); h.failSave();
  await assert.rejects(durableTransaction(h.ctx, { id: "lot", scope: "scope" }, "swap", async () => ({ to: router })), /DB unavailable/);
  assert.equal(h.events.some(event => event.startsWith("broadcast")), false);
});

test("an uncertain broadcast retries exactly the same signed bytes without a second quote or signature", async () => {
  const h = transactionHarness(); h.failSend();
  await assert.rejects(durableTransaction(h.ctx, { id: "lot" }, "swap", async () => ({ to: router })), /connection lost/);
  h.succeedSend();
  await durableTransaction(h.ctx, { id: "lot" }, "swap", () => { throw new Error("must not quote again"); });
  assert.deepEqual(h.events.filter(event => event.startsWith("broadcast")), ["broadcast:0x1234", "broadcast:0x1234"]);
  assert.equal(h.events.filter(event => event === "sign").length, 1);
  assert(h.events.indexOf("persist") < h.events.indexOf("broadcast:0x1234"));
});

test("a mined transaction is reconciled without another broadcast", async () => {
  const h = transactionHarness();
  h.journal.set("lot:swap", { transaction_hash: keccak256("0x1234"), serialized_transaction: "0x1234" });
  h.receipt({ status: "success", transactionHash: keccak256("0x1234"), logs: [] });
  await durableTransaction(h.ctx, { id: "lot" }, "swap", () => { throw new Error("must not sign"); });
  assert.equal(h.events.some(event => event.startsWith("broadcast")), false);
});

test("a lost lease or corrupt signed record cannot broadcast", async () => {
  const h = transactionHarness();
  h.ctx.lease = async () => { throw new Error("lease lost"); };
  await assert.rejects(durableTransaction(h.ctx, { id: "lot" }, "swap", async () => ({})), /lease lost/);
  h.journal.set("lot:swap", { transaction_hash: hash, serialized_transaction: "0x1234" });
  await assert.rejects(durableTransaction(h.ctx, { id: "lot" }, "swap", async () => ({})), /hash mismatch/);
  assert.equal(h.events.some(event => event.startsWith("broadcast")), false);
});

function runnerContext(mode = "dry-run") {
  const boundary = BigInt(Date.parse("2026-09-07T12:00:00Z") / 1000);
  const events = [];
  const ctx = {
    cfg: { mode, reinvestEnabled: true, packContract: pack, packStartBlock: 1n }, account: { address: treasury }, holder: "holder",
    lease: async () => {}, log: (event, details) => events.push({ event, details }),
    store: { pendingTransaction: async () => null, pending: async () => null, latest: async () => null, reserve: async () => { throw new Error("dry run must not reserve money"); } },
    publicClient: {
      getChainId: async () => 4663,
      getBlockNumber: async () => 120n,
      getBlock: async ({ blockNumber }) => ({ number: blockNumber, timestamp: boundary - 110n + blockNumber, hash }),
      getBytecode: async () => "0x1234",
      getLogs: async () => [{ transactionHash: hash, blockHash: hash }, { transactionHash: hash, blockHash: hash }],
      getTransactionReceipt: async () => saleReceipt(),
    },
  };
  return { ctx, events };
}

test("dry-run previews a deduplicated receipt budget without reserving or broadcasting", async () => {
  const { ctx, events } = runnerContext();
  await runPackReinvestment(ctx, new Date("2026-09-07T12:05:00Z"));
  assert.equal(events[0].details.settledSales, 1);
  assert.equal(events[0].details.budgetUsdgAtoms, "20000000");
});

test("completed hourly plans are not rerun; deposits without sales create no lots", async () => {
  const { ctx, events } = runnerContext();
  ctx.publicClient.getLogs = async () => [];
  await runPackReinvestment(ctx, new Date("2026-09-07T12:05:00Z"));
  assert.equal(events[0].details.budgetUsdgAtoms, "0");
  ctx.store.latest = async () => ({ epoch_key: "2026-09-07T12:00:00Z" });
  ctx.publicClient.getBlockNumber = async () => { throw new Error("same hour must not rescan"); };
  await runPackReinvestment(ctx, new Date("2026-09-07T12:40:00Z"));
});

test("off mode and a disabled receipt flag never spend", async () => {
  await runPackReinvestment({ cfg: { mode: "off" } });
  const { ctx } = runnerContext("live");
  ctx.cfg.reinvestEnabled = false;
  ctx.store.pending = async () => { throw new Error("disabled must not plan"); };
  await runPackReinvestment(ctx);
});

test("a pending signed transaction is recovered before any other wallet action", async () => {
  const h = transactionHarness();
  h.journal.set("lot:swap", { transaction_hash: keccak256("0x1234"), serialized_transaction: "0x1234" });
  Object.assign(h.ctx, { cfg: { mode: "live", reinvestEnabled: true, packContract: pack } });
  h.ctx.store.pendingTransaction = async () => ({ lot_id: "lot", step: "swap" });
  h.ctx.publicClient.getChainId = async () => 4663;
  h.ctx.publicClient.getBlock = async () => ({ hash });
  let reads = 0;
  h.ctx.store.pending = async () => {
    if (reads++ === 0) return { scan_to_block: "100", scan_block_hash: hash };
    assert(h.events.includes("broadcast:0x1234"));
    throw new Error("stop after reconciliation");
  };
  await assert.rejects(runPackReinvestment(h.ctx), /stop after reconciliation/);
});

test("a completed load whose database acknowledgement was lost is not loaded twice", async () => {
  const h = transactionHarness();
  h.journal.set("lot:load_0", { transaction_hash: keccak256("0x1234"), serialized_transaction: "0x1234" });
  h.receipt({ status: "success", transactionHash: keccak256("0x1234"), logs: [] });
  Object.assign(h.ctx, { cfg: { packContract: pack }, log: () => {} });
  h.ctx.publicClient.readContract = async ({ functionName }) => {
    if (functionName === "activeRequestId") return 0n;
    if (functionName === "approvedStock") return true;
    throw new Error("must not check an already consumed allowance");
  };
  await processReinvestmentLot(h.ctx, { epoch_key: "hour" }, { id: "lot", usd_atoms: "5000000", stock_address: STOCK_TOKENS[0].address, stock_symbol: "SPY", token_amount_atoms: "100000000000000001", declared_usd_micros: "4990000" });
  assert.equal(h.events.some(event => event.startsWith("broadcast")), false);
  assert(h.journal.get("lot").completed_at);
});

test("a fresh lot approves exact USDG, buys stock, loads exact atoms, and never repeats a completed lot", async () => {
  const h = transactionHarness();
  const requests = new Map();
  const mined = new Map();
  let signed = 0;
  let selectedStock;
  let loadedAmount;
  const output = 100000000000000001n;
  let lot = { id: "fresh", scope: "scope", usd_atoms: "5000000", lot_index: 0 };
  const basePatch = h.ctx.store.patch;
  h.ctx.store.patch = async (table, id, patch) => {
    if (table === "pack_reinvestment_lots") { lot = { ...lot, ...patch }; return lot; }
    return basePatch(table, id, patch);
  };
  Object.assign(h.ctx, {
    cfg: { packContract: pack }, log: () => {},
    quote: async (_sell, buyToken) => {
      selectedStock = buyToken;
      return { sellToken: CANONICAL_USDG, buyToken, sellAmount: "5000000", minBuyAmount: "1", spender: router, transaction: { to: router, data: "0xfeed", value: "0" } };
    },
    stockValue: async (_stock, amount) => { assert.equal(amount, output); return 4_990_000n; },
  });
  h.ctx.publicClient.readContract = async ({ functionName }) => {
    if (functionName === "approvedStock") return true;
    if (functionName === "activeRequestId" || functionName === "allowance") return 0n;
    if (functionName === "balanceOf") return 20_000_000n;
    throw new Error(`unexpected ${functionName}`);
  };
  h.ctx.publicClient.simulateContract = async request => { loadedAmount = request.args[1]; return { request }; };
  h.ctx.walletClient.signTransaction = async request => {
    const raw = `0x${(++signed).toString(16).padStart(2, "0")}`;
    requests.set(keccak256(raw), request);
    return raw;
  };
  h.ctx.walletClient.sendRawTransaction = async ({ serializedTransaction }) => {
    const txHash = keccak256(serializedTransaction);
    const request = requests.get(txHash);
    assert(h.journal.values().some(row => row.transaction_hash === txHash), "must persist before broadcasting");
    mined.set(txHash, { status: "success", transactionHash: txHash, logs: request.to === router ? [
      transferLog(CANONICAL_USDG, treasury, router, 5_000_000n),
      transferLog(selectedStock, router, treasury, output),
    ] : [] });
  };
  h.ctx.publicClient.getTransactionReceipt = async ({ hash: txHash }) => {
    if (mined.has(txHash)) return mined.get(txHash);
    const error = new Error("pending"); error.name = "TransactionReceiptNotFoundError"; throw error;
  };
  h.ctx.publicClient.waitForTransactionReceipt = async ({ hash: txHash }) => mined.get(txHash);
  await processReinvestmentLot(h.ctx, { id: "epoch", epoch_key: "hour", scan_block_hash: hash }, lot);
  assert.equal(signed, 4);
  assert.equal(loadedAmount, output);
  assert.equal(lot.token_amount_atoms, output.toString());
  assert.equal(lot.declared_usd_micros, "4990000");
  assert(lot.completed_at);
  const usdApproval = [...requests.values()].find(request => request.to === CANONICAL_USDG);
  assert.equal(BigInt(`0x${usdApproval.data.slice(-64)}`), 5_000_000n);
  await processReinvestmentLot(h.ctx, {}, lot);
  assert.equal(signed, 4);
});

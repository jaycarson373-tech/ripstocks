import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTransfers,
  discoverContractStartBlock,
  deterministicStockOrder,
  epochKey,
  splitAmount,
  ticketUnit,
  usdMicrosForTokenAmount,
  weightedWinner,
} from "./pons-core.mjs";

test("hourly epoch keys are stable", () => {
  assert.equal(epochKey(new Date("2026-09-02T14:59:59.999Z")), "2026-09-02T14:00:00.000Z");
  assert.equal(epochKey(new Date("2026-09-02T15:00:00.000Z")), "2026-09-02T15:00:00.000Z");
});

test("50/50 split preserves every atom", () => {
  assert.deepEqual(splitAmount(101n, 5_000), [50n, 51n]);
});

test("weighted tickets exclude dust and select deterministically", () => {
  const unit = ticketUnit("250000", 18);
  const candidates = [
    { address: "0x0000000000000000000000000000000000000001", balance: unit - 1n },
    { address: "0x0000000000000000000000000000000000000002", balance: unit },
    { address: "0x0000000000000000000000000000000000000003", balance: unit * 2n },
  ];
  assert.equal(weightedWinner(candidates, 0n, unit).winner, candidates[1].address);
  assert.equal(weightedWinner(candidates, 2n, unit).winner, candidates[2].address);
});

test("transfer replay creates the expected balances", () => {
  const zero = "0x0000000000000000000000000000000000000000";
  const a = "0x0000000000000000000000000000000000000001";
  const b = "0x0000000000000000000000000000000000000002";
  const balances = applyTransfers([
    { args: { from: zero, to: a, value: 100n } },
    { args: { from: a, to: b, value: 30n } },
  ]);
  assert.deepEqual(balances, [{ address: a, balance: 70n }, { address: b, balance: 30n }]);
});

test("USD value applies the Stock Token multiplier", () => {
  assert.equal(usdMicrosForTokenAmount(500000000000000000n, "200", "1"), 100_000_000n);
  assert.equal(usdMicrosForTokenAmount(500000000000000000n, "200", "0.5"), 50_000_000n);
});

test("stock order is deterministic and contains the full rotation", () => {
  const first = deterministicStockOrder(`0x${"12".repeat(32)}`, "epoch", "drop");
  const second = deterministicStockOrder(`0x${"12".repeat(32)}`, "epoch", "drop");
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map((stock) => stock.symbol)).size, 10);
});

test("contract deployment block is discovered without a configured start block", async () => {
  const start = await discoverContractStartBlock(1_000n, async (block) => block >= 637n ? "0x6000" : undefined);
  assert.equal(start, 637n);
});

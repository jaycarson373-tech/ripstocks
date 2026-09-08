import assert from "node:assert/strict";
import test from "node:test";
import { buildCaseReel } from "../app/lib/case-reel.ts";

test("the contained reel lands exactly once on the committed result", () => {
  const stocks = ["SPY", "NVDA", "TSLA", "META"].map(symbol => ({ symbol }));
  const winner = stocks[1];
  const items = buildCaseReel(stocks, winner, "RARE", () => "STANDARD");
  const winningItems = items.map((item, index) => ({ ...item, index })).filter(item => item.winning);

  assert.equal(items.length, 51);
  assert.equal(winningItems.length, 1);
  assert.equal(winningItems[0].index, 45);
  assert.equal(winningItems[0].stock, winner);
  assert.equal(winningItems[0].rarity, "RARE");
});

test("presentation tiles are deterministic and never change the winner", () => {
  const stocks = ["SPY", "NVDA", "TSLA"].map(symbol => ({ symbol }));
  const first = buildCaseReel(stocks, stocks[2], "REDLINE", () => "STANDARD");
  const second = buildCaseReel(stocks, stocks[2], "REDLINE", () => "STANDARD");
  assert.deepEqual(first, second);
});

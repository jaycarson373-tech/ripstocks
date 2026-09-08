import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildCaseReel, CASE_REVEAL_TIMING, CASE_WINNER_INDEX, PACK_OPENING_INTRO_MS, fixedReelPosition } from "../app/lib/case-reel.ts";
import { pollDelivery, deliveryPause, OPENING_WAIT_MS } from "../app/lib/delivery-polling.ts";

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

test("every reel takes ten seconds and decelerates continuously without a speed-up", () => {
  assert.equal(CASE_REVEAL_TIMING.spinMs, 10000);
  assert.equal(fixedReelPosition(0), 4);
  let previous = 4;
  let previousStep = Infinity;
  for (let ms = 50; ms <= 10000; ms += 50) {
    const next = fixedReelPosition(ms);
    const step = next - previous;
    assert.ok(step >= 0 && step <= previousStep + 1e-10);
    assert.ok(next <= CASE_WINNER_INDEX);
    previous = next;
    previousStep = step;
  }
  assert.equal(fixedReelPosition(10000), CASE_WINNER_INDEX);
  assert.equal(fixedReelPosition(60000), CASE_WINNER_INDEX);
});

test("inline reels declare their own desktop and mobile tile dimensions", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.hero-pack-result \{ --case-card-width: 112px; --case-card-gap: 10px;/);
  assert.match(css, /\.hero-pack-result \{ --case-card-width: 86px; --case-card-gap: 8px;/);
  assert.doesNotMatch(css, /pendingCaseSpin|pending-reel-track/);
  assert.match(css, /\.hero-pack-result\.continuous-opening \.hero-case-reel \.case-reel-track \{ animation: none;/);
});

test("payment and delivery use one mounted reel with no separate loading screen", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const component = readFileSync(new URL("../app/components/pack-opening.tsx", import.meta.url), "utf8");
  assert.match(page, /\(pendingReveal \|\| packOutcome \|\| packResult\) &&/);
  assert.equal((page.match(/<PackOpening /g) || []).length, 1);
  assert.doesNotMatch(page, /CONFIRMING YOUR STOCK|className="pending-pack-reveal"|setRevealStage/);
  assert.match(component, /if \(!spinStarted \|\| !result\) return/);
  assert.match(component, /prefers-reduced-motion/);
  assert.match(component, /OPENING PACK/);
  assert.doesNotMatch(page, /No second confirmation needed\. The operator/);
});

test("a delayed delivery is recovered beyond the old 32-attempt cutoff, exactly once", async () => {
  let reads = 0;
  const delivered = [];
  const result = { requestId: "test-only", symbol: "PLTR" };
  await pollDelivery({ signal: new AbortController().signal, pause: async () => {},
    read: async () => { if (++reads < 40) throw new Error("Transient RPC failure"); return result; },
    onDelivered: value => delivered.push(value),
  });
  assert.equal(reads, 40);
  assert.deepEqual(delivered, [result]);
});

test("closing a receipt lookup cancels future reads and ignores a late response", async () => {
  const controller = new AbortController();
  let reads = 0;
  await pollDelivery({ signal: controller.signal,
    read: async () => { reads++; controller.abort(); return { transactionHash: "test-only" }; },
    onDelivered: () => assert.fail("Unmounted lookup must not update the UI"),
  });
  assert.equal(reads, 1);
  await deliveryPause(60_000, controller.signal);
});

test("late delivery cannot restart the reel or produce an invented stock", () => {
  assert.equal(OPENING_WAIT_MS, 30_000);
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const component = readFileSync(new URL("../app/components/pack-opening.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(component, /if \(waiting\) return|hidden=\{waiting\}|TAKING A LITTLE LONGER|DELIVERY PENDING/);
  assert.match(component, /\}, \[spinStarted, result\?\.stock\.symbol\]\)/);
  assert.doesNotMatch(component, /planReelLanding|Math\.exp|% cycle|\}, \[result\]\)/);
  assert.doesNotMatch(component, /SEALED|RESULT PENDING/);
  assert.match(component, /revealDelivered && children/);
  assert.match(component, /DELIVERING TO WALLET/);
  assert.match(component, /highlightWinner = winning && phase !== "spinning"/);
  assert.match(page, /delivered=\{Boolean\(packResult\)\}/);
  assert.doesNotMatch(page, /attempt < 32|RETRY DELIVERY/);
});

test("pack intro and reel timing are fixed, even when delivery is already known", () => {
  assert.equal(PACK_OPENING_INTRO_MS, 850);
  const firstStep = fixedReelPosition(1000) - 4;
  const lastStep = CASE_WINNER_INDEX - fixedReelPosition(9000);
  assert.ok(firstStep > lastStep * 10);
});

test("the pre-delivery reel outcome comes from the contract settlement simulation only", () => {
  const delivery = readFileSync(new URL("../app/api/robinhood/delivery/route.ts", import.meta.url), "utf8");
  assert.match(delivery, /function settlePack/);
  assert.match(delivery, /eth_call/);
  assert.doesNotMatch(delivery, /encodePacked|prizeAt/);
});

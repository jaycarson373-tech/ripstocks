import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildCaseReel, CASE_REVEAL_TIMING, planReelLanding, reelPositionAt } from "../app/lib/case-reel.ts";

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

test("replays retain the long spin but a paid reel lands promptly on delivery", () => {
  assert.equal(CASE_REVEAL_TIMING.spinMs, 6500);
  assert.deepEqual(planReelLanding(10, true), { index: 45, durationMs: 6500 });
  for (const position of [10, 12.4, 19.999]) {
    const plan = planReelLanding(position, false);
    assert.ok(plan.index > position && plan.index < 64);
    assert.equal(plan.durationMs, 1000);
    assert.equal(reelPositionAt(position, plan.index, 0), position);
    assert.equal(reelPositionAt(position, plan.index, 1), plan.index);
    let previous = position;
    for (let p = 0; p <= 1; p += .01) {
      const next = reelPositionAt(position, plan.index, p);
      assert.ok(next >= previous && next <= plan.index);
      previous = next;
    }
  }
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
  assert.match(page, /\(pendingReveal \|\| packResult\) &&/);
  assert.equal((page.match(/<PackOpening /g) || []).length, 1);
  assert.doesNotMatch(page, /CONFIRMING YOUR STOCK|className="pending-pack-reveal"|setRevealStage/);
  assert.match(component, /if \(!result\) return/);
  assert.match(component, /prefers-reduced-motion/);
  assert.match(component, /OPENING PACK/);
  assert.doesNotMatch(page, /No second confirmation needed\. The operator/);
});

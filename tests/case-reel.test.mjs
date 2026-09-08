import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildCaseReel, CASE_REVEAL_TIMING } from "../app/lib/case-reel.ts";

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

test("reel CSS and phase timers share the longer spin duration", () => {
  assert.equal(CASE_REVEAL_TIMING.spinMs, 6500);
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /introMs \+ spinMs \+ lockMs/);
  assert.match(page, /--reel-spin-duration/);
  assert.match(css, /heroCaseSpin var\(--reel-spin-duration, 6\.5s\)/);
});

test("inline reels declare their own desktop and mobile tile dimensions", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.hero-pack-result \{ --case-card-width: 112px; --case-card-gap: 10px;/);
  assert.match(css, /\.hero-pack-result \{ --case-card-width: 86px; --case-card-gap: 8px;/);
  assert.doesNotMatch(css, /pendingCaseSpin|pending-reel-track/);
});

test("confirmed auto and fallback delivery enter the animation unless reduced motion is requested", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const start of ["if (delivered) {", "const prizeLog = settleReceipt.logs.find"]) {
    const flow = page.slice(page.indexOf(start), page.indexOf("setPackResult(", page.indexOf(start)));
    assert.match(flow, /setRevealStage\(window.matchMedia\("\(prefers-reduced-motion: reduce\)"\).matches \? "reveal" : "pack"\)/);
  }
  assert.doesNotMatch(page, /No second confirmation needed\. The operator/);
  const pending = page.slice(page.indexOf("{pendingReveal && !packResult && ("), page.indexOf('className="stock-universe-strip'));
  assert.match(pending, /PAYMENT CONFIRMED/);
  assert.doesNotMatch(pending, /case-reel|STOCK PREVIEW|pendingReelItems/);
});

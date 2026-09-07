import test from "node:test";
import assert from "node:assert/strict";
import { rarityForValue } from "../app/lib/rarity.ts";

const tiers = [
  { id: "standard", label: "STANDARD", color: "blue", minUsd: 0, maxUsdExclusive: 10 },
  { id: "uncommon", label: "UNCOMMON", color: "purple", minUsd: 10, maxUsdExclusive: 20 },
  { id: "rare", label: "RARE", color: "pink", minUsd: 20, maxUsdExclusive: 50 },
  { id: "redline", label: "REDLINE", color: "red", minUsd: 50, maxUsdExclusive: 100 },
  { id: "golden-rip", label: "GOLDEN RIP", color: "gold", minUsd: 100, maxUsdExclusive: null },
];

test("rarity boundaries are deterministic and configurable", () => {
  assert.equal(rarityForValue(0, tiers).id, "standard");
  assert.equal(rarityForValue(9.999, tiers).id, "standard");
  assert.equal(rarityForValue(10, tiers).id, "uncommon");
  assert.equal(rarityForValue(20, tiers).id, "rare");
  assert.equal(rarityForValue(50, tiers).id, "redline");
  assert.equal(rarityForValue(100, tiers).id, "golden-rip");
});

test("invalid values fail closed to the first configured tier", () => {
  assert.equal(rarityForValue(Number.NaN, tiers).id, "standard");
  assert.equal(rarityForValue(-1, tiers).id, "standard");
});

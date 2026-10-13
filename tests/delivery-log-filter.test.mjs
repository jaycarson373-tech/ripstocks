import assert from "node:assert/strict";
import test from "node:test";
import { buildDeliveryLogFilter } from "../app/lib/delivery-log-filter.ts";

test("delivery receipt lookup is restricted to the configured pack contract", () => {
  const contract = `0x${"a".repeat(40)}`;
  const buyer = `0x${"B".repeat(40)}`;
  const filter = buildDeliveryLogFilter({
    contract,
    fromBlock: 12n,
    toBlock: 34n,
    requestId: 7n,
    buyer,
  });

  assert.equal(filter.address, contract);
  assert.equal(filter.fromBlock, "0xc");
  assert.equal(filter.toBlock, "0x22");
  assert.deepEqual(filter.topics, [
    "0xc69fc309161aff2ea1fca64cb7735c168e84ea865b4e3683d8f84b742339d656",
    `0x${"0".repeat(63)}7`,
    `0x${"0".repeat(24)}${"b".repeat(40)}`,
  ]);
});

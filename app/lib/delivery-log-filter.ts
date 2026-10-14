/** Build a narrowly scoped event query for one pack contract and buyer. */
export function buildDeliveryLogFilter({
  contract,
  fromBlock,
  toBlock,
  requestId,
  buyer,
}: {
  contract: string;
  fromBlock: bigint;
  toBlock: bigint;
  requestId: bigint;
  buyer: string;
}) {
  return {
    address: contract,
    fromBlock: `0x${fromBlock.toString(16)}`,
    toBlock: `0x${toBlock.toString(16)}`,
    topics: [
      "0xc69fc309161aff2ea1fca64cb7735c168e84ea865b4e3683d8f84b742339d656",
      `0x${requestId.toString(16).padStart(64, "0")}`,
      `0x${buyer.slice(2).toLowerCase().padStart(64, "0")}`,
    ],
  };
}

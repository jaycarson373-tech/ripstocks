import { parseAbi } from "viem";

// Actual v2 fee escrow read interface, https://docs.ponsfamily.com/v2.
// No guessed deployment addresses, no legacy collectFees/feeRedirects calls.
export const ponsV2EscrowAbi = parseAbi([
  "function balanceOf(address recipient) view returns (uint256)",
  "function balanceOfToken(address recipient,address token) view returns (uint256)",
  "function claim()",
  "function claimToken(address token)"
]);
export function ponsV2Adapter() {
  return {
    enabled: false,
    status: "Awaiting Pons v2 launch configuration and integration verification",
    async claimCreatorFees() { throw new Error("Pons v2 claiming is disabled; no creator private key is required or accepted"); },
    async payHolderReward() { throw new Error("Holder rewards are disabled until Pons v2 is integrated and verified"); }
  };
}

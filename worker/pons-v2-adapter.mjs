import { encodeFunctionData, getAddress, parseAbi } from "viem";

// Actual v2 fee escrow read interface, https://docs.ponsfamily.com/v2.
// No guessed deployment addresses, no legacy collectFees/feeRedirects calls.
export const ponsV2EscrowAbi = parseAbi([
  "function balanceOf(address recipient) view returns (uint256)",
  "function balanceOfToken(address recipient,address token) view returns (uint256)",
  "function claim()",
  "function claimToken(address token)"
]);
export const ponsV2FactoryAbi = parseAbi([
  "struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }",
  "function getLaunchedToken(address token) view returns (LaunchedToken)"
]);
export const ponsV2CurveAbi = parseAbi(["function sweepFees(uint256 minBuybackTokensOut)"]);

export async function validatePonsLaunch({ publicClient, factory, token, recipient, feeAsset }) {
  const launch = await publicClient.readContract({ address: factory, abi: ponsV2FactoryAbi, functionName: "getLaunchedToken", args: [token] });
  if (!launch.exists || getAddress(launch.token) !== getAddress(token)) throw new Error("Pons v2 factory does not recognize the configured token");
  if (getAddress(launch.creatorFeeRecipient) !== getAddress(recipient)) throw new Error("Pons creator fees must point to the configured Pons fee wallet");
  if (getAddress(launch.pairToken) !== getAddress(feeAsset)) throw new Error("Configured Pons fee asset differs from the launch pair token");
  return launch;
}

export async function ponsClaimable({ publicClient, escrow, recipient, feeAsset }) {
  return publicClient.readContract({ address: escrow, abi: ponsV2EscrowAbi, functionName: "balanceOfToken", args: [recipient, feeAsset] });
}

export function ponsClaimRequest(escrow, feeAsset) {
  return { to: escrow, data: encodeFunctionData({ abi: ponsV2EscrowAbi, functionName: "claimToken", args: [feeAsset] }), value: 0n };
}

export function ponsSweepRequest(launch) {
  if (Number(launch.phase) !== 0) return null;
  return { to: getAddress(launch.curve), data: encodeFunctionData({ abi: ponsV2CurveAbi, functionName: "sweepFees", args: [0n] }), value: 0n };
}

export function ponsV2Adapter(config = null) {
  if (!config) return { enabled: false, status: "Awaiting Pons v2 launch configuration" };
  return {
    enabled: true,
    status: "Configured; activation still requires a verified dry run",
    validate: (publicClient, recipient) => validatePonsLaunch({ publicClient, recipient, ...config }),
    claimable: (publicClient, recipient) => ponsClaimable({ publicClient, recipient, ...config }),
    claimRequest: () => ponsClaimRequest(config.escrow, config.feeAsset),
    sweepRequest: (launch) => ponsSweepRequest(launch),
  };
}

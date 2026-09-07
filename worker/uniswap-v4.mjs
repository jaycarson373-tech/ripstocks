import { encodeFunctionData, getAddress, parseAbi } from "viem";

export const UNISWAP_V4_POOL_MANAGER = getAddress("0x8366a39cc670b4001a1121b8f6a443a643e40951");
export const UNISWAP_V4_QUOTER = getAddress("0x8dc178efb8111bb0973dd9d722ebeff267c98f94");
export const HOOD_V4_SWAP_ADAPTER = getAddress("0xbDAb8AF8467158fe3ec5595fd64A447Ec64ca29B");
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const FEE_TIERS = [[100, 1], [500, 10], [3000, 60], [10000, 200]];

const quoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256 amountOut,uint256 gasEstimate)",
]);
const adapterAbi = parseAbi([
  "function pm() view returns(address)",
  "function swapExactIn((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,bool zeroForOne,uint256 amountIn,uint256 minAmountOut,address recipient) returns(uint256 amountOut)",
]);

export function directPoolKey(tokenA, tokenB, fee, tickSpacing) {
  const addresses = [getAddress(tokenA), getAddress(tokenB)].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return { currency0: addresses[0], currency1: addresses[1], fee, tickSpacing, hooks: ZERO_ADDRESS };
}

export function minimumOutput(amountOut, slippageBps) {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 500) throw new Error("Swap slippage must be 0–500 bps");
  return BigInt(amountOut) * BigInt(10_000 - slippageBps) / 10_000n;
}

export async function quoteDirectV4({ publicClient, account, sellToken, buyToken, amount, slippageBps }) {
  const manager = await publicClient.readContract({ address: HOOD_V4_SWAP_ADAPTER, abi: adapterAbi, functionName: "pm" });
  if (getAddress(manager) !== UNISWAP_V4_POOL_MANAGER) throw new Error("Robinhood v4 adapter points to an unexpected PoolManager");
  let best = null;
  for (const [fee, tickSpacing] of FEE_TIERS) {
    const poolKey = directPoolKey(sellToken, buyToken, fee, tickSpacing);
    const zeroForOne = poolKey.currency0.toLowerCase() === sellToken.toLowerCase();
    try {
      const { result } = await publicClient.simulateContract({
        address: UNISWAP_V4_QUOTER,
        abi: quoterAbi,
        functionName: "quoteExactInputSingle",
        args: [{ poolKey, zeroForOne, exactAmount: amount, hookData: "0x" }],
      });
      if (result[0] > 0n && (!best || result[0] > best.amountOut)) best = { poolKey, zeroForOne, amountOut: result[0] };
    } catch { /* This fee tier has no executable direct pool. */ }
  }
  if (!best) throw new Error("No direct Uniswap v4 stock route");
  const minAmountOut = minimumOutput(best.amountOut, slippageBps);
  if (minAmountOut <= 0n) throw new Error("Direct stock quote output is too small");
  return {
    sellToken: getAddress(sellToken),
    buyToken: getAddress(buyToken),
    sellAmount: amount.toString(),
    buyAmount: best.amountOut.toString(),
    minBuyAmount: minAmountOut.toString(),
    spender: HOOD_V4_SWAP_ADAPTER,
    transaction: {
      to: HOOD_V4_SWAP_ADAPTER,
      data: encodeFunctionData({ abi: adapterAbi, functionName: "swapExactIn", args: [best.poolKey, best.zeroForOne, amount, minAmountOut, account] }),
      value: "0",
    },
  };
}

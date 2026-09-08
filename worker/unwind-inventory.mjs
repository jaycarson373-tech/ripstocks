import { encodeFunctionData, formatUnits, getAddress, parseAbi } from "viem";
import { CANONICAL_USDG } from "./pons-core.mjs";
import { chain, treasuryConfig, treasuryContext, validateTreasury } from "./treasury-runtime.mjs";

const packAbi = parseAbi([
  "function packsEnabled() view returns (bool)",
  "function activeRequestId() view returns (uint256)",
  "function inventoryCount() view returns (uint256)",
  "function prizeAt(uint256) view returns (address token,uint256 tokenAmount,uint256 declaredUsdMicros)",
  "function removePrize(uint256,address)",
]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

async function confirmed(ctx, hash, event, fields = {}) {
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`${event} reverted: ${hash}`);
  ctx.log(event, { ...fields, transactionHash: hash });
  return receipt;
}

async function stockBalance(ctx, token) {
  return ctx.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [ctx.account.address] });
}

function validateExitQuote(quote, token, amount) {
  if (!same(quote.sellToken, token) || !same(quote.buyToken, CANONICAL_USDG)
    || BigInt(quote.sellAmount || 0) !== amount || BigInt(quote.minBuyAmount || 0) <= 0n
    || BigInt(quote.transaction?.value || 0) !== 0n) throw new Error("Exit quote does not match the exact Stock Token balance and USDG destination");
}

export async function unwindInventory({ execute = false } = {}) {
  const cfg = treasuryConfig(process.env, "live");
  const ctx = treasuryContext(cfg);
  await ctx.lease();
  try {
    await validateTreasury(ctx);
    const [packsEnabled, activeRequestId, inventoryCount] = await Promise.all([
      ctx.publicClient.readContract({ address: cfg.packContract, abi: packAbi, functionName: "packsEnabled" }),
      ctx.publicClient.readContract({ address: cfg.packContract, abi: packAbi, functionName: "activeRequestId" }),
      ctx.publicClient.readContract({ address: cfg.packContract, abi: packAbi, functionName: "inventoryCount" }),
    ]);
    if (packsEnabled) throw new Error("Disable pack sales before unwinding inventory");
    if (activeRequestId !== 0n) throw new Error("An active buyer request must settle before inventory can be unwound");

    const grouped = new Map();
    for (let index = 0n; index < inventoryCount; index += 1n) {
      const prize = await ctx.publicClient.readContract({ address: cfg.packContract, abi: packAbi, functionName: "prizeAt", args: [index] });
      const token = getAddress(prize[0]);
      grouped.set(token, (grouped.get(token) || 0n) + prize[1]);
    }
    const rows = [];
    let minimumUsdg = 0n;
    for (const [token, amount] of grouped) {
      const stock = cfg.stocks.find((entry) => same(entry.address, token));
      if (!stock) throw new Error(`Inventory contains an unconfigured Stock Token: ${token}`);
      const quote = await ctx.quote(token, CANONICAL_USDG, amount);
      validateExitQuote(quote, token, amount);
      minimumUsdg += BigInt(quote.minBuyAmount);
      rows.push({ symbol: stock.symbol, token, amount, minimumUsdg: BigInt(quote.minBuyAmount) });
    }
    ctx.log("inventory_unwind_preview", {
      fundedSlots: inventoryCount.toString(),
      assets: rows.map((row) => ({ symbol: row.symbol, tokenAtoms: row.amount.toString(), minimumUsdg: formatUnits(row.minimumUsdg, 6) })),
      minimumTotalUsdg: formatUnits(minimumUsdg, 6),
      sent: false,
    });
    if (!execute) return;

    while (await ctx.publicClient.readContract({ address: cfg.packContract, abi: packAbi, functionName: "inventoryCount" }) > 0n) {
      const count = await ctx.publicClient.readContract({ address: cfg.packContract, abi: packAbi, functionName: "inventoryCount" });
      const index = count - 1n;
      const prize = await ctx.publicClient.readContract({ address: cfg.packContract, abi: packAbi, functionName: "prizeAt", args: [index] });
      const stock = cfg.stocks.find((entry) => same(entry.address, prize[0]));
      const { request } = await ctx.publicClient.simulateContract({ account: ctx.account, address: cfg.packContract, abi: packAbi, functionName: "removePrize", args: [index, ctx.account.address] });
      const hash = await ctx.walletClient.writeContract(request);
      await confirmed(ctx, hash, "inventory_prize_withdrawn", { index: index.toString(), symbol: stock?.symbol || getAddress(prize[0]), tokenAtoms: prize[1].toString() });
    }

    const usdgBefore = await stockBalance(ctx, CANONICAL_USDG);
    for (const stock of cfg.stocks) {
      const amount = await stockBalance(ctx, stock.address);
      if (amount === 0n) continue;
      const quote = await ctx.quote(stock.address, CANONICAL_USDG, amount);
      validateExitQuote(quote, stock.address, amount);
      const allowance = await ctx.publicClient.readContract({ address: stock.address, abi: erc20Abi, functionName: "allowance", args: [ctx.account.address, quote.spender] });
      if (allowance < amount) {
        const hash = await ctx.walletClient.writeContract({ account: ctx.account, chain, address: stock.address, abi: erc20Abi, functionName: "approve", args: [quote.spender, amount] });
        await confirmed(ctx, hash, "inventory_exit_approved", { symbol: stock.symbol, tokenAtoms: amount.toString() });
      }
      const before = await stockBalance(ctx, CANONICAL_USDG);
      const hash = await ctx.walletClient.sendTransaction({ account: ctx.account, chain, to: quote.transaction.to, data: quote.transaction.data, value: 0n });
      await confirmed(ctx, hash, "inventory_stock_sold", { symbol: stock.symbol, tokenAtoms: amount.toString() });
      const [remaining, after] = await Promise.all([stockBalance(ctx, stock.address), stockBalance(ctx, CANONICAL_USDG)]);
      if (remaining !== 0n || after <= before) throw new Error(`Confirmed ${stock.symbol} exit did not produce USDG or clear the sold balance`);
    }
    const usdgAfter = await stockBalance(ctx, CANONICAL_USDG);
    ctx.log("inventory_unwind_complete", { withdrawnSlots: inventoryCount.toString(), receivedUsdg: formatUnits(usdgAfter - usdgBefore, 6), finalUsdgBalance: formatUnits(usdgAfter, 6) });
  } finally {
    await ctx.audit.release(ctx.holder);
  }
}

if (process.argv[1]?.endsWith("unwind-inventory.mjs")) {
  const execute = process.env.UNWIND_CONFIRM === "SELL_ALL_TO_USDG";
  unwindInventory({ execute }).catch((error) => { console.error(error.shortMessage || error.message?.split("\n")[0]); process.exitCode = 1; });
}

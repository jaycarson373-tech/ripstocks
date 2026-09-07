import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parseAbi, parseUnits } from "viem";
import { CANONICAL_USDG } from "./pons-core.mjs";
import { validateSaleQuote } from "./pack-reinvestment.mjs";
import { treasuryConfig, treasuryContext, validateTreasury, recoverTreasuryTransaction, resumeTreasuryPurchase } from "./treasury-runtime.mjs";

export async function buyInventory({ id, symbol, usdg, execute = false }) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id || "")) throw new Error("Provide a stable --id; reuse it on every retry");
  if (!/^\d+(\.\d{1,6})?$/.test(usdg || "")) throw new Error("--usdg must be an exact positive USDG amount");
  const amount = parseUnits(usdg, 6);
  if (amount <= 0n || amount > 250_000_000n) throw new Error("One initial purchase must be greater than zero and at most 250 USDG");
  const cfg = treasuryConfig(process.env, execute ? "live" : "dry-run");
  const stock = cfg.stocks.find(stock => stock.symbol === symbol);
  if (!stock) throw new Error("--symbol must belong to the configured pack universe");
  const ctx = treasuryContext(cfg);
  await ctx.lease();
  try {
    await validateTreasury(ctx);
    const operationId = `${ctx.scope}:purchase:${id}`;
    let purchase = (await ctx.store.rows("treasury_purchases", `id=eq.${encodeURIComponent(operationId)}&limit=1`))?.[0];
    if (purchase && (purchase.usd_atoms !== amount.toString() || purchase.stock_address.toLowerCase() !== stock.address.toLowerCase())) throw new Error("This purchase ID already has different immutable inputs; refusing a second buy");
    if (purchase?.completed_at) { ctx.log("purchase_already_complete", { id, loadTransaction: purchase.load_transaction }); return; }
    // Initial deposits are distinct from sales. Once sales start, this CLI must
    // not consume proceeds which the hourly scanner has not reserved yet.
    if (!purchase && await ctx.publicClient.readContract({ address: cfg.packContract, abi: parseAbi(["function nextRequestId() view returns (uint256)"]), functionName: "nextRequestId" }) !== 1n) throw new Error("Initial funding is closed after the first pack request; use the receipt-restock worker, not a new seed purchase");
    const pendingPurchase = (await ctx.store.rows("treasury_purchases", `scope=eq.${encodeURIComponent(ctx.scope)}&completed_at=is.null&order=created_at.asc&limit=1`))?.[0];
    if (pendingPurchase && pendingPurchase.id !== operationId) throw new Error("Resume the existing unfinished purchase before starting another");
    if (await ctx.store.pending(ctx.scope)) throw new Error("Finish the reserved hourly restock before allocating new treasury funds");
    if (!execute) {
      const quote = await ctx.quote(CANONICAL_USDG, stock.address, amount);
      validateSaleQuote(quote, stock, amount);
      ctx.log("treasury_buy_dry_run", { id, symbol, budgetUsdg: usdg, executableQuote: true, sent: false });
      return;
    }
    await recoverTreasuryTransaction(ctx);
    if (!purchase) {
      purchase = { id: operationId, scope: ctx.scope, lot_index: 0, usd_atoms: amount.toString(), stock_address: stock.address, stock_symbol: stock.symbol };
      await ctx.audit.request("treasury_purchases", { method: "POST", body: JSON.stringify(purchase) });
    }
    await resumeTreasuryPurchase(ctx, purchase);
    const saved = (await ctx.store.rows("treasury_purchases", `id=eq.${encodeURIComponent(operationId)}&limit=1`))?.[0];
    if (!saved?.completed_at) throw new Error("Purchase remains pending; rerun the SAME id after the active pack settles");
    ctx.log("treasury_buy_loaded", { id, symbol, actualTokenAtoms: saved.token_amount_atoms, loadTransaction: saved.load_transaction });
  } finally { await ctx.audit.release(ctx.holder); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const value = flag => process.argv[process.argv.indexOf(flag) + 1];
  buyInventory({ id: value("--id"), symbol: value("--symbol"), usdg: value("--usdg"), execute: process.argv.includes("--execute") }).catch(error => { console.error(error.shortMessage || error.message?.split("\n")[0]); process.exitCode = 1; });
}

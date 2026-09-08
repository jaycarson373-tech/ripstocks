import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { treasuryConfig, treasuryContext, validateTreasury, recoverTreasuryTransaction, resumeTreasuryPurchase, settlePendingPack, indexSettlements } from "./treasury-runtime.mjs";
import { runPackReinvestment } from "./pack-reinvestment.mjs";
import { runPonsHourly } from "./pons-hourly.mjs";
import { runWorkerLoop } from "./worker-loop.mjs";

export async function treasuryTick(cfg, signal) {
  if (cfg.mode === "off") return;
  const ctx = treasuryContext(cfg);
  const acquire = ctx.lease;
  ctx.lease = async () => {
    if (signal?.aborted) throw new Error("Worker is draining; leave journaled work for the next worker");
    await acquire();
  };
  await ctx.lease();
  try {
    await validateTreasury(ctx);
    if (cfg.mode === "live") {
      await recoverTreasuryTransaction(ctx);
      // Pons uses the same signer. Resume its journaled nonce before pack
      // settlement or operator purchases are allowed to sign anything else.
      await runPonsHourly(ctx);
      await settlePendingPack(ctx);
      const purchase = (await ctx.store.rows("treasury_purchases", `scope=eq.${encodeURIComponent(ctx.scope)}&completed_at=is.null&order=created_at.asc&limit=1`))?.[0];
      if (purchase) {
        await resumeTreasuryPurchase(ctx, purchase);
        if (cfg.reinvestEnabled) await indexSettlements(ctx);
        return;
      }
    } else {
      await runPonsHourly(ctx);
    }
    if (cfg.reinvestEnabled) {
      await indexSettlements(ctx);
      await runPackReinvestment(ctx);
    }
  } finally { await ctx.audit.release(ctx.holder); }
}
export async function main() {
  const cfg = treasuryConfig();
  const shutdown = new AbortController();
  const stop = () => { shutdown.abort(); console.log(JSON.stringify({ event: "treasury_worker_draining" })); };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  console.log(JSON.stringify({ event: "treasury_worker_started", mode: cfg.mode, creatorClaims: cfg.ponsEnabled ? "configured" : "disabled", holderRewards: cfg.ponsEnabled ? "configured" : "disabled" }));
  try {
    await runWorkerLoop({
      tick: () => treasuryTick(cfg, shutdown.signal), signal: shutdown.signal,
      pollMs: cfg.pollSeconds * 1000, once: process.env.WORKER_ONCE === "true",
      onError: error => {
        console.error(JSON.stringify({ event: "treasury_tick_failed", error: error.name || "Error", message: error.shortMessage || error.message?.split("\n")[0] }));
        if (process.env.WORKER_ONCE === "true") process.exitCode = 1;
      },
    });
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error("Treasury configuration invalid; run launch:check. No transaction sent."); process.exitCode = 1; });

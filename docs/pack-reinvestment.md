# Hourly reinvestment of settled pack payments

This is separate from Pons creator fees. The creator-fee split remains 50% holder drops / 50% pack inventory. The new path reinvests **100% of each settled 20 USDG sale payment** into inventory purchase budgets. It does not silently withhold a house fee. Received stock value varies with prices, swap fees, and slippage; no fixed EV or return is promised.

## Activation

1. Keep Railway `AUTOMATION_MODE=off` while configuring the service.
2. Run `supabase/pons-automation.sql`, then the additive `supabase/pack-reinvestment.sql` in the same Supabase project used by Railway. Do not run any reset or delete existing audit rows.
3. Configure the existing automation wallet, deployed pack contract, Robinhood RPC, and 0x key. No new private key is required. The signer remains pack owner, treasury, and creator-fee recipient.
4. Set Railway `PACK_RECEIPT_REINVEST_ENABLED=true` and `AUTOMATION_MODE=dry-run`. The flag defaults false. Deploy and inspect `pack_sale_reinvestment_dry_run` against actual completed pack receipts; it neither reserves payments nor broadcasts.
5. After the complete setup is verified, explicitly set `AUTOMATION_MODE=live`. This also enables the existing creator-fee worker; it is not a receipt-only mode. No flags are enabled automatically by deploying code or applying SQL.

The existing `PACK_CONTRACT_START_BLOCK` can specify the pack's deployment block. Leave it empty to discover it. On first activation the worker scans the contract's eligible past settlements; confirm those proceeds have not already been spent manually. Never change the start block to bypass an unresolved budget or reconciliation error.

## Hourly funding rule

- A purchase request/approval is not a sale. Revenue is recognized only when `PrizeDelivered` appears in a successful transaction alongside the exact canonical USDG transfer from the configured pack contract to this treasury.
- The scan includes only settlements before the current UTC hour, with at least twelve subsequent chain blocks. A 12:34 payment is first eligible after 13:00; it is never spent immediately at checkout.
- Every eligible request ID is reserved once in `pack_sale_receipts`. Epoch and lot reservations are one atomic database transaction; a duplicate request rolls back the new reservation.
- Sizes are picked reproducibly from $5, $10, $15, $20, $25, $30, $35, $40, and $50, capped by remaining sale proceeds. The complete plan sums to the entire recorded budget, with no fractional USDG lost to rounding. A single sale is split into smaller lots, such as $5 + $15. These are swap purchase budgets, not guaranteed prize valuations.
- Each lot uses the existing ten-stock allowlist and 0x route. Illiquid candidates are tried before a route is persisted; after a transaction is signed, that lot cannot silently switch to another asset.
- Each exact received Stock Token amount is loaded into the existing pack contract. Purchase selection, buyer payment, token delivery, and the initial $250 seed loader are unchanged.
- One pending lot is serviced per worker tick; the same hourly plan resumes until complete. Slow swaps, buyer locks, outages, or a large backlog may delay completion past the hour. New receipts carry forward to the next plan; a failed batch is not counted as complete.

## Replay and accounting safety

Signed transaction bytes and their hashes are written to the private Supabase journal **before broadcast**. A crash or uncertain network response retries only those exact bytes; it does not create a fresh swap with another nonce. Pending signed transactions are reconciled before the worker claims fees or settles another buyer's pack.

Stock output is measured from the swap transaction's actual token transfers, not from an arbitrary change in the treasury's total balance. Atom values are stored as strings so JavaScript/JSON cannot round an 18-decimal stock quantity.

Confirmed failed swaps stop for operator review. A load transaction which is proven reverted can be retried up to five times: a buyer may have locked inventory between simulation and inclusion. Pending/successful load transactions are never retried under a new hash. No inventory is counted before a successful on-chain load.

The worker checks the scan checkpoint for reorgs, shares the existing automation lease, and refuses budgets not backed by a verified settlement. Wallet deposits, unsettled buyer escrow, seed funding, ETH gas, and the creator-fee allocation are not newly credited as sale revenue.

Keep one worker replica and do not run manual transactions from its signer concurrently. Manual withdrawals may make recorded sale proceeds unavailable; the worker then stops instead of inventing funding. If a transaction or budget needs investigation, set **AUTOMATION_MODE=off** first. Do not delete journal records, clear transaction hashes, or reuse a fresh database against already-reinvested proceeds. A migrated/cleared database needs explicit on-chain reconciliation before reactivation.

## Audit records

- `pack_reinvestment_epochs`: hourly cutoff block/hash, sale budget, completion.
- `pack_sale_receipts`: unique settled request IDs and payment transaction hashes.
- `pack_reinvestment_lots`: USDG allocation, actual stock atoms/value, load transaction.
- `pack_reinvestment_transactions`: private signed-byte journal, transaction hash and confirmation state. **Never expose this table through the browser or a public API.**

Logs use `pack_sale_reinvestment_dry_run`, `pack_sale_lot_loaded`, and `pack_sale_reinvestment_complete`. All live amounts and inventory still come from confirmed chain state; the frontend does not simulate funded packs.

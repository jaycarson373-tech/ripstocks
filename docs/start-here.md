# StonkRips: treasury first, Pons last

No Pons CA is required to deploy Pack #01, buy Stock Tokens, fund inventory, purchase, deliver, index receipts, or restock. **Mainnet readiness requires a verified real purchase lifecycle, not just passing tests.**

## Wallets

- Pons fee wallet: receives the eventual Pons creator-fee entitlement. Its key belongs **only in Railway**, as `PONS_PRIVATE_KEY`; the hourly worker forwards claimed USDG to the treasury.
- Treasury/operator wallet: owns the pack contract, holds USDG/ETH, buys Stock Tokens, loads inventory, receives settled payments. Its key belongs **only in Railway**, as `AUTOMATION_PRIVATE_KEY`.
- A test buyer uses their own connected wallet. Stock Tokens go to that buyer, not to the creator.

## Exact environment placement

| Variable | Vercel | Railway | Value |
| --- | --- | --- | --- |
| `ROBINHOOD_RPC_URL` | Server | Server | `https://rpc.mainnet.chain.robinhood.com` |
| `NEXT_PUBLIC_SITE_URL` | Public | No | Existing production domain |
| `NEXT_PUBLIC_STONKRIPS_CONTRACT` | Public | No | Deployed Pack #01 contract, **not** the Pons CA |
| `NEXT_PUBLIC_X_URL` | Public, optional | No | Your existing correct X URL |
| `NEXT_PUBLIC_PONS_TOKEN_URL` | Public, optional | No | Leave blank until launch |
| `PACKS_LIVE` | Server | No | `false` until controlled purchase verification |
| `PACK_ID` | No | Server | `PACK_01` |
| `STOCKRIPS_PACK_CONTRACT` | No | Server | Same pack address as Vercel |
| `PACK_CONTRACT_START_BLOCK` | No | Server | Deployment block; optional auto-discovery |
| `AUTOMATION_MODE` | No | Server | `off`, then `dry-run`, then reviewed `live` |
| `PACK_RECEIPT_REINVEST_ENABLED` | No | Server | `false` initially |
| `WORKER_POLL_SECONDS` | No | Server | `30` (restock allocation remains hourly) |
| `ZEROX_SLIPPAGE_BPS` | No | Server | `100` |
| `CREATOR_FEE_CLAIM_ENABLED` | No | Server | `false` |
| `HOLDER_REWARDS_ENABLED` | No | Server | `false` |
| `AUTOMATION_PRIVATE_KEY` | **Never** | **Secret** | Treasury EVM private key |
| `PONS_PRIVATE_KEY` | **Never** | **Secret** | Separate Pons creator-fee recipient/claimer key |
| `SWAP_PROVIDER=uniswap-v4` | **Never** | Server | Direct Robinhood Chain pools; no API account required |
| `SWAP_SLIPPAGE_BPS=100` | **Never** | Server | Maximum 1% route slippage |
| `ZEROX_API_KEY` | **Never** | **Secret** | Only required if `SWAP_PROVIDER=0x` |
| `SUPABASE_URL` | Not needed | Server | New project's HTTPS URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **Not needed** | **Secret** | New project's `sb_secret_...` key, or legacy `service_role` key |

No Supabase browser/anon key is needed: website inventory and activity are read from the chain. Never use `NEXT_PUBLIC_` for a private key, service-role key or swap API key. No worker secret goes in a local committed `.env` file. Do not copy old Supabase values into the new project.

Supabase Settings → API Keys provides the current Secret key (`sb_secret_...`). Put it in the existing Railway variable `SUPABASE_SERVICE_ROLE_KEY`; the worker supports both key formats. The legacy `service_role` key under Legacy API Keys also works. Do not use `anon`, a publishable key, or the database password. See [Supabase's key documentation](https://supabase.com/docs/guides/getting-started/api-keys).

Remove obsolete `PONS_FEE_LOCKER`, `PONS_QUOTE_TOKEN`, `INITIAL_SEED_ASSET`, `ALLOW_NONEMPTY_SEED`, and any v1 factory address from the active service. The verified v2 factory, escrow, token start block, and snapshot settings are added only after the real launch exists. `AUTOMATION_PUBLIC_LIVE` is no longer used.

## Your immediate actions

1. Create your new Supabase project yourself. Paste **all of [launch-setup.sql](../supabase/launch-setup.sql)** into its SQL Editor. It creates empty private treasury tables, not old Pons data. Add its URL and service-role key in Railway only.
2. Create/fund the treasury wallet on **Robinhood Chain 4663** with canonical USDG for inventory and ETH for gas. A small test does not require $250. Gas must be estimated; 0.01 ETH is not a guaranteed deployment budget. Add its private key directly to Railway. The default Uniswap v4 route requires no third-party API key.
3. Then run the controlled deployment/smoke-buy procedure below. Only after it passes, load the larger inventory and enable reviewed pack sales/restocking. The CA comes afterward, separately.

## Operator procedure (Railway execution; no key exported to the website)

Keep the worker off while deploying or activating. Use a Railway shell in the running service for commands requiring its secrets. The image contains the compiled pack artifact, so it does not need Foundry installed at runtime.

```sh
npm run launch:check
DEPLOY_PACK_CONFIRM=DEPLOY_NEW_PACK npm run launch:bootstrap
```

Save the deployment transaction immediately. If interrupted, inspect that hash and recover its contract address; **do not blindly deploy again**. Set the returned pack address in Railway `STOCKRIPS_PACK_CONTRACT` and Vercel `NEXT_PUBLIC_STONKRIPS_CONTRACT`; add its deployment block in Railway. Neither is the Pons CA. Redeploy after changing public Vercel values.

```sh
npm run inventory:buy -- --id smoke-01 --symbol SPY --usdg 2
npm run inventory:buy -- --id smoke-01 --symbol SPY --usdg 2 --execute
```

First command quotes without a transaction. The second authorizes exactly 2 USDG of stock purchase, checks the confirmed USDG debit and exact stock transfer, journals the result and loads those tokens into the contract. Reuse **the same ID** after timeout; changing the ID authorizes a new purchase. A missing route stops without substituting an unrelated asset.

The tiny smoke lot is for operator verification; do not open public sales on a lone $2 prize advertised as a $20 pack. Load/review the actual intended pool first. Optional $250 batch:

```sh
SEED_BATCH_ID=initial-01 SEED_INVENTORY_CONFIRM=I_UNDERSTAND npm run inventory:seed
```

Default budgets: 5,10,15,20,20,25,30,35,40,50 USDG. Keep the same batch ID and inputs on retries. No claimed values/probabilities are fabricated. Exact output depends on each real swap.

Finish initial funding **before the first pack request**. The initial-buy CLI refuses new seed IDs once sales begin, so it cannot accidentally spend settlement receipts awaiting hourly reservation. A smoke buy plus this default batch totals 252 USDG, not 250; reduce the batch if 250 is your total funding cap.

With funded inventory verified, while the worker is still off:

```sh
ENABLE_PACKS_CONFIRM=I_UNDERSTAND npm run packs:activate
```

Use a controlled Vercel preview (`PACKS_LIVE=true` only for that preview) and a test buyer with Pack #01's 20 USDG plus ETH. Connect, approve, request, settle, and verify the exact stock transfer, treasury USDG payment, and one fewer inventory slot. Then run:

```sh
AUTOMATION_MODE=dry-run PACK_RECEIPT_REINVEST_ENABLED=true WORKER_ONCE=true npm run treasury-worker
```

After reviewing the preview, explicitly enable Railway live mode/reinvestment to reconcile receipts and execute a closed-hour restock. Confirm its buy/load receipts and that retries do not duplicate them. Only then publish Pack #01 sales. Creator-fee claims and holder rewards stay disabled throughout.

## What the pre-CA loop does

Treasury USDG → journaled stock swap → exact token amount loaded → buyer pays the configured price → contract sends one funded prize and forwards USDG at settlement → confirmed delivery/payment indexed in `pack_settlements` → previous-hour payments reserved exactly once → fully budgeted restocking.

Pending/opened packs are **not revenue**. Initial deposits are **not sales**. A database outage before signed-transaction persistence stops broadcasting. An uncertain send reuses its saved signed bytes/hash. One database lease coordinates the worker and manual buys. Do not run another application or manually spend from this operator wallet while automation owns reserved funds/nonces.

Pack selection remains the existing future-block selection with its existing delayed fallback; this work does not make it VRF or upgrade its randomness guarantees. A security review remains advisable before real public funds.

## Pack configuration and Pons later

`config/packs.json` defines price, supported symbols and restock budgets. Each pack has its own immutable-price contract and inventory. Add a catalog entry and deploy its contract for a future pack; a multi-pack selector is deliberately not built yet. Pack #01 alone costs $20.

The actual Pons v2 escrow ABI lives in `worker/pons-v2-adapter.mjs`, with claim/reward methods disabled. Once a launch exists, verify the real escrow, fee asset and recipient, then integrate and test claiming separately. The creator signs any recipient configuration in their own wallet. Its key is never needed here. The planned fee split is not running now.

# StonkRips: your remaining setup

The website and Railway worker are deployed, but paid packs and spending stay disabled until the real wallet, database and pack contract pass verification.

## 1. Enter credentials and fund your wallet

In Railway → `pacific-acceptance` → `production` → `ripstocks` → Variables, enter:

| Variable | What to enter |
| --- | --- |
| `AUTOMATION_PRIVATE_KEY` | The dedicated EVM treasury wallet's private key. That wallet must also receive your Pons v2 creator fees. |
| `PONS_TOKEN_ADDRESS` | Your Pons v2 token's `0x` contract address, **not** the pack contract. |
| `ZEROX_API_KEY` | Your 0x API key with Robinhood Stock Token route access. |
| `SUPABASE_URL` | The new project's HTTPS URL from Supabase Connect. |
| `SUPABASE_SERVICE_ROLE_KEY` | That same project's server-only legacy `service_role` key. |

Fund that wallet with **250 canonical USDG plus ETH for gas on Robinhood Chain (4663)**. Do not send the seed funding to a pack contract. Do not paste the private key in chat or Vercel. Keep `AUTOMATION_MODE=off` and `PACK_RECEIPT_REINVEST_ENABLED=false` for setup.

If Codex cannot access Vercel, sign in once using `npx vercel login` on this machine. No private-key access is needed on Vercel.

## 2. Run one Supabase file

Open the intended Supabase project's SQL Editor and paste **all of [launch-setup.sql](../supabase/launch-setup.sql)**, then Run. This includes both automation and settled-payment reinvestment. It preserves existing data, does not add fake inventory, and does not activate spending.

Tell Codex **“credentials saved and wallet funded.”** The remaining operator work is below; you do not need to copy ten separate commands.

## Operator checklist — handled after those two steps

- Run `npx --yes @railway/cli run --service ripstocks --environment production --no-local -- npm run launch:check`. This is read-only and reports missing setup without printing secrets. Passing these checks does **not** certify launch readiness.
- Run the existing guarded contract bootstrap; verify the creator-fee recipient, chain and ten-stock allowlist. Save the returned pack address/start block in Railway, and the public pack address in Vercel. Never substitute the Pons token CA for the pack contract.
- Sync the intended Supabase server credentials to the web deployment, preserving all unrelated variables. Vercel must never receive the treasury private key or 0x key.
- Verify current routes, then run the guarded 250 USDG inventory loader **once**, reconciling each transaction before any retry. No fresh retry after an uncertain transaction.
- Verify inventory and pack settlement, enable the funded contract, set `PACKS_LIVE=true`, and redeploy the website. Approval/open/settle is the real payment flow; animation is not evidence of delivery.
- Review the worker in dry-run, including hourly recycling of the complete settled 20 USDG receipts. Only then enable live automation/reinvestment. Creator fees retain the separate 50/50 split. Publish automation as live only after a confirmed completed epoch.

The contract, treasury funding, route permissions, real transaction test and automation verification remain mandatory even though the user-facing setup is shorter. See [operator commands](./deploy-contract.md) for recovery details.

Maintainers: regenerate the one-paste file with `npm run launch:sql` whenever either source SQL file changes.

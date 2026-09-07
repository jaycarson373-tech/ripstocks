# Deploy StonkRips and open the first funded pack

The Pons token CA and the pack contract address are different contracts. `PONS_TOKEN_ADDRESS` is your existing Pons v2 token. The steps below deploy the separate contract that accepts 20 USDG and delivers a funded Stock Token.

Run these commands from this repository on a computer with Node.js 22+, Git, and Foundry (`forge`) installed. `railway run` runs the command **locally**, with Railway's environment injected into that process. The Railway worker container does not contain Foundry or the Solidity sources, so do not run the bootstrap from a container shell.

## 1. Configure the Railway service

Project: `pacific-acceptance`. Environment: `production`. Service: `ripstocks` (the existing service name is intentional).

Enter these directly in Railway Variables:

```dotenv
AUTOMATION_PRIVATE_KEY=<32-byte EVM private key>
PONS_TOKEN_ADDRESS=<your Pons v2 token's 0x address>
ZEROX_API_KEY=<0x key with Robinhood RWA access>
AUTOMATION_MODE=off
```

Keep `STOCKRIPS_PACK_CONTRACT` unset for the first deployment. Never put the private key in this file, chat, a shell command, or a `NEXT_PUBLIC_` variable. The signer must be the Pons creator-fee recipient; the bootstrap sets that same wallet as pack-contract owner and treasury.

Ensure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` point to the intended database, and run [pons-automation.sql](../supabase/pons-automation.sql) there if its tables have not been created. Database setup is required for the fee worker, not for contract deployment itself.

Fund the signer wallet on Robinhood Chain mainnet (chain ID `4663`) with ETH for gas. The initial stock purchases additionally require **250 canonical USDG in that wallet**. Do not send the USDG directly to the new pack contract.

## 2. Compile, test, and deploy the disabled pack contract

```bash
npm ci
forge test -vv
npx --yes @railway/cli login
npx --yes @railway/cli link --project 19a7cb80-8107-42b2-ac4b-21adfc729869 --environment production --service ripstocks
npx --yes @railway/cli run --service ripstocks --environment production -- npm run launch:bootstrap
```

Stop if a command fails. The bootstrap checks the network, Pons v2 registration, SPY pair, and creator-fee recipient before deploying. Its `launch_bootstrap_complete` output includes `packContract`, `deploymentTransaction`, `automationWallet`, and `ponsTokenStartBlock`. Save these public values.

Set `STOCKRIPS_PACK_CONTRACT` in Railway to the returned `packContract`, and `PONS_TOKEN_START_BLOCK` to the returned `ponsTokenStartBlock`. Once saved, repeating bootstrap verifies that configured deployment instead of creating another one. If a deployment command times out after broadcasting, inspect the signer transaction history before retrying so a second contract is not created accidentally.

## 3. Buy stocks and load the first ten funded lots

The initial schedule spends 250 USDG across ten lots: `5,10,15,20,20,25,30,35,40,50`. These are purchase budgets; actual received amounts and market values depend on each confirmed swap. Each funded lot becomes one pack result.

```bash
npx --yes @railway/cli run --service ripstocks --environment production -- env SEED_INVENTORY_CONFIRM=I_UNDERSTAND npm run inventory:seed
```

The loader checks the routes, buys the configured Stock Tokens, and transfers each exact received amount into the pack contract. It prints each swap and load transaction. Confirm all ten loads succeeded before proceeding. If any step fails, reconcile its transaction hashes and remaining balances before retrying; do not bypass the non-empty inventory guard as a retry shortcut.

## 4. Enable the funded pack contract and connect the website

```bash
npx --yes @railway/cli run --service ripstocks --environment production -- env ENABLE_PACKS_CONFIRM=I_UNDERSTAND npm run packs:activate
```

In the website's Vercel production environment (and Sites if that hosted copy is also used), set:

```dotenv
NEXT_PUBLIC_STONKRIPS_CONTRACT=<returned packContract>
ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
PACKS_LIVE=true
AUTOMATION_PUBLIC_LIVE=false
```

Redeploy the website after setting the public contract address. Check `/api/robinhood/status`: `configured`, `operatorEnabled`, and `packsLive` must be `true`, and `inventoryCount` must be positive. If any check fails, checkout must stay disabled.

The test buyer needs 20 USDG plus ETH gas in their own wallet. Connect, approve exactly 20 USDG, request the pack, and settle after the future block. Confirm the Stock Token receipt, the 20 USDG treasury payment, and inventory decreasing by exactly one.

## 5. Activate hourly Pons fee automation separately

Set Railway `AUTOMATION_MODE=dry-run`, redeploy, and verify the database and on-chain checks. After the complete flow is verified, set `AUTOMATION_MODE=live`. Keep `DROP_INTERVAL_MINUTES=60`, `FEE_SPLIT_BPS=5000`, and `TOKENS_PER_TICKET=250`.

The existing worker claims creator fees, normalizes them into SPY, uses half for a holder Stock Token drop, and loads the other half as a new funded inventory lot. It does not currently recycle the separate 20 USDG pack-sale receipts automatically; those accumulate in the treasury. Do not advertise sale-receipt recycling until that separate path is implemented and verified.

Set the website's `AUTOMATION_PUBLIC_LIVE=true` only after a completed, transaction-backed worker epoch exists.

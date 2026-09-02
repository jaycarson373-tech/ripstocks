# Pons v2 hourly automation setup

The Railway worker follows one fixed rule per UTC hour:

1. Verify the configured token is a Pons v2 launch paired with canonical SPY.
2. Claim SPY creator fees credited to the official Pons v2 fee escrow.
3. Commit a holder snapshot block and a future seed block to Supabase.
4. Allocate exactly 50% of the claimed SPY to a direct holder Stock Token drop.
5. Allocate the remaining 50% to one funded StonkRips pack-contract inventory lot.
6. Settle any ready pack request so an abandoned browser cannot hold the single-request queue open.
7. Record every state transition and transaction hash before the epoch is complete.

Pons fees must first be swept from the curve or graduated pool into the fee escrow. Before graduation, the worker can sweep only when the automation wallet is the deployer and the launch has no internal buyback. After graduation, Pons' trusted sweep operator handles conversions; this worker claims only balances already credited to the official escrow.

## 1. Supabase

Create a new Supabase project, open **SQL Editor**, paste all of `supabase/pons-automation.sql`, and run it once. Do not expose the service-role key in the browser.

## 2. 0x access

Create a 0x API key and complete 0x's explicit Robinhood RWA opt-in. A normal key without that approval cannot quote Robinhood Stock Tokens.

## 3. Railway variables

Paste this block into the Railway worker service, then replace every `CHANGE_ME` value:

```bash
AUTOMATION_MODE=off
AUTOMATION_PRIVATE_KEY=CHANGE_ME
ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com

PONS_TOKEN_ADDRESS=CHANGE_ME
PONS_TOKEN_START_BLOCK=CHANGE_ME
PONS_V2_FACTORY=0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e
PONS_FEE_ESCROW=0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e
PONS_QUOTE_TOKEN=0x117cc2133c37B721F49dE2A7a74833232B3B4C0C

STOCKRIPS_PACK_CONTRACT=CHANGE_ME
ZEROX_API_KEY=CHANGE_ME
ZEROX_SLIPPAGE_BPS=100

SUPABASE_URL=CHANGE_ME
SUPABASE_SERVICE_ROLE_KEY=CHANGE_ME

DROP_INTERVAL_MINUTES=60
FEE_SPLIT_BPS=5000
TOKENS_PER_TICKET=250000
WORKER_POLL_SECONDS=60
HOLDER_LOG_CHUNK_SIZE=2000
HOLDER_EXCLUDE_ADDRESSES=
```

The same wallet must currently be all four of these:

- Pons token deployer
- Pons creator-fee recipient
- StonkRips pack-contract owner
- StonkRips pack treasury

It needs enough ETH for claims, approvals, swaps, transfers, and inventory loads. `HOLDER_EXCLUDE_ADDRESSES` is a comma-separated list for known pools, lockers, team allocations, and other addresses that must not participate.

## 4. Safe activation

1. Keep `AUTOMATION_MODE=off` while values are entered.
2. Set `AUTOMATION_MODE=dry-run` and redeploy Railway.
3. Confirm the worker reports `dry_run`, the Pons launch resolves, its pair is SPY, the signer owns the pack contract, and an epoch appears in Supabase without any transaction hashes.
4. Test the complete cycle on a fork or test deployment.
5. Fund the signer with ETH and confirm the 0x key has Robinhood RWA access.
6. Set `AUTOMATION_MODE=live` only after review.

Never place `AUTOMATION_PRIVATE_KEY`, `ZEROX_API_KEY`, or `SUPABASE_SERVICE_ROLE_KEY` in Vercel/Sites public variables or in any `NEXT_PUBLIC_` variable.

## 5. Web variables

```bash
NEXT_PUBLIC_SITE_URL=https://YOUR-DOMAIN
NEXT_PUBLIC_STONKRIPS_CONTRACT=0xYOUR_PACK_CONTRACT
NEXT_PUBLIC_PONS_TOKEN_URL=https://YOUR_OFFICIAL_PONS_TOKEN_PAGE
NEXT_PUBLIC_X_URL=https://x.com/YOUR_HANDLE
PACKS_LIVE=false
AUTOMATION_PUBLIC_LIVE=false
ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
SUPABASE_URL=YOUR_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
```

Turn `PACKS_LIVE=true` only after the pack contract is enabled on-chain and reports real funded inventory. The private key and 0x key belong only on Railway.
Turn `AUTOMATION_PUBLIC_LIVE=true` only after Railway is in live mode and Supabase contains at least one successfully completed epoch.

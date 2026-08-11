# Stonk Drops launch environment checklist

Use these blocks for the production Vercel and Railway dashboards.

Keep `DRAWS_LIVE=false` until the draw worker is deployed separately, dry-run verified, and intentionally enabled.

## Vercel production env

Add these to Vercel for Production and Preview unless you intentionally want Preview separated.

```bash
NEXT_PUBLIC_RAILWAY_API_URL=https://YOUR-RAILWAY-SERVICE.up.railway.app
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-SUPABASE-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
NEXT_PUBLIC_HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY
NEXT_PUBLIC_SOLANA_NETWORK=mainnet-beta
NEXT_PUBLIC_USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
NEXT_PUBLIC_MAIN_TREASURY_WALLET=YOUR_MAIN_TREASURY_PUBLIC_KEY
NEXT_PUBLIC_HOLDER_AIRDROP_WALLET=YOUR_HOLDER_AIRDROP_PUBLIC_KEY
NEXT_PUBLIC_STOCKDROPS_MINT=
NEXT_PUBLIC_X_URL=
DRAWS_LIVE=false
```

Do not add private keys or `SUPABASE_SERVICE_ROLE_KEY` to Vercel.

## Railway production env

Paste this into Railway Raw Editor, then fill the blank values.

```bash
NODE_ENV=production
SUPABASE_URL=https://YOUR-SUPABASE-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY
SOLANA_NETWORK=mainnet-beta
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
MAIN_TREASURY_WALLET=YOUR_MAIN_TREASURY_PUBLIC_KEY
HOLDER_AIRDROP_WALLET=YOUR_HOLDER_AIRDROP_PUBLIC_KEY
HOLDER_TOKEN_MINT=
HOLDER_TICKET_TOKENS=250000
STOCKDROPS_TOKEN_DECIMALS=6
DRAWS_LIVE=false
MAIN_TREASURY_SIGNER_SECRET=
HOLDER_AIRDROP_SIGNER_SECRET=
JUPITER_API_KEY=
JUPITER_SLIPPAGE_BPS=100
XSTOCK_TARGETS_JSON=[{"symbol":"CRCLx","mint":"XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1","enabled":true,"weight":1},{"symbol":"SPYx","mint":"XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W","enabled":true,"weight":1},{"symbol":"QQQx","mint":"Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ","enabled":true,"weight":1},{"symbol":"TSLAx","mint":"XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB","enabled":true,"weight":1},{"symbol":"MSTRx","mint":"XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ","enabled":true,"weight":1},{"symbol":"NVDAx","mint":"Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh","enabled":true,"weight":1},{"symbol":"COINx","mint":"Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu","enabled":true,"weight":1},{"symbol":"GOOGLx","mint":"XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN","enabled":true,"weight":1},{"symbol":"HOODx","mint":"XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg","enabled":true,"weight":1},{"symbol":"AMZNx","mint":"Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg","enabled":true,"weight":1}]
AUTOMATION_SECRET=YOUR_LONG_RANDOM_AUTOMATION_SECRET
RAILWAY_API_URL=https://YOUR-RAILWAY-SERVICE.up.railway.app
SOL_GAS_BUFFER=0.111
MAIN_INVENTORY_BUDGET_USD=50
HOLDER_INVENTORY_BUDGET_USD=50
```

## Supabase

For a fresh Supabase project, run:

1. `supabase/protocol.sql`
2. Only if you need to wipe old launch/test data later: `supabase/clear-stockdrops-state.sql`

Then set the new `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the dashboards above.

## Before launch

- Confirm Vercel has the public CA and X handle. Until then, the UI shows `CA SOON` and `X SOON`.
- Confirm Railway has the new Supabase service-role key.
- Confirm Railway has the treasury public keys.
- Confirm Railway has signer private keys only after you are ready for signed automation.
- Keep `DRAWS_LIVE=false` until the draw worker ships and passes a dry run.

## Final values you said you will add

- `NEXT_PUBLIC_STOCKDROPS_MINT` on Vercel
- `NEXT_PUBLIC_X_URL` on Vercel
- `SUPABASE_URL` on Vercel/Railway
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` on Vercel
- `SUPABASE_SERVICE_ROLE_KEY` on Railway
- `HOLDER_TOKEN_MINT` on Railway
- `MAIN_TREASURY_SIGNER_SECRET` on Railway
- `HOLDER_AIRDROP_SIGNER_SECRET` on Railway
- `JUPITER_API_KEY` on Railway

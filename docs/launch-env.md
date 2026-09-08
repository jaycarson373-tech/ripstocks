# StonkRips launch configuration

StonkRips is Robinhood Chain-only. The existing contract and environment identifiers retain their legacy names for deployment compatibility.

For exact deployment, funding, and activation commands, follow [Deploy StonkRips and open the first funded pack](./deploy-contract.md).

## User payment flow

1. The user connects an injected EVM wallet and switches to Robinhood Chain mainnet (`4663`).
2. The site verifies that the pack contract is enabled, no other request blocks the queue, and at least one funded prize exists.
3. The wallet approves exactly `20_000_000` atoms of canonical USDG (20 USDG). Approval does not itself transfer funds.
4. `openPack` transfers 20 USDG into the pack contract and locks the funded inventory state.
5. After the future entropy block exists, `settlePack` forwards the 20 USDG to the configured treasury and transfers the selected Stock Token directly to the buyer.

ETH is required only for transaction gas. The contract does not accept ETH or USDC as the pack payment asset. The header disconnect action requests account-permission revocation where the wallet supports it and otherwise clears the page session locally; disconnecting never broadcasts a transaction.

## Hourly inventory lifecycle

The automated hourly refill does not create unbacked prizes and does not silently spend arbitrary wallet balances. It uses only the creator-fee budget measured and recorded for the current Pons v2 epoch. After normalizing claimed fees into canonical SPY, 50% buys one approved Stock Token lot and loads that exact amount into the pack contract; the other 50% buys the hourly holder-drop asset. When no fees are claimable, the cycle records `no_fees` and performs neither action.

The separate, opt-in [pack-sale reinvestment path](./pack-reinvestment.md) reserves confirmed 20 USDG settlement receipts and uses their full payment budget for varied Stock Token lots at the next UTC hour. It can refill independently of `no_fees`; it does not change the 50/50 creator-fee split. Apply `supabase/pack-reinvestment.sql` and review in dry-run before enabling `PACK_RECEIPT_REINVEST_ENABLED` with live automation.

## Vercel or Sites

```bash
NEXT_PUBLIC_SITE_URL=https://YOUR-DOMAIN
NEXT_PUBLIC_STONKRIPS_CONTRACT=0xYOUR_DEPLOYED_PACK_CONTRACT
NEXT_PUBLIC_PONS_TOKEN_URL=https://YOUR_OFFICIAL_PONS_TOKEN_PAGE
NEXT_PUBLIC_X_URL=https://x.com/stonkrips_
PACKS_LIVE=false
ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
```

## Railway

The browser talks directly to the pack contract. Railway runs the separate treasury and Pons worker described in `docs/pons-automation-setup.md`. Do not add the automation private key, Supabase backend key, or Pons server settings to Vercel, Sites, or a public web service.

The pack contract and treasury work before Pons exists. After the Pons launch, add the verified v2 token, deployment block, factory, escrow, and USDG pair settings listed in `docs/pons-automation-setup.md`. `PONS_PRIVATE_KEY` is the separate creator-fee recipient/claimer signer and `AUTOMATION_PRIVATE_KEY` remains the pack treasury signer; both belong only in Railway.

## Safe activation order

1. Deploy and verify `StonkRips.sol` on Robinhood Chain.
2. Verify the treasury and the ten approved Stock Token contracts.
3. Approve and load discrete prizes using current prices from Robinhood's API.
4. Execute a testnet or fork test of approve → open → settle → receive.
5. Enable packs in the contract.
6. Set `NEXT_PUBLIC_STONKRIPS_CONTRACT`.
7. Set `PACKS_LIVE=true` last.

`PACKS_LIVE` is deliberately server-side. The status endpoint also verifies the on-chain inventory count before enabling checkout.
`AUTOMATION_PUBLIC_LIVE` controls only the public status label; set it to `true` only after Railway is live and a complete audited epoch exists.

The repository includes `npm run inventory:seed` for the initial ten-lot prize pool. It defaults to the requested 250 canonical USDG seed schedule and also requires ETH gas in the automation wallet plus an explicit `SEED_INVENTORY_CONFIRM=I_UNDERSTAND` confirmation. It never enables pack sales. After verifying the loaded lots, `ENABLE_PACKS_CONFIRM=I_UNDERSTAND npm run packs:activate` performs the separate guarded on-chain activation.

## Canonical chain values

- Robinhood Chain mainnet chain ID: `4663`
- Public RPC: `https://rpc.mainnet.chain.robinhood.com`
- Explorer: `https://robinhoodchain.blockscout.com`
- USDG: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (6 decimals)
- WETH: `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`

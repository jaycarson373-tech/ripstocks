# StonkRips launch configuration

StonkRips is Robinhood Chain-only.

## Vercel or Sites

```bash
NEXT_PUBLIC_SITE_URL=https://YOUR-DOMAIN
NEXT_PUBLIC_STONKRIPS_CONTRACT=0xYOUR_DEPLOYED_PACK_CONTRACT
NEXT_PUBLIC_PONS_TOKEN_URL=https://YOUR_OFFICIAL_PONS_TOKEN_PAGE
NEXT_PUBLIC_X_URL=https://x.com/YOUR_HANDLE
PACKS_LIVE=false
AUTOMATION_PUBLIC_LIVE=false
ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
```

## Railway

The browser talks directly to the pack contract. Railway runs the separate Pons fee worker described in `docs/pons-automation-setup.md`. Do not add the automation private key to Vercel, Sites, or a public web service.

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

## Canonical chain values

- Robinhood Chain mainnet chain ID: `4663`
- Public RPC: `https://rpc.mainnet.chain.robinhood.com`
- Explorer: `https://robinhoodchain.blockscout.com`
- USDG: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (6 decimals)
- WETH: `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`

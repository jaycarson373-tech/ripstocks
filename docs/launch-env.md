# StonkRips launch configuration

StonkRips is Robinhood Chain-only.

## Vercel or Sites

```bash
NEXT_PUBLIC_SITE_URL=https://YOUR-DOMAIN
NEXT_PUBLIC_STONKRIPS_CONTRACT=0xYOUR_DEPLOYED_PACK_CONTRACT
NEXT_PUBLIC_LONG_TOKEN_URL=https://app.long.xyz/tokens/0xYOUR_STONKRIPS_TOKEN
NEXT_PUBLIC_X_URL=https://x.com/YOUR_HANDLE
PACKS_LIVE=false
ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
```

## Railway

The app does not require Railway for purchase settlement because the wallet talks directly to the pack contract. If Railway remains the chosen web host, use the same six values above. Do not add a private key to Vercel, Sites, or the web service.

## Safe activation order

1. Deploy and verify `StonkRips.sol` on Robinhood Chain.
2. Verify the treasury and the ten approved Stock Token contracts.
3. Approve and load discrete prizes using current prices from Robinhood's API.
4. Execute a testnet or fork test of approve → open → settle → receive.
5. Enable packs in the contract.
6. Set `NEXT_PUBLIC_STONKRIPS_CONTRACT`.
7. Set `PACKS_LIVE=true` last.

`PACKS_LIVE` is deliberately server-side. The status endpoint also verifies the on-chain inventory count before enabling checkout.

## Canonical chain values

- Robinhood Chain mainnet chain ID: `4663`
- Public RPC: `https://rpc.mainnet.chain.robinhood.com`
- Explorer: `https://robinhoodchain.blockscout.com`
- USDG: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (6 decimals)
- WETH: `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`

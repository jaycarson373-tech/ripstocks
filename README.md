# StonkRips

StonkRips is an inventory-backed $20 USDG Stock Token pack interface for Robinhood Chain.

It also includes a launch-gated Railway worker for Pons v2 creator fees. Once reviewed and enabled, each hourly cycle normalizes claimed fees into canonical SPY, directs 50% to one weighted holder Stock Token drop, and directs 50% to a new funded pack inventory lot.

## Product flow

1. The operator deploys the existing `contracts/StonkRips.sol` artifact with the official Robinhood Chain Stock Token allowlist. The Solidity name is retained for deployment compatibility; the public product brand is StonkRips.
2. The operator approves and loads discrete Stock Token prize lots into the contract.
3. A user connects an EVM wallet, approves exactly 20 canonical USDG, and opens a pack. ETH is used only for Robinhood Chain gas; the pack never charges ETH or USDC.
4. A future Robinhood Chain blockhash selects one of the funded lots.
5. A second transaction settles the pack, forwards the 20 USDG held by the contract to the treasury, and sends the selected Stock Token to the buyer.

Wallet connection is client-side and can be disconnected from the header. Pack checkout remains disabled until the configured contract reports that packs are enabled and at least one real funded inventory slot exists.

The hourly restock is separate from checkout revenue: the Railway worker claims the configured Pons v2 creator-fee stream, normalizes it into canonical SPY, routes 50% into one holder Stock Token drop, and routes 50% into one new funded pack lot. A cycle with no claimable fees creates no inventory or holder reward.

The UI remains disabled unless all three conditions are true: a contract address is configured, `PACKS_LIVE=true`, and the contract reports funded inventory.

## Commands

```bash
npm run dev
npm run vercel-build
forge test
```

See `docs/launch-env.md` and `contracts/README.md` before any production launch.
For the worker and one-paste Supabase setup, see `docs/pons-automation-setup.md` and `supabase/pons-automation.sql`.

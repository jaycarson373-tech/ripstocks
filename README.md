# StonkRips

StonkRips is an inventory-backed $20 USDG Stock Token pack interface for Robinhood Chain.

## Product flow

1. The operator deploys `contracts/StonkRips.sol` with the official Robinhood Chain Stock Token allowlist.
2. The operator approves and loads discrete Stock Token prize lots into the contract.
3. A user approves exactly 20 USDG and opens a pack.
4. A future Robinhood Chain blockhash selects one of the funded lots.
5. A second transaction settles the pack, transfers 20 USDG to the treasury, and sends the selected Stock Token to the buyer.

The UI remains disabled unless all three conditions are true: a contract address is configured, `PACKS_LIVE=true`, and the contract reports funded inventory.

## Commands

```bash
npm run dev
npm run vercel-build
forge test
```

See `docs/launch-env.md` and `contracts/README.md` before any production launch.

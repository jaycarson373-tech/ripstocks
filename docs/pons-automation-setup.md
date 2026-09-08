# Pons v2 hourly automation

Pons launches last. Until the real launch exists, keep both live gates `false`. A CA alone never enables claims or airdrops.

The supported first release requires the Pons v2 launch to be paired in canonical USDG. Its `creatorFeeRecipient` is a separate Pons fee wallet whose key is stored only in Railway as `PONS_PRIVATE_KEY`. Pons v2 credits fees to that wallet in escrow; the hourly worker claims the exact USDG and forwards it to the automation/treasury wallet before allocating it.

The hourly flow is:

1. Reconstruct $RIP ERC-20 balances at a confirmed block and exclude system wallets.
2. Convert balances into whole tickets using `TOKENS_PER_TICKET`.
3. Read the Pons fee wallet's claimable USDG from the verified Pons v2 escrow.
4. Reserve the immutable holder snapshot, fee budget, and a future seed block in Supabase.
5. While the launch is on its curve, request its creator-safe fee sweep; otherwise claim whatever the Pons operator has already swept. Then claim the escrowed USDG with the Pons fee wallet and forward the exact amount to the automation wallet. Every signed transaction is stored before broadcast.
6. After the seed block is confirmed, commit one weighted winner.
7. Spend 50% on a routed Stock Token and deliver the exact received amount to that winner.
8. Spend 50% on another routed Stock Token and load the exact received amount into Pack #01 inventory.

Every transfer is verified from its Robinhood Chain receipt. A retry reuses the same signed transaction and the same winner. After graduation, any pool-fee conversion that requires Pons' trusted operator must be swept by that operator before the balance becomes claimable.

After launch, add these Railway-only values:

```bash
PONS_TOKEN_ADDRESS=0x...
PONS_TOKEN_START_BLOCK=...
PONS_V2_FACTORY=0x...
PONS_FEE_ESCROW=0x...
PONS_FEE_ASSET_ADDRESS=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
TOKENS_PER_TICKET=10000
HOLDER_DROP_SHARE_BPS=5000
PONS_CONFIRMATION_BLOCKS=12
PONS_HOLDER_EXCLUSIONS=0xSYSTEM_WALLET,0xOTHER_EXCLUSION
```

Run `supabase/pons-v2-hourly.sql` once in the new project. Then use `AUTOMATION_MODE=dry-run` with both gates still `false` for ordinary treasury checks. To exercise the Pons planner without sending, set both gates `true` while mode remains `dry-run`. Review the reported token, fee recipient, pair asset, claimable amount, snapshot, tickets, and routes. Only after that exact review should `AUTOMATION_MODE=live` be used.

Actual v2 reference: [Pons v2 docs](https://docs.ponsfamily.com/v2).

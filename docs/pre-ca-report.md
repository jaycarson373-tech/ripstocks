# Pre-CA implementation report

## Implemented

- Standalone treasury worker on Robinhood Chain 4663. No Pons CA or creator private key requirement.
- Pack #01 price/universe catalog; immutable per-contract pricing for future packs.
- Initial buys and hourly restocks persist signed transactions before broadcast, reconcile exact stock output, and reuse transaction hashes on retries.
- Separate confirmed settlement indexing and hourly spending reservations. Pending payments/deposits are not recorded as sale revenue.
- Fresh Supabase setup without legacy Pons tables. Current `sb_secret_` and legacy service-role keys supported server-side.
- Pons v1 runtime retired. Actual v2 escrow ABI isolated; claims and holder rewards disabled.
- Site pricing/copy scoped to Pack #01; inactive holder rewards are not advertised as running. Existing wallet/selection flow retained, with recovery when the worker settles before the browser.
- Vercel's obsolete Supabase URL/key and holder-live flag removed. Railway environment updates are blocked by an expired/rejected CLI login.

## Real lifecycle: not yet proven

| Step | Mainnet result | Reason |
| --- | --- | --- |
| Robinhood RPC / network 4663 | PASS | RPC returned chain ID `0x1237` |
| Funded treasury ready | FAIL — blocked | Treasury key/funding not available for verification |
| Small stock buy | FAIL — not executed | Needs treasury signer, pack deployment, new DB, and authorized 0x routing |
| Actual tokens received | FAIL — unverified | No real swap receipt |
| Load funded inventory | FAIL — unverified | No real load receipt |
| User buys Pack #01 | FAIL — unverified | Requires deployed, funded contract and controlled buyer test |
| Stock delivered / payment recorded | FAIL — unverified | Requires real settlement receipt and new database |
| Inventory decremented | FAIL — unverified | Requires real settlement |
| Proceeds ready and restocked once | FAIL — unverified | Requires real sale and closed-hour restock |

No transaction was broadcast during this update. Local contract tests exercise purchase/settlement and reject empty/duplicate operations, but do not prove mainnet liquidity, permissions, gas funding, deployment or the complete production lifecycle. Production is **BLOCKED**, not launch-ready.

Use [start-here.md](start-here.md) for the exact environment table, SQL, and controlled smoke-test commands. No new Railway project is needed; target `pacific-acceptance → production → ripstocks`. The new Supabase project is created by the user.

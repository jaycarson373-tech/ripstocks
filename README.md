# StonkRips

Inventory-backed Stock Token packs on Robinhood Chain 4663. **Pack #01 costs 20 canonical USDG**; other packs can have separate prices and stock universes.

Start with [the pre-CA setup guide](docs/start-here.md). The Pons CA is not a dependency of the treasury or pack lifecycle. Creator claims and holder rewards are disabled pending actual v2 integration.

Key files: `config/packs.json`, `contracts/StonkRips.sol`, `worker/treasury-worker.mjs`, `worker/treasury-buy.mjs`, `supabase/launch-setup.sql`.

Do not describe the product as launch-ready until the real mainnet buy → inventory → user purchase → delivery → payment receipt → hourly restock flow has been verified.

-- One-time pre-launch cleanup for StockDrop.
-- Run this only when you intentionally want to wipe old test / meme-pack history.
-- It keeps protocol config and wallet records, but clears inventories, proofs,
-- old purchases, chat, automation locks, and fee accounting rows.

begin;

delete from public.live_chat_messages;
delete from public.automation_runs;

delete from public.airdrop_inventory_lots;
delete from public.airdrop_epochs;

delete from public.inventory_restock_jobs;
delete from public.inventory_assets;
delete from public.inventory_lots;
delete from public.pack_orders;
delete from public.pack_inventory_ledger;

delete from public.holder_airdrop_treasury_ledger;
delete from public.pack_ev_reserve_ledger;
delete from public.protocol_fee_sweeps;
delete from public.protocol_fee_ledger;

update public.checkout_lock
set locked_until = '-infinity'
where id = true;

update public.protocol_config
set airdrop_interval_minutes = 5
where id = true;

commit;

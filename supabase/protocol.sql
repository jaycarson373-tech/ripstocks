-- RipStocks production accounting. Pack-sale funds and protocol fees are never commingled.
create extension if not exists pgcrypto;
create table if not exists public.protocol_config (id boolean primary key default true check(id), airdrop_interval_minutes int not null default 5 check(airdrop_interval_minutes=5));
alter table public.protocol_config drop constraint if exists protocol_config_airdrop_interval_minutes_check;
alter table public.protocol_config alter column airdrop_interval_minutes set default 5;
update public.protocol_config set airdrop_interval_minutes=5;
alter table public.protocol_config add constraint protocol_config_airdrop_interval_minutes_check check(airdrop_interval_minutes=5);
insert into public.protocol_config(id,airdrop_interval_minutes) values(true,5) on conflict(id) do update set airdrop_interval_minutes=5;

-- Two explicit public accounts. Private signing material belongs only in Railway.
create table if not exists public.protocol_wallets (
  role text primary key check(role in ('main_treasury','holder_airdrop')),
  address text not null unique,
  updated_at timestamptz not null default now()
);
alter table public.protocol_wallets drop constraint if exists protocol_wallets_role_check;
delete from public.protocol_wallets where role='pack_ev_reserve';
delete from public.protocol_wallets where role='pack_inventory' and exists(select 1 from public.protocol_wallets where role='main_treasury');
update public.protocol_wallets set role='main_treasury' where role='pack_inventory';
alter table public.protocol_wallets add constraint protocol_wallets_role_check check(role in ('main_treasury','holder_airdrop'));

create table if not exists public.pack_inventory_ledger (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  entry_type text not null check(entry_type in ('pack_sale','inventory_purchase','inventory_adjustment','pack_fulfillment','ev_reserve_purchase')),
  usdc_delta numeric(18,6) not null default 0, stock_value_delta numeric(18,6) not null default 0,
  packs_delta int not null default 0, transaction_signature text unique, metadata jsonb not null default '{}'
);
create table if not exists public.inventory_assets (
  id uuid primary key default gen_random_uuid(), symbol text not null, mint text not null unique,
  token_balance numeric(30,12) not null default 0, usd_value numeric(18,6) not null default 0,
  active boolean not null default true, updated_at timestamptz not null default now()
);
create table if not exists public.inventory_lots (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  symbol text not null, mint text not null, token_amount numeric(30,0) not null check(token_amount>0),
  decimals int not null check(decimals between 0 and 12), token_program text not null default 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', usd_value numeric(18,6) not null check(usd_value>0),
  acquisition_signature text not null, status text not null default 'available' check(status in ('available','reserved','paid','fulfilled','failed')),
  reserved_order_id uuid, reserved_until timestamptz, fulfillment_signature text unique
);
create table if not exists public.inventory_restock_jobs (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  source text not null check(source in ('pack_sale','pack_ev_reserve')),
  input_mint text not null, input_amount numeric(30,12) not null check(input_amount>0),
  target_symbol text, target_mint text,
  status text not null default 'queued' check(status in ('queued','swapping','confirmed','inventory_added','failed')),
  jupiter_request_id text, swap_signature text unique, inventory_ledger_id uuid references public.pack_inventory_ledger(id),
  error text, updated_at timestamptz not null default now()
);
create table if not exists public.protocol_fee_ledger (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  gross_fee_usdc numeric(18,6) not null check(gross_fee_usdc>=0),
  holder_airdrop_amount numeric(18,6) generated always as (round(gross_fee_usdc*.80,6)) stored,
  pack_ev_reserve_amount numeric(18,6) generated always as (gross_fee_usdc-round(gross_fee_usdc*.80,6)) stored,
  transaction_signature text unique not null
);
alter table public.protocol_fee_ledger drop column if exists holder_airdrop_amount;
alter table public.protocol_fee_ledger drop column if exists pack_ev_reserve_amount;
alter table public.protocol_fee_ledger add column holder_airdrop_amount numeric(18,6) generated always as (round(gross_fee_usdc*.80,6)) stored;
alter table public.protocol_fee_ledger add column pack_ev_reserve_amount numeric(18,6) generated always as (gross_fee_usdc-round(gross_fee_usdc*.80,6)) stored;
-- Fees land in Main Treasury. Each verified 5-minute sweep transfers 80% to
-- Holder Airdrops while the 20% inventory allocation remains in Main Treasury.
create table if not exists public.protocol_fee_sweeps (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  fee_ledger_id uuid not null unique references public.protocol_fee_ledger(id),
  holder_airdrop_amount numeric(18,6) not null check(holder_airdrop_amount>=0),
  pack_ev_reserve_amount numeric(18,6) not null check(pack_ev_reserve_amount>=0),
  holder_transfer_signature text not null unique,
  reserve_transfer_signature text unique, -- legacy compatibility; no transfer is made in the two-wallet model
  retained_in_main_treasury boolean not null default true
);
alter table public.protocol_fee_sweeps add column if not exists retained_in_main_treasury boolean not null default true;
alter table public.protocol_fee_sweeps alter column reserve_transfer_signature drop not null;
create table if not exists public.holder_airdrop_treasury_ledger (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  amount_usdc numeric(18,6) not null, entry_type text not null check(entry_type in ('fee_credit','stock_purchase','airdrop','adjustment')),
  fee_ledger_id uuid references public.protocol_fee_ledger(id), transaction_signature text unique
);
create table if not exists public.pack_ev_reserve_ledger (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  amount_usdc numeric(18,6) not null, entry_type text not null check(entry_type in ('fee_credit','inventory_purchase','adjustment')),
  fee_ledger_id uuid references public.protocol_fee_ledger(id), inventory_ledger_id uuid references public.pack_inventory_ledger(id), transaction_signature text unique
);
create table if not exists public.pack_orders (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(), wallet text not null,
  tier int not null check(tier=10), payment_signature text unique,
  status text not null check(status in ('pending','verified','fulfilled','refunded','failed')),
  stock_symbol text, stock_mint text, stock_value numeric(18,6), fulfillment_signature text unique
);
alter table public.pack_orders alter column payment_signature drop not null;
alter table public.pack_orders drop constraint if exists pack_orders_tier_check;
alter table public.pack_orders add constraint pack_orders_tier_check check(tier=10);
alter table public.inventory_lots add column if not exists reserved_order_id uuid;
alter table public.inventory_lots add column if not exists token_program text not null default 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
do $$ begin
  alter table public.inventory_lots add constraint inventory_lots_order_fk foreign key(reserved_order_id) references public.pack_orders(id);
exception when duplicate_object then null; end $$;
create table if not exists public.checkout_lock (
  id boolean primary key default true check(id), locked_until timestamptz not null default '-infinity'
);
insert into public.checkout_lock(id) values(true) on conflict(id) do nothing;

create or replace function public.reserve_pack_checkout(p_wallet text) returns table(order_id uuid)
language plpgsql security definer set search_path=public as $$
declare v_order uuid; v_lot uuid; v_lock checkout_lock%rowtype;
begin
  select * into v_lock from checkout_lock where id=true for update;
  if v_lock.locked_until>now() then raise exception 'Another pack is being opened. Try again shortly.' using errcode='P0001'; end if;
  if exists(select 1 from pack_orders where wallet=p_wallet and created_at>now()-interval '1 minute') then raise exception 'Wallet cooldown is active.' using errcode='P0001'; end if;
  select id into v_lot from inventory_lots where status='available' order by encode(digest(id::text||gen_random_uuid()::text,'sha256'),'hex') limit 1 for update skip locked;
  if v_lot is null then raise exception 'No verified packs are available.' using errcode='P0001'; end if;
  insert into pack_orders(wallet,tier,status) values(p_wallet,10,'pending') returning id into v_order;
  update inventory_lots set status='reserved',reserved_order_id=v_order,reserved_until=now()+interval '3 minutes' where id=v_lot;
  update checkout_lock set locked_until=now()+interval '1 minute' where id=true;
  return query select v_order;
end $$;

drop function if exists public.claim_paid_inventory_lot(uuid,text,text);
create function public.claim_paid_inventory_lot(p_order_id uuid,p_wallet text,p_payment_signature text)
returns table(lot_id uuid,symbol text,mint text,token_amount text,decimals int,token_program text,usd_value numeric)
language plpgsql security definer set search_path=public as $$
begin
  update pack_orders set payment_signature=p_payment_signature,status='verified' where id=p_order_id and wallet=p_wallet and status in('pending','verified');
  if not found then raise exception 'Order is unavailable.'; end if;
  update inventory_lots set status='paid' where reserved_order_id=p_order_id and status in('reserved','paid');
  return query select l.id,l.symbol,l.mint,l.token_amount::text,l.decimals,l.token_program,l.usd_value from inventory_lots l where l.reserved_order_id=p_order_id and l.status='paid';
end $$;

create or replace function public.complete_pack_fulfillment(p_order_id uuid,p_lot_id uuid,p_fulfillment_signature text) returns void
language plpgsql security definer set search_path=public as $$
begin
  update inventory_lots set status='fulfilled',fulfillment_signature=p_fulfillment_signature where id=p_lot_id and reserved_order_id=p_order_id and status='paid';
  if not found then raise exception 'Inventory lot cannot be fulfilled.'; end if;
  update pack_orders o set status='fulfilled',stock_symbol=l.symbol,stock_mint=l.mint,stock_value=l.usd_value,fulfillment_signature=p_fulfillment_signature from inventory_lots l where o.id=p_order_id and l.id=p_lot_id;
  insert into pack_inventory_ledger(entry_type,stock_value_delta,packs_delta,transaction_signature,metadata) select 'pack_fulfillment',-l.usd_value,-1,p_fulfillment_signature,jsonb_build_object('order_id',p_order_id,'lot_id',p_lot_id) from inventory_lots l where l.id=p_lot_id;
end $$;
revoke all on function public.reserve_pack_checkout(text) from public,anon,authenticated;
revoke all on function public.claim_paid_inventory_lot(uuid,text,text) from public,anon,authenticated;
revoke all on function public.complete_pack_fulfillment(uuid,uuid,text) from public,anon,authenticated;
create table if not exists public.airdrop_epochs (
  id bigint primary key, starts_at timestamptz not null, ends_at timestamptz not null,
  snapshot_at timestamptz, eligible_holders int, winner_wallet text, pack_name text,
  stock_symbol text, reward_value numeric(18,6), transaction_signature text unique,
  status text not null default 'scheduled' check(status in ('scheduled','snapshotted','purchased','distributed','failed')),
  check(ends_at-starts_at=interval '5 minutes')
);
alter table public.airdrop_epochs drop constraint if exists airdrop_epochs_check;
alter table public.airdrop_epochs drop constraint if exists airdrop_epochs_interval_check;
alter table public.airdrop_epochs add constraint airdrop_epochs_interval_check check(ends_at-starts_at=interval '5 minutes');
create table if not exists public.airdrop_inventory_lots (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  symbol text not null, mint text not null, token_amount numeric(30,0) not null check(token_amount>0),
  decimals int not null check(decimals between 0 and 12), token_program text not null default 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  purchase_value numeric(18,6) not null check(purchase_value>0), acquisition_signature text not null unique,
  status text not null default 'available' check(status in ('available','reserved','distributed','failed')),
  epoch_id bigint references public.airdrop_epochs(id), distribution_signature text unique
);
create or replace function public.reserve_airdrop_epoch(p_epoch_id bigint,p_winner text,p_eligible_holders int)
returns table(lot_id uuid,symbol text,mint text,token_amount text,decimals int,token_program text,purchase_value numeric)
language plpgsql security definer set search_path=public as $$
declare v_lot uuid; v_start timestamptz; v_end timestamptz;
begin
  if exists(select 1 from airdrop_epochs where id=p_epoch_id) then return; end if;
  select id into v_lot from airdrop_inventory_lots where status='available' order by encode(digest(id::text||p_epoch_id::text,'sha256'),'hex') limit 1 for update skip locked;
  if v_lot is null then return; end if;
  v_start:=to_timestamp(p_epoch_id*300); v_end:=v_start+interval '5 minutes';
  insert into airdrop_epochs(id,starts_at,ends_at,snapshot_at,eligible_holders,winner_wallet,status) values(p_epoch_id,v_start,v_end,now(),p_eligible_holders,p_winner,'snapshotted');
  update airdrop_inventory_lots set status='reserved',epoch_id=p_epoch_id where id=v_lot;
  return query select l.id,l.symbol,l.mint,l.token_amount::text,l.decimals,l.token_program,l.purchase_value from airdrop_inventory_lots l where l.id=v_lot;
end $$;
create or replace function public.complete_airdrop_epoch(p_epoch_id bigint,p_lot_id uuid,p_signature text) returns void
language plpgsql security definer set search_path=public as $$
begin
  update airdrop_inventory_lots set status='distributed',distribution_signature=p_signature where id=p_lot_id and epoch_id=p_epoch_id and status='reserved';
  if not found then raise exception 'Airdrop lot cannot be completed'; end if;
  update airdrop_epochs e set pack_name='$'||l.purchase_value::text||' HOLDER PACK',stock_symbol=l.symbol,reward_value=l.purchase_value,transaction_signature=p_signature,status='distributed' from airdrop_inventory_lots l where e.id=p_epoch_id and l.id=p_lot_id;
  insert into holder_airdrop_treasury_ledger(amount_usdc,entry_type,transaction_signature) select -purchase_value,'airdrop',p_signature from airdrop_inventory_lots where id=p_lot_id;
end $$;
revoke all on function public.reserve_airdrop_epoch(bigint,text,int) from public,anon,authenticated;
revoke all on function public.complete_airdrop_epoch(bigint,uuid,text) from public,anon,authenticated;
create table if not exists public.automation_runs (
  run_key text primary key, kind text not null, status text not null check(status in ('running','confirmed','failed')),
  created_at timestamptz not null default now(), completed_at timestamptz, transaction_signature text unique
);

-- Railway calls this only after both transfers confirm on Solana. It atomically
-- records the fee, its exact 80/20 split, and both destination-wallet credits.
create or replace function public.record_protocol_fee_sweep(
  p_gross_fee_usdc numeric,
  p_fee_signature text,
  p_holder_transfer_signature text
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_fee_id uuid;
  v_holder numeric(18,6);
  v_reserve numeric(18,6);
begin
  if p_gross_fee_usdc <= 0 then raise exception 'gross fee must be positive'; end if;
  v_holder := round(p_gross_fee_usdc * .80, 6);
  v_reserve := p_gross_fee_usdc - v_holder;
  insert into protocol_fee_ledger(gross_fee_usdc,transaction_signature)
    values(p_gross_fee_usdc,p_fee_signature) returning id into v_fee_id;
  insert into protocol_fee_sweeps(fee_ledger_id,holder_airdrop_amount,pack_ev_reserve_amount,holder_transfer_signature,retained_in_main_treasury)
    values(v_fee_id,v_holder,v_reserve,p_holder_transfer_signature,true);
  insert into holder_airdrop_treasury_ledger(amount_usdc,entry_type,fee_ledger_id,transaction_signature)
    values(v_holder,'fee_credit',v_fee_id,p_holder_transfer_signature);
  insert into pack_ev_reserve_ledger(amount_usdc,entry_type,fee_ledger_id,transaction_signature)
    values(v_reserve,'fee_credit',v_fee_id,null);
  return v_fee_id;
end;
$$;
drop function if exists public.record_protocol_fee_sweep(numeric,text,text,text);
revoke all on function public.record_protocol_fee_sweep(numeric,text,text) from public,anon,authenticated;

create or replace function public.protocol_public_snapshot() returns jsonb language sql security definer set search_path=public as $$
with inv as (select coalesce(sum(usd_value) filter(where status='available'),0) stock_value, count(*) filter(where status='available') packs, count(*) purchases from inventory_lots),
opened as (select count(*) n from pack_orders where status='fulfilled'),
hat as (select coalesce(sum(amount_usdc),0) balance from holder_airdrop_treasury_ledger),
airpacks as (select count(*) n from airdrop_inventory_lots where status='available'),
evr as (select coalesce(sum(amount_usdc),0) balance from pack_ev_reserve_ledger),
drops as (select count(*) n,coalesce(sum(reward_value),0) value from airdrop_epochs where status='distributed'),
proofs as (select coalesce(jsonb_agg(jsonb_build_object('winner',winner_wallet,'pack',pack_name,'stock',stock_symbol,'value',reward_value,'time',ends_at,'signature',transaction_signature) order by ends_at desc),'[]'::jsonb) items from (select * from airdrop_epochs where status='distributed' order by ends_at desc limit 12) x),
recent_packs as (select coalesce(jsonb_agg(jsonb_build_object('wallet',wallet,'pack','$'||tier::text,'stock',stock_symbol,'value',stock_value,'time',created_at,'paymentSignature',payment_signature,'fulfillmentSignature',fulfillment_signature) order by created_at desc),'[]'::jsonb) items from (select * from pack_orders where status='fulfilled' order by created_at desc limit 20) x)
select jsonb_build_object('packInventoryValue',inv.stock_value,'remainingStockInventory',inv.stock_value,'packsRemaining',greatest(inv.packs,0),'totalPacksOpened',opened.n,'inventoryPurchases',inv.purchases,'inventoryAssets',(select count(*) from inventory_assets where active),'holderAirdropTreasury',hat.balance,'holderPacksAvailable',airpacks.n,'packEvReserve',evr.balance,'totalHolderDrops',drops.n,'totalValueAirdropped',drops.value,'proofs',proofs.items,'recentPacks',recent_packs.items) from inv,opened,hat,airpacks,evr,drops,proofs,recent_packs;
$$;
grant execute on function public.protocol_public_snapshot() to anon,authenticated;

alter table public.pack_inventory_ledger enable row level security;
alter table public.protocol_wallets enable row level security;
alter table public.inventory_assets enable row level security;
alter table public.inventory_lots enable row level security;
alter table public.checkout_lock enable row level security;
alter table public.inventory_restock_jobs enable row level security;
alter table public.protocol_fee_ledger enable row level security;
alter table public.protocol_fee_sweeps enable row level security;
alter table public.holder_airdrop_treasury_ledger enable row level security;
alter table public.pack_ev_reserve_ledger enable row level security;
alter table public.pack_orders enable row level security;
alter table public.airdrop_epochs enable row level security;
alter table public.airdrop_inventory_lots enable row level security;
alter table public.automation_runs enable row level security;

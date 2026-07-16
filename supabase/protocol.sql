-- RipStocks production accounting. Pack-sale funds and protocol fees are never commingled.
create extension if not exists pgcrypto;
create table if not exists public.protocol_config (id boolean primary key default true check(id), airdrop_interval_minutes int not null default 20 check(airdrop_interval_minutes=20));
insert into public.protocol_config(id,airdrop_interval_minutes) values(true,20) on conflict(id) do update set airdrop_interval_minutes=20;

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
insert into public.pack_inventory_ledger(entry_type,packs_delta,metadata)
select 'inventory_adjustment',247,'{"reason":"launch allocation"}'::jsonb
where not exists(select 1 from public.pack_inventory_ledger);
create table if not exists public.protocol_fee_ledger (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  gross_fee_usdc numeric(18,6) not null check(gross_fee_usdc>=0),
  holder_airdrop_amount numeric(18,6) generated always as (round(gross_fee_usdc*.75,6)) stored,
  pack_ev_reserve_amount numeric(18,6) generated always as (gross_fee_usdc-round(gross_fee_usdc*.75,6)) stored,
  transaction_signature text unique not null
);
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
  tier int not null check(tier in (10,30,50)), payment_signature text unique not null,
  status text not null check(status in ('pending','verified','fulfilled','refunded','failed')),
  stock_symbol text, stock_mint text, stock_value numeric(18,6), fulfillment_signature text unique
);
create table if not exists public.airdrop_epochs (
  id bigint primary key, starts_at timestamptz not null, ends_at timestamptz not null,
  snapshot_at timestamptz, eligible_holders int, winner_wallet text, pack_name text,
  stock_symbol text, reward_value numeric(18,6), transaction_signature text unique,
  status text not null default 'scheduled' check(status in ('scheduled','snapshotted','purchased','distributed','failed')),
  check(ends_at-starts_at=interval '20 minutes')
);

create or replace function public.protocol_public_snapshot() returns jsonb language sql security definer set search_path=public as $$
with inv as (select coalesce(sum(stock_value_delta),0) stock_value, coalesce(sum(packs_delta),0) packs, count(*) filter(where entry_type in('inventory_purchase','ev_reserve_purchase')) purchases from pack_inventory_ledger),
opened as (select count(*) n from pack_orders where status='fulfilled'),
hat as (select coalesce(sum(amount_usdc),0) balance from holder_airdrop_treasury_ledger),
evr as (select coalesce(sum(amount_usdc),0) balance from pack_ev_reserve_ledger),
drops as (select count(*) n,coalesce(sum(reward_value),0) value from airdrop_epochs where status='distributed'),
proofs as (select coalesce(jsonb_agg(jsonb_build_object('winner',winner_wallet,'pack',pack_name,'stock',stock_symbol,'value',reward_value,'time',ends_at,'signature',transaction_signature) order by ends_at desc),'[]'::jsonb) items from (select * from airdrop_epochs where status='distributed' order by ends_at desc limit 12) x)
select jsonb_build_object('packInventoryValue',inv.stock_value,'remainingStockInventory',inv.stock_value,'packsRemaining',greatest(inv.packs,0),'totalPacksOpened',opened.n,'inventoryPurchases',inv.purchases,'inventoryAssets',(select count(*) from inventory_assets where active),'holderAirdropTreasury',hat.balance,'packEvReserve',evr.balance,'totalHolderDrops',drops.n,'totalValueAirdropped',drops.value,'proofs',proofs.items) from inv,opened,hat,evr,drops,proofs;
$$;
grant execute on function public.protocol_public_snapshot() to anon,authenticated;

alter table public.pack_inventory_ledger enable row level security;
alter table public.inventory_assets enable row level security;
alter table public.protocol_fee_ledger enable row level security;
alter table public.holder_airdrop_treasury_ledger enable row level security;
alter table public.pack_ev_reserve_ledger enable row level security;
alter table public.pack_orders enable row level security;
alter table public.airdrop_epochs enable row level security;

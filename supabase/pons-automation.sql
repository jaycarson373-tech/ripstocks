-- StonkRips / Pons v2 hourly automation ledger.
-- Paste this entire file into a NEW Supabase project's SQL editor and run once.

create extension if not exists pgcrypto;

create table if not exists public.pons_epochs (
  id uuid primary key default gen_random_uuid(),
  epoch_key timestamptz not null unique,
  status text not null check (status in (
    'created', 'claiming', 'awaiting_seed', 'holder_drop_swap',
    'holder_drop_send', 'inventory_swap', 'inventory_load',
    'complete', 'no_fees', 'dry_run', 'error'
  )),
  automation_mode text not null check (automation_mode in ('dry-run', 'live')),
  pons_token_address text not null,
  fee_asset_address text not null,
  sweep_tx text,
  claim_tx text,
  preclaim_balance_atoms numeric(78, 0),
  fee_amount_atoms numeric(78, 0),
  holder_drop_budget_atoms numeric(78, 0),
  inventory_budget_atoms numeric(78, 0),
  snapshot_block bigint,
  seed_block bigint,
  seed_hash text,
  winner_address text,
  total_tickets numeric(78, 0),
  winning_ticket numeric(78, 0),
  drop_stock_symbol text,
  drop_stock_address text,
  drop_stock_amount_atoms numeric(78, 0),
  drop_approval_tx text,
  drop_swap_tx text,
  holder_drop_tx text,
  inventory_stock_symbol text,
  inventory_stock_address text,
  inventory_stock_amount_atoms numeric(78, 0),
  inventory_value_usd_micros numeric(78, 0),
  inventory_approval_tx text,
  inventory_swap_tx text,
  pack_approval_tx text,
  inventory_load_tx text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists pons_epochs_status_created_idx
  on public.pons_epochs (status, created_at desc);

create table if not exists public.pons_audit_events (
  id bigint generated always as identity primary key,
  epoch_id uuid not null references public.pons_epochs(id) on delete restrict,
  epoch_key timestamptz not null,
  previous_status text,
  next_status text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists pons_audit_events_epoch_idx
  on public.pons_audit_events (epoch_id, id);

create table if not exists public.automation_locks (
  lock_name text primary key,
  holder text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.pons_epochs enable row level security;
alter table public.pons_audit_events enable row level security;
alter table public.automation_locks enable row level security;

revoke all on public.pons_epochs from anon, authenticated;
revoke all on public.pons_audit_events from anon, authenticated;
revoke all on public.automation_locks from anon, authenticated;

create or replace function public.audit_pons_epoch_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.pons_audit_events (
      epoch_id,
      epoch_key,
      previous_status,
      next_status,
      details
    ) values (
      new.id,
      new.epoch_key,
      null,
      new.status,
      jsonb_strip_nulls(jsonb_build_object(
        'sweep_tx', new.sweep_tx,
        'claim_tx', new.claim_tx,
        'drop_swap_tx', new.drop_swap_tx,
        'holder_drop_tx', new.holder_drop_tx,
        'inventory_swap_tx', new.inventory_swap_tx,
        'inventory_load_tx', new.inventory_load_tx,
        'error', new.error
      ))
    );
  elsif old.status is distinct from new.status or old.error is distinct from new.error then
    insert into public.pons_audit_events (
      epoch_id,
      epoch_key,
      previous_status,
      next_status,
      details
    ) values (
      new.id,
      new.epoch_key,
      old.status,
      new.status,
      jsonb_strip_nulls(jsonb_build_object(
        'sweep_tx', new.sweep_tx,
        'claim_tx', new.claim_tx,
        'drop_swap_tx', new.drop_swap_tx,
        'holder_drop_tx', new.holder_drop_tx,
        'inventory_swap_tx', new.inventory_swap_tx,
        'inventory_load_tx', new.inventory_load_tx,
        'error', new.error
      ))
    );
  end if;
  return new;
end;
$$;

drop trigger if exists pons_epoch_status_audit on public.pons_epochs;
create trigger pons_epoch_status_audit
after insert or update of status, error on public.pons_epochs
for each row execute function public.audit_pons_epoch_status();

create or replace function public.acquire_automation_lock(
  p_holder text,
  p_ttl_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  acquired boolean := false;
begin
  if p_holder is null or length(trim(p_holder)) = 0 then
    raise exception 'holder is required';
  end if;
  if p_ttl_seconds < 30 or p_ttl_seconds > 3600 then
    raise exception 'ttl must be between 30 and 3600 seconds';
  end if;

  insert into public.automation_locks (lock_name, holder, expires_at, updated_at)
  values ('pons-hourly-worker', p_holder, now() + make_interval(secs => p_ttl_seconds), now())
  on conflict (lock_name) do update
    set holder = excluded.holder,
        expires_at = excluded.expires_at,
        updated_at = now()
    where public.automation_locks.expires_at <= now()
       or public.automation_locks.holder = excluded.holder
  returning true into acquired;

  return coalesce(acquired, false);
end;
$$;

create or replace function public.release_automation_lock(p_holder text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.automation_locks
  where lock_name = 'pons-hourly-worker' and holder = p_holder;
$$;

revoke all on function public.acquire_automation_lock(text, integer) from public, anon, authenticated;
revoke all on function public.release_automation_lock(text) from public, anon, authenticated;
grant execute on function public.acquire_automation_lock(text, integer) to service_role;
grant execute on function public.release_automation_lock(text) to service_role;

comment on table public.pons_epochs is
  'One idempotent UTC epoch per StonkRips hourly Pons fee cycle.';
comment on table public.pons_audit_events is
  'Append-only status transition evidence for each automation epoch.';

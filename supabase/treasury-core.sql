-- Fresh-project pre-CA treasury schema. No Pons project, CA, or holder tables.
create table if not exists public.automation_locks (
  lock_name text primary key, holder text not null,
  expires_at timestamptz not null, updated_at timestamptz not null default now()
);
alter table public.automation_locks enable row level security;
revoke all on public.automation_locks from anon, authenticated;
grant select on public.automation_locks to service_role;

create or replace function public.acquire_automation_lock(p_holder text, p_ttl_seconds integer default 900)
returns boolean language plpgsql security definer set search_path = public as $$
declare acquired boolean := false;
begin
  if p_holder is null or length(trim(p_holder)) = 0 then raise exception 'holder is required'; end if;
  if p_ttl_seconds < 30 or p_ttl_seconds > 3600 then raise exception 'invalid ttl'; end if;
  insert into public.automation_locks(lock_name,holder,expires_at,updated_at)
  values ('treasury-worker',p_holder,now()+make_interval(secs=>p_ttl_seconds),now())
  on conflict(lock_name) do update set holder=excluded.holder,expires_at=excluded.expires_at,updated_at=now()
  where public.automation_locks.expires_at <= now() or public.automation_locks.holder=excluded.holder
  returning true into acquired;
  return coalesce(acquired,false);
end; $$;
create or replace function public.release_automation_lock(p_holder text)
returns void language sql security definer set search_path = public as $$
  delete from public.automation_locks where lock_name='treasury-worker' and holder=p_holder;
$$;
revoke all on function public.acquire_automation_lock(text,integer), public.release_automation_lock(text) from public,anon,authenticated;
grant execute on function public.acquire_automation_lock(text,integer), public.release_automation_lock(text) to service_role;

-- Initial funding purchases have explicit, reusable operator-supplied IDs.
create table if not exists public.treasury_purchases (
  id text primary key, scope text not null, lot_index integer not null default 0,
  usd_atoms text not null check(usd_atoms ~ '^[1-9][0-9]*$'),
  stock_address text not null, stock_symbol text not null,
  token_amount_atoms text check(token_amount_atoms ~ '^[1-9][0-9]*$'),
  declared_usd_micros text check(declared_usd_micros ~ '^[1-9][0-9]*$'),
  load_transaction text, completed_at timestamptz, created_at timestamptz not null default now()
);
-- Immediate confirmed delivery/payment indexing, separate from hourly spending reservations.
create table if not exists public.pack_settlements (
  id text primary key, scope text not null, request_id text not null,
  transaction_hash text not null unique, block_number bigint not null, block_hash text not null,
  amount_atoms text not null check(amount_atoms ~ '^[1-9][0-9]*$'),
  buyer text not null, stock_address text not null,
  token_amount_atoms text not null check(token_amount_atoms ~ '^[1-9][0-9]*$'),
  declared_usd_micros text not null,
  unique(scope,request_id)
);
alter table public.treasury_purchases enable row level security;
alter table public.pack_settlements enable row level security;
revoke all on public.treasury_purchases,public.pack_settlements from anon,authenticated;
grant select,insert,update on public.treasury_purchases,public.pack_settlements to service_role;

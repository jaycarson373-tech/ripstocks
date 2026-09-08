-- Additive Pons v2 hourly audit schema. Safe to run before the Pons CA exists.
-- This creates no schedules and enables no claims, swaps, packs, or airdrops.

create table if not exists public.pons_hourly_epochs (
  id text primary key,
  scope text not null,
  epoch_key timestamptz not null,
  status text not null check (status in (
    'created','awaiting_seed','winner_committed','holder_sent','complete',
    'no_fees','no_holders','error'
  )),
  automation_mode text not null check (automation_mode in ('dry-run','live')),
  pons_token_address text not null,
  fee_asset_address text not null,
  snapshot_block bigint not null,
  snapshot_block_hash text not null,
  snapshot_hash text not null,
  seed_block bigint not null,
  seed_block_hash text,
  claimable_atoms text not null check (claimable_atoms ~ '^[0-9]+$'),
  claimed_atoms text check (claimed_atoms ~ '^[1-9][0-9]*$'),
  holder_budget_atoms text not null check (holder_budget_atoms ~ '^[0-9]+$'),
  inventory_budget_atoms text not null check (inventory_budget_atoms ~ '^[0-9]+$'),
  total_tickets text not null check (total_tickets ~ '^[0-9]+$'),
  winning_ticket text check (winning_ticket ~ '^[0-9]+$'),
  winner_address text,
  claim_tx text,
  holder_stock_symbol text,
  holder_stock_address text,
  holder_stock_amount_atoms text check (holder_stock_amount_atoms ~ '^[1-9][0-9]*$'),
  holder_swap_tx text,
  holder_drop_tx text,
  inventory_stock_symbol text,
  inventory_stock_address text,
  inventory_stock_amount_atoms text check (inventory_stock_amount_atoms ~ '^[1-9][0-9]*$'),
  inventory_value_usd_micros text check (inventory_value_usd_micros ~ '^[1-9][0-9]*$'),
  inventory_swap_tx text,
  inventory_load_tx text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (scope, epoch_key)
);

create table if not exists public.pons_holder_snapshots (
  epoch_id text not null references public.pons_hourly_epochs(id) on delete restrict,
  holder_address text not null,
  balance_atoms text not null check (balance_atoms ~ '^[1-9][0-9]*$'),
  tickets text not null check (tickets ~ '^[1-9][0-9]*$'),
  primary key (epoch_id, holder_address)
);

create table if not exists public.pons_hourly_audit (
  id bigint generated always as identity primary key,
  epoch_id text not null references public.pons_hourly_epochs(id) on delete restrict,
  previous_status text,
  next_status text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists pons_hourly_epoch_status_idx on public.pons_hourly_epochs (status, epoch_key desc);
create index if not exists pons_hourly_audit_epoch_idx on public.pons_hourly_audit (epoch_id, id);

alter table public.pons_hourly_epochs enable row level security;
alter table public.pons_holder_snapshots enable row level security;
alter table public.pons_hourly_audit enable row level security;
revoke all on public.pons_hourly_epochs, public.pons_holder_snapshots, public.pons_hourly_audit from anon, authenticated;
grant select, insert, update on public.pons_hourly_epochs, public.pons_holder_snapshots to service_role;
grant select, insert on public.pons_hourly_audit to service_role;

create or replace function public.audit_pons_hourly_epoch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.pons_hourly_audit(epoch_id,previous_status,next_status,details)
    values (new.id,null,new.status,
      jsonb_strip_nulls(jsonb_build_object(
        'claim_tx',new.claim_tx,'holder_swap_tx',new.holder_swap_tx,
        'holder_drop_tx',new.holder_drop_tx,'inventory_swap_tx',new.inventory_swap_tx,
        'inventory_load_tx',new.inventory_load_tx,'error',new.error
      )));
  elsif old.status is distinct from new.status or old.error is distinct from new.error then
    insert into public.pons_hourly_audit(epoch_id,previous_status,next_status,details)
    values (new.id,old.status,new.status,
      jsonb_strip_nulls(jsonb_build_object(
        'claim_tx',new.claim_tx,'holder_swap_tx',new.holder_swap_tx,
        'holder_drop_tx',new.holder_drop_tx,'inventory_swap_tx',new.inventory_swap_tx,
        'inventory_load_tx',new.inventory_load_tx,'error',new.error
      )));
  end if;
  return new;
end;
$$;
drop trigger if exists pons_hourly_epoch_audit on public.pons_hourly_epochs;
create trigger pons_hourly_epoch_audit after insert or update on public.pons_hourly_epochs
for each row execute function public.audit_pons_hourly_epoch();

create or replace function public.reserve_pons_hourly_epoch(p_epoch jsonb, p_holders jsonb, p_holder text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result public.pons_hourly_epochs; ticket_total numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_epoch->>'scope',0));
  if not exists (select 1 from public.automation_locks where lock_name='treasury-worker'
    and holder=p_holder and expires_at>now()) then raise exception 'Automation lease is not held'; end if;
  select * into result from public.pons_hourly_epochs where id=p_epoch->>'id';
  if found then return to_jsonb(result); end if;
  if jsonb_array_length(p_holders)>50000 then raise exception 'Holder snapshot is too large'; end if;
  select coalesce(sum((value->>'tickets')::numeric),0) into ticket_total from jsonb_array_elements(p_holders);
  if ticket_total::text <> p_epoch->>'total_tickets' then raise exception 'Snapshot tickets do not reconcile'; end if;
  if (p_epoch->>'seed_block')::bigint <= (p_epoch->>'snapshot_block')::bigint then raise exception 'Seed block must follow snapshot'; end if;
  if (p_epoch->>'status'='created' and (ticket_total<=0 or (p_epoch->>'claimable_atoms')::numeric<2)) then raise exception 'Active epoch is not funded and eligible'; end if;
  insert into public.pons_hourly_epochs (
    id,scope,epoch_key,status,automation_mode,pons_token_address,fee_asset_address,
    snapshot_block,snapshot_block_hash,snapshot_hash,seed_block,claimable_atoms,
    holder_budget_atoms,inventory_budget_atoms,total_tickets
  ) values (
    p_epoch->>'id',p_epoch->>'scope',(p_epoch->>'epoch_key')::timestamptz,p_epoch->>'status',p_epoch->>'automation_mode',
    p_epoch->>'pons_token_address',p_epoch->>'fee_asset_address',(p_epoch->>'snapshot_block')::bigint,
    p_epoch->>'snapshot_block_hash',p_epoch->>'snapshot_hash',(p_epoch->>'seed_block')::bigint,
    p_epoch->>'claimable_atoms',p_epoch->>'holder_budget_atoms',p_epoch->>'inventory_budget_atoms',p_epoch->>'total_tickets'
  ) returning * into result;
  insert into public.pons_holder_snapshots(epoch_id,holder_address,balance_atoms,tickets)
  select result.id,value->>'holder_address',value->>'balance_atoms',value->>'tickets'
  from jsonb_array_elements(p_holders);
  return to_jsonb(result);
end;
$$;
revoke all on function public.reserve_pons_hourly_epoch(jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.reserve_pons_hourly_epoch(jsonb,jsonb,text) to service_role;

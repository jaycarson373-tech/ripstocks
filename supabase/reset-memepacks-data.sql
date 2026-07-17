-- DESTRUCTIVE: clears all MemePacks operational/history data.
-- This intentionally preserves protocol_config and protocol_wallets.
-- Run only after confirming there are no pending payments, reserved packs,
-- or on-chain deliveries still awaiting reconciliation.

begin;

truncate table
  public.automation_runs,
  public.airdrop_epochs,
  public.airdrop_inventory_lots,
  public.pack_orders,
  public.inventory_lots,
  public.inventory_assets,
  public.inventory_restock_jobs,
  public.pack_inventory_ledger,
  public.protocol_fee_sweeps,
  public.holder_airdrop_treasury_ledger,
  public.pack_ev_reserve_ledger,
  public.protocol_fee_ledger,
  public.checkout_lock
restart identity cascade;

insert into public.checkout_lock(id, locked_until)
values (true, '-infinity')
on conflict (id) do update set locked_until = excluded.locked_until;

-- Synchronize holder drops to five-minute epochs.
alter table public.protocol_config drop constraint if exists protocol_config_airdrop_interval_minutes_check;
alter table public.protocol_config alter column airdrop_interval_minutes set default 5;
update public.protocol_config set airdrop_interval_minutes = 5;
alter table public.protocol_config add constraint protocol_config_airdrop_interval_minutes_check check (airdrop_interval_minutes = 5);
insert into public.protocol_config(id, airdrop_interval_minutes)
values (true, 5)
on conflict (id) do update set airdrop_interval_minutes = excluded.airdrop_interval_minutes;

alter table public.airdrop_epochs drop constraint if exists airdrop_epochs_check;
alter table public.airdrop_epochs drop constraint if exists airdrop_epochs_interval_check;
alter table public.airdrop_epochs add constraint airdrop_epochs_interval_check
  check (ends_at - starts_at = interval '5 minutes');

create or replace function public.reserve_airdrop_epoch(
  p_epoch_id bigint,
  p_winner text,
  p_eligible_holders int
) returns table(
  lot_id uuid,
  symbol text,
  mint text,
  token_amount text,
  decimals int,
  token_program text,
  purchase_value numeric
) language plpgsql security definer set search_path=public as $$
declare
  v_lot uuid;
  v_start timestamptz;
  v_end timestamptz;
begin
  if exists(select 1 from airdrop_epochs where id=p_epoch_id) then return; end if;
  select id into v_lot
    from airdrop_inventory_lots
    where status='available'
    order by encode(digest(id::text||p_epoch_id::text,'sha256'),'hex')
    limit 1 for update skip locked;
  if v_lot is null then return; end if;
  v_start := to_timestamp(p_epoch_id * 300);
  v_end := v_start + interval '5 minutes';
  insert into airdrop_epochs(id,starts_at,ends_at,snapshot_at,eligible_holders,winner_wallet,status)
    values(p_epoch_id,v_start,v_end,now(),p_eligible_holders,p_winner,'snapshotted');
  update airdrop_inventory_lots set status='reserved',epoch_id=p_epoch_id where id=v_lot;
  return query
    select l.id,l.symbol,l.mint,l.token_amount::text,l.decimals,l.token_program,l.purchase_value
    from airdrop_inventory_lots l where l.id=v_lot;
end;
$$;

-- Enforce the one-pack launch configuration.
alter table public.pack_orders drop constraint if exists pack_orders_tier_check;
alter table public.pack_orders add constraint pack_orders_tier_check check (tier = 10);

-- Rebuild generated fee columns with the new 80/20 allocation.
alter table public.protocol_fee_ledger drop column if exists holder_airdrop_amount;
alter table public.protocol_fee_ledger drop column if exists pack_ev_reserve_amount;
alter table public.protocol_fee_ledger
  add column holder_airdrop_amount numeric(18,6)
  generated always as (round(gross_fee_usdc * .80, 6)) stored;
alter table public.protocol_fee_ledger
  add column pack_ev_reserve_amount numeric(18,6)
  generated always as (gross_fee_usdc - round(gross_fee_usdc * .80, 6)) stored;

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

commit;

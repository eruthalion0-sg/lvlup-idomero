-- LvL Up Időmérő – Supabase adatbázis
create extension if not exists pgcrypto;

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  device_key text not null check (device_key in ('billiard','scolia','darts1','darts2','darts3','foosball1','foosball2')),
  guest_name text not null,
  hourly_rate integer not null check (hourly_rate > 0),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  amount integer,
  created_at timestamptz not null default now()
);

create unique index if not exists one_active_session_per_device
  on public.sessions(device_key) where ended_at is null;

alter table public.sessions enable row level security;
-- All client access goes through the Edge Function using the service role.
revoke all on public.sessions from anon, authenticated;

alter publication supabase_realtime add table public.sessions;


-- Vendégszámlák: pultos és tulajdonos által közösen kezelhető nyitott fogyasztási listák.
create table if not exists public.guest_tabs (
  id uuid primary key default gen_random_uuid(),
  guest_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tab_items (
  id uuid primary key default gen_random_uuid(),
  tab_id uuid not null references public.guest_tabs(id) on delete cascade,
  item_name text not null,
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now()
);

alter table public.guest_tabs enable row level security;
alter table public.tab_items enable row level security;
revoke all on public.guest_tabs from anon, authenticated;
revoke all on public.tab_items from anon, authenticated;


-- Fizetési napló: a lezárt vendégszámlák változatlan pillanatképe.
create table if not exists public.guest_tab_payments (
  id uuid primary key default gen_random_uuid(),
  guest_name text not null,
  items jsonb not null default '[]'::jsonb,
  settled_at timestamptz not null default now(),
  settled_by text not null check (settled_by in ('owner','staff'))
);
alter table public.guest_tab_payments enable row level security;
revoke all on public.guest_tab_payments from anon, authenticated;

-- Egyetlen tranzakcióban menti a számlát és törli a nyitott listát.
create or replace function public.settle_guest_tab(p_tab_id uuid, p_settled_by text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tab public.guest_tabs%rowtype;
  v_items jsonb;
  v_payment public.guest_tab_payments%rowtype;
begin
  if p_settled_by not in ('owner','staff') then
    raise exception 'Érvénytelen lezáró szerepkör.';
  end if;
  select * into v_tab from public.guest_tabs where id = p_tab_id for update;
  if not found then
    raise exception 'A vendégszámla nem található, vagy már lezárták.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('item_name', item_name, 'quantity', quantity) order by created_at), '[]'::jsonb)
    into v_items from public.tab_items where tab_id = p_tab_id;
  insert into public.guest_tab_payments(guest_name, items, settled_by)
    values (v_tab.guest_name, v_items, p_settled_by)
    returning * into v_payment;
  delete from public.guest_tabs where id = p_tab_id;
  return jsonb_build_object(
    'id', v_payment.id,
    'guest_name', v_payment.guest_name,
    'items', v_payment.items,
    'settled_at', v_payment.settled_at,
    'settled_by', v_payment.settled_by
  );
end;
$$;
revoke all on function public.settle_guest_tab(uuid,text) from public, anon, authenticated;
grant execute on function public.settle_guest_tab(uuid,text) to service_role;

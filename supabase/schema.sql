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

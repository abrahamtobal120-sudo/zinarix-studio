-- Zinarix Studio: accounts, license keys and messages (website/api/_lib/store.mjs).
-- Run it once in the Supabase project: SQL Editor → paste → Run. Safe to run again.
-- Times are milliseconds since 1970. Row level security is on with no policies: only the
-- service_role key (the website's functions) can read or write; the public anon key cannot.

create table if not exists zx_users (
  id uuid primary key,
  email text not null unique,
  name text not null default '',
  pass_hash text not null,
  created_at bigint not null,
  last_seen_at bigint,
  disabled boolean not null default false,
  failed integer not null default 0,
  locked_until bigint
);

create table if not exists zx_sessions (
  token_hash text primary key,
  user_id uuid not null references zx_users (id) on delete cascade,
  device text,
  created_at bigint not null,
  expires_at bigint not null
);
create index if not exists zx_sessions_user on zx_sessions (user_id);

create table if not exists zx_licenses (
  id text primary key,
  key text not null,
  plan text not null check (plan in ('pro', 'ai', 'proai')),
  email text not null,
  name text,
  note text,
  created_at bigint not null,
  expires_at bigint,
  revoked boolean not null default false,
  user_id uuid references zx_users (id) on delete set null
);
create index if not exists zx_licenses_user on zx_licenses (user_id);

create table if not exists zx_messages (
  id text primary key,
  text text not null,
  url text,
  created_at bigint not null,
  expires_at bigint
);

alter table zx_users enable row level security;
alter table zx_sessions enable row level security;
alter table zx_licenses enable row level security;
alter table zx_messages enable row level security;

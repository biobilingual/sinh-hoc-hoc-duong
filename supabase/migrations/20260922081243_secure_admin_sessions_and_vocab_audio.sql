create table if not exists public.admin_accounts (
  email text primary key check (email = lower(email)),
  display_name text not null default 'Quản trị viên',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_sessions (
  session_hash text primary key,
  admin_email text not null references public.admin_accounts(email) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists admin_sessions_admin_email_idx on public.admin_sessions(admin_email);
create index if not exists admin_sessions_expires_at_idx on public.admin_sessions(expires_at);

alter table public.admin_accounts enable row level security;
alter table public.admin_sessions enable row level security;

revoke all on public.admin_accounts from anon, authenticated;
revoke all on public.admin_sessions from anon, authenticated;

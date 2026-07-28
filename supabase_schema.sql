-- ============================================================
--  Bandeja — Esquema da base de dados
--  COMO USAR:
--   1. Entra no teu projeto Supabase
--   2. Menu lateral: "SQL Editor"  ->  "New query"
--   3. Cola TUDO isto e carrega em "Run"
-- ============================================================

-- ---------- Tabela: quintas / clientes ----------
create table if not exists public.quintas (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  nome        text not null,
  valor_hora  numeric(10,2) not null default 0,
  hora_inicio_padrao time,                       -- hora habitual de início nesta quinta
  latitude    double precision,                  -- localização (para reconhecer a quinta)
  longitude   double precision,
  morada      text,
  notas       text,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------- Tabela: serviços (turnos trabalhados) ----------
create table if not exists public.servicos (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade default auth.uid(),
  quinta_id    uuid references public.quintas(id) on delete set null,
  quinta_nome  text,                                   -- "fotografia" do nome na altura
  data         date not null,
  hora_inicio  time not null,
  hora_fim     time not null,
  valor_hora   numeric(10,2) not null default 0,       -- "fotografia" do valor/hora na altura
  gorjeta      numeric(10,2) not null default 0,
  estado       text not null default 'pendente',       -- 'pago' | 'pendente'
  notas        text,
  created_at   timestamptz not null default now()
);

-- ---------- Índices (pesquisa rápida) ----------
create index if not exists idx_servicos_user_data  on public.servicos(user_id, data desc);
create index if not exists idx_quintas_user        on public.quintas(user_id);

-- ============================================================
--  Segurança (RLS) — cada utilizador só vê os SEUS dados
-- ============================================================
alter table public.quintas   enable row level security;
alter table public.servicos  enable row level security;

drop policy if exists "quintas_own"   on public.quintas;
drop policy if exists "servicos_own"  on public.servicos;

create policy "quintas_own" on public.quintas
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "servicos_own" on public.servicos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
--  Perfis de utilizador (nome, apelido, número, username) +
--  login por username
-- ============================================================
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nome       text,
  apelido    text,
  numero     text,
  username   text,
  email      text,
  created_at timestamptz not null default now()
);

-- username único (ignora maiúsculas/minúsculas)
create unique index if not exists profiles_username_unique
  on public.profiles (lower(username));

alter table public.profiles enable row level security;
drop policy if exists "profiles_own" on public.profiles;
create policy "profiles_own" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- cria o perfil automaticamente quando alguém se regista
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nome, apelido, numero, username, email)
  values (
    new.id,
    new.raw_user_meta_data->>'nome',
    new.raw_user_meta_data->>'apelido',
    new.raw_user_meta_data->>'numero',
    new.raw_user_meta_data->>'username',
    new.email
  );
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- descobrir o email a partir do username (para entrar com username)
create or replace function public.email_do_username(uname text)
returns text language sql security definer set search_path = public as $$
  select email from public.profiles where lower(username) = lower(uname) limit 1;
$$;
grant execute on function public.email_do_username(text) to anon, authenticated;

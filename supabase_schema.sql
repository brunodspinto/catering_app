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

-- ---------- Tabela: poupanças (entradas/saídas) ----------
create table if not exists public.poupancas (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  data        date not null default current_date,
  tipo        text not null,                            -- 'entrada' | 'saida'
  valor       numeric(10,2) not null,
  descricao   text,
  created_at  timestamptz not null default now()
);

-- ---------- Índices (pesquisa rápida) ----------
create index if not exists idx_servicos_user_data  on public.servicos(user_id, data desc);
create index if not exists idx_quintas_user        on public.quintas(user_id);
create index if not exists idx_poupancas_user_data on public.poupancas(user_id, data desc);

-- ============================================================
--  Segurança (RLS) — cada utilizador só vê os SEUS dados
-- ============================================================
alter table public.quintas   enable row level security;
alter table public.servicos  enable row level security;
alter table public.poupancas enable row level security;

drop policy if exists "quintas_own"   on public.quintas;
drop policy if exists "servicos_own"  on public.servicos;
drop policy if exists "poupancas_own" on public.poupancas;

create policy "quintas_own" on public.quintas
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "servicos_own" on public.servicos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "poupancas_own" on public.poupancas
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

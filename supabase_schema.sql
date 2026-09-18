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
  hora_inicio  time,                                -- vazio nos serviços agendados
  hora_fim     time,
  valor_hora   numeric(10,2) not null default 0,       -- "fotografia" do valor/hora na altura
  gorjeta      numeric(10,2) not null default 0,
  estado       text not null default 'pendente',       -- 'agendado' | 'pendente' | 'pago'
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

-- (select auth.uid()) é avaliado uma vez por query, e não uma vez por linha;
-- "to authenticated": as políticas nem são avaliadas para quem não tem sessão
create policy "quintas_own" on public.quintas
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "servicos_own" on public.servicos
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ============================================================
--  Perfis de utilizador (nome, apelido, número, username)
--  O username só é mostrado na app; o login é feito por email.
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
  for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

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

-- o login é só por email: remove a função antiga de login por username
-- (expunha emails a quem não tinha sessão)
drop function if exists public.email_do_username(text);

-- ============================================================
--  Integridade dos dados (alterações aditivas)
--  Serve para uma base de dados nova e para uma que já existe:
--  não apaga dados e pode ser corrida mais do que uma vez.
--  Corre numa transação: se alguma regra falhar por causa de
--  dados antigos, nada desta secção fica aplicado.
--  Requer PostgreSQL 15 ou superior (ON DELETE SET NULL (coluna)).
-- ============================================================
begin;

-- ---------- Regras de validação (CHECK) ----------
-- (NULL passa sempre num CHECK: campos opcionais vazios continuam permitidos)

alter table public.quintas
  drop constraint if exists quintas_nome_nao_vazio,
  drop constraint if exists quintas_nome_tamanho,
  drop constraint if exists quintas_valor_hora_nao_negativo,
  drop constraint if exists quintas_notas_tamanho;
alter table public.quintas
  add constraint quintas_nome_nao_vazio          check (length(trim(nome)) > 0),
  add constraint quintas_nome_tamanho            check (char_length(nome) <= 100),
  add constraint quintas_valor_hora_nao_negativo check (valor_hora >= 0),
  add constraint quintas_notas_tamanho           check (char_length(notas) <= 1000);

alter table public.servicos
  drop constraint if exists servicos_estado_valido,
  drop constraint if exists servicos_valor_hora_nao_negativo,
  drop constraint if exists servicos_gorjeta_nao_negativa,
  drop constraint if exists servicos_horas_se_realizado,
  drop constraint if exists servicos_quinta_nome_nao_vazio,
  drop constraint if exists servicos_quinta_nome_tamanho,
  drop constraint if exists servicos_notas_tamanho;
alter table public.servicos
  add constraint servicos_estado_valido           check (estado in ('agendado', 'pendente', 'pago')),
  add constraint servicos_valor_hora_nao_negativo check (valor_hora >= 0),
  add constraint servicos_gorjeta_nao_negativa    check (gorjeta >= 0),
  -- só os agendados podem não ter horas
  add constraint servicos_horas_se_realizado      check (estado = 'agendado' or (hora_inicio is not null and hora_fim is not null)),
  add constraint servicos_quinta_nome_nao_vazio   check (length(trim(quinta_nome)) > 0),
  add constraint servicos_quinta_nome_tamanho     check (char_length(quinta_nome) <= 100),
  add constraint servicos_notas_tamanho           check (char_length(notas) <= 1000);

alter table public.profiles
  drop constraint if exists profiles_nome_tamanho,
  drop constraint if exists profiles_apelido_tamanho,
  drop constraint if exists profiles_numero_tamanho,
  drop constraint if exists profiles_username_formato;
alter table public.profiles
  add constraint profiles_nome_tamanho     check (char_length(nome) <= 100),
  add constraint profiles_apelido_tamanho  check (char_length(apelido) <= 100),
  add constraint profiles_numero_tamanho   check (char_length(numero) <= 30),
  -- a mesma regra da app (3+ caracteres: letras, números, _ ou .), com máximo de 30
  add constraint profiles_username_formato check (username ~ '^[A-Za-z0-9_.]{3,30}$');

-- ---------- Um serviço só pode apontar para uma quinta do mesmo utilizador ----------
-- A FK composta (quinta_id, user_id) precisa de uma chave única (id, user_id) em quintas.
-- (id já é único por ser a chave primária; este par existe só para servir de alvo à FK)
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.quintas'::regclass and conname = 'quintas_id_user_id_key') then
    alter table public.quintas add constraint quintas_id_user_id_key unique (id, user_id);
  end if;
end $$;

-- Troca a FK simples servicos.quinta_id -> quintas(id) pela composta.
-- ON DELETE SET NULL (quinta_id): ao apagar a quinta só o quinta_id fica a NULL.
-- (um SET NULL sem lista de colunas também punha user_id a NULL, que é NOT NULL,
--  e apagar uma quinta com serviços passava a falhar)
do $$
declare
  fk record;
begin
  -- remove a FK antiga, seja qual for o nome que tenha nesta base de dados
  for fk in
    select conname from pg_constraint
    where conrelid = 'public.servicos'::regclass and contype = 'f'
      and confrelid = 'public.quintas'::regclass and conname <> 'servicos_quinta_user_fkey'
  loop
    execute format('alter table public.servicos drop constraint %I', fk.conname);
  end loop;

  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.servicos'::regclass and conname = 'servicos_quinta_user_fkey') then
    alter table public.servicos
      add constraint servicos_quinta_user_fkey
      foreign key (quinta_id, user_id) references public.quintas (id, user_id)
      on delete set null (quinta_id);
  end if;
end $$;

-- ao apagar uma quinta, encontrar os serviços dela sem percorrer a tabela toda
create index if not exists idx_servicos_quinta on public.servicos(quinta_id);

-- ---------- profiles.email: só de leitura, sempre igual ao email da conta ----------
-- O cliente pode enviar email no upsert do perfil; o trigger ignora esse valor e usa o
-- de auth.users. (Uma política RLS não consegue comparar o valor antigo com o novo de
-- uma coluna, e retirar a permissão de UPDATE à coluna partia o upsert que a app faz.)
create or replace function public.profiles_email_da_conta()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.email := (select u.email from auth.users u where u.id = new.id);
  return new;
end; $$;

drop trigger if exists profiles_email_da_conta on public.profiles;
create trigger profiles_email_da_conta
  before insert or update on public.profiles
  for each row execute function public.profiles_email_da_conta();

-- quando o email da conta muda no Auth, a cópia no perfil acompanha
create or replace function public.sincronizar_email_perfil()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end; $$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.sincronizar_email_perfil();

-- corrige as cópias que já estejam diferentes do email da conta
update public.profiles p
  set email = u.email
  from auth.users u
  where u.id = p.id and p.email is distinct from u.email;

commit;

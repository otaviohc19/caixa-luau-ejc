-- =====================================================================
-- Caixa Lual — esquema do Supabase
-- Rode UMA vez no SQL Editor do painel (cole tudo e clique em Run).
-- =====================================================================

-- 1) Perfis: nome de exibição + flag de admin, ligados ao Supabase Auth.
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text not null,
  name       text not null,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

-- Cria o perfil sozinho quando você adiciona um usuário no painel.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, name)
  values (
    new.id,
    split_part(new.email, '@', 1),
    initcap(split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Ajudante usado nas regras de acesso.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- 2) Produtos (cardápio compartilhado entre todos os caixas).
create table if not exists public.products (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  price      numeric(10,2) not null check (price > 0),
  category   text not null default 'Geral',
  is_combo   boolean not null default false,
  components jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- 3) Vendas (todas as vendas de todos os caixas num lugar só).
create table if not exists public.sales (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id),
  caixa      text not null,
  payment    text not null check (payment in ('dinheiro', 'pix', 'cartao')),
  total      numeric(10,2) not null check (total >= 0),
  recebido   numeric(10,2),
  troco      numeric(10,2),
  items      jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists sales_created_at_idx on public.sales (created_at);

-- 4) Regras de acesso (Row Level Security).
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.sales    enable row level security;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists "products_select" on public.products;
create policy "products_select" on public.products
  for select to authenticated using (true);

drop policy if exists "products_insert" on public.products;
create policy "products_insert" on public.products
  for insert to authenticated with check (public.is_admin());

drop policy if exists "products_update" on public.products;
create policy "products_update" on public.products
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "products_delete" on public.products;
create policy "products_delete" on public.products
  for delete to authenticated using (public.is_admin());

drop policy if exists "sales_select" on public.sales;
create policy "sales_select" on public.sales
  for select to authenticated using (true);

drop policy if exists "sales_insert" on public.sales;
create policy "sales_insert" on public.sales
  for insert to authenticated with check (user_id = auth.uid());

-- Admin apaga qualquer venda; operador só apaga a própria, e só nos 10 min
-- seguintes (é o que sustenta o botão "Desfazer última venda").
drop policy if exists "sales_delete" on public.sales;
create policy "sales_delete" on public.sales
  for delete to authenticated
  using (
    public.is_admin()
    or (user_id = auth.uid() and created_at > now() - interval '10 minutes')
  );

-- 5) Permissões: quem não está logado não enxerga nada.
revoke all on public.profiles from anon;
revoke all on public.products from anon;
revoke all on public.sales    from anon;

grant usage on schema public to authenticated;
grant select                         on public.profiles to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, delete         on public.sales    to authenticated;

revoke execute on function public.is_admin()        from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant  execute on function public.is_admin()        to authenticated;

-- 6) Tempo real (vendas e produtos aparecem nos outros aparelhos na hora).
alter publication supabase_realtime add table public.sales, public.products;

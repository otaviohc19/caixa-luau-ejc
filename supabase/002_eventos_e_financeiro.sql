-- =====================================================================
-- Migração 002 — eventos, gastos e estoque
-- Rode UMA vez no SQL Editor, DEPOIS do schema.sql.
--
-- Seguro para quem já tem dados: os produtos e as vendas que já existem
-- passam a pertencer a um primeiro evento chamado "Luau" (renomeie depois
-- no app, em Eventos). Pode rodar de novo sem estragar nada.
-- =====================================================================

-- 1) Eventos --------------------------------------------------------------
create table if not exists public.events (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  event_date date,
  status     text not null default 'planejado'
             check (status in ('planejado', 'aberto', 'encerrado')),
  notes      text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- No máximo UM evento aberto por vez (é nele que os caixas vendem).
create unique index if not exists events_um_aberto
  on public.events ((true)) where status = 'aberto';

-- 2) Produtos e vendas passam a pertencer a um evento ---------------------
alter table public.products
  add column if not exists event_id uuid references public.events(id) on delete cascade;
-- "restrict": não deixa apagar um evento que ainda tem vendas.
alter table public.sales
  add column if not exists event_id uuid references public.events(id) on delete restrict;

do $$
declare ev uuid;
begin
  if exists (select 1 from public.products where event_id is null)
     or exists (select 1 from public.sales where event_id is null) then
    select id into ev from public.events order by created_at limit 1;
    if ev is null then
      insert into public.events (name, event_date, status)
      values ('Luau', coalesce((select min(created_at)::date from public.sales), current_date), 'aberto')
      returning id into ev;
    end if;
    update public.products set event_id = ev where event_id is null;
    update public.sales    set event_id = ev where event_id is null;
  end if;
end
$$;

alter table public.products alter column event_id set not null;
alter table public.sales    alter column event_id set not null;
create index if not exists products_event_idx on public.products (event_id);
create index if not exists sales_event_idx    on public.sales (event_id, created_at);

-- 3) Gastos (estoque, decoração, etc.) ------------------------------------
-- Gasto de estoque tem product_id + qty: é assim que o app calcula quanto
-- foi comprado, quanto sobrou e a margem de cada produto.
create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete restrict,
  category    text not null,
  description text not null check (length(trim(description)) > 0),
  amount      numeric(10,2) not null check (amount >= 0),
  product_id  uuid references public.products(id) on delete set null,
  qty         numeric(10,2) check (qty is null or qty > 0),
  paid_by     text,
  paid_at     date not null default current_date,
  reimbursed  boolean not null default false,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists expenses_event_idx on public.expenses (event_id, paid_at);

-- 4) Regras de acesso -----------------------------------------------------
alter table public.events   enable row level security;
alter table public.expenses enable row level security;

-- Eventos: todos leem (o caixa precisa saber qual está aberto); só admin altera.
drop policy if exists "events_select" on public.events;
create policy "events_select" on public.events
  for select to authenticated using (true);

drop policy if exists "events_insert" on public.events;
create policy "events_insert" on public.events
  for insert to authenticated with check (public.is_admin());

drop policy if exists "events_update" on public.events;
create policy "events_update" on public.events
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "events_delete" on public.events;
create policy "events_delete" on public.events
  for delete to authenticated using (public.is_admin());

-- Gastos: só admin enxerga e mexe (operador não precisa ver custo).
drop policy if exists "expenses_select" on public.expenses;
create policy "expenses_select" on public.expenses
  for select to authenticated using (public.is_admin());

drop policy if exists "expenses_insert" on public.expenses;
create policy "expenses_insert" on public.expenses
  for insert to authenticated with check (public.is_admin());

drop policy if exists "expenses_update" on public.expenses;
create policy "expenses_update" on public.expenses
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "expenses_delete" on public.expenses;
create policy "expenses_delete" on public.expenses
  for delete to authenticated using (public.is_admin());

-- Vendas: agora só dá pra vender (e desfazer) num evento ABERTO.
drop policy if exists "sales_insert" on public.sales;
create policy "sales_insert" on public.sales
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.events e where e.id = event_id and e.status = 'aberto')
  );

drop policy if exists "sales_delete" on public.sales;
create policy "sales_delete" on public.sales
  for delete to authenticated
  using (
    public.is_admin()
    or (
      user_id = auth.uid()
      and created_at > now() - interval '10 minutes'
      and exists (select 1 from public.events e where e.id = event_id and e.status = 'aberto')
    )
  );

-- 5) Abrir um evento (encerra o que estava aberto, de forma atômica) ------
create or replace function public.open_event(p_event uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'apenas admin pode abrir um evento' using errcode = '42501';
  end if;
  if not exists (select 1 from public.events where id = p_event) then
    raise exception 'evento não encontrado' using errcode = 'P0002';
  end if;
  update public.events set status = 'encerrado' where status = 'aberto' and id <> p_event;
  update public.events set status = 'aberto' where id = p_event;
end
$$;

-- 6) Totais por evento (para o comparativo entre eventos) -----------------
create or replace view public.event_totals
with (security_invoker = true) as
select
  e.id as event_id,
  e.name,
  e.event_date,
  e.status,
  e.created_at,
  coalesce((select sum(s.total) from public.sales s where s.event_id = e.id), 0)::numeric(12,2) as revenue,
  coalesce((select count(*)     from public.sales s where s.event_id = e.id), 0)::int            as sales_count,
  coalesce((select sum(x.amount) from public.expenses x where x.event_id = e.id), 0)::numeric(12,2) as expenses
from public.events e;

-- 7) Permissões -----------------------------------------------------------
revoke all on public.events       from anon;
revoke all on public.expenses     from anon;
revoke all on public.event_totals from anon;

grant select, insert, update, delete on public.events   to authenticated;
grant select, insert, update, delete on public.expenses to authenticated;
grant select                         on public.event_totals to authenticated;

revoke execute on function public.open_event(uuid) from public, anon;
grant  execute on function public.open_event(uuid) to authenticated;

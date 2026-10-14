-- =====================================================================
-- Migração 003 — crédito/débito, cancelamento com autorização e contas
-- Rode UMA vez no SQL Editor, DEPOIS do schema.sql e da 002.
-- Pode rodar de novo sem estragar nada.
-- =====================================================================

-- 1) Formas de pagamento: "cartão" vira crédito e débito -----------------
-- ('cartao' continua aceito só para não quebrar vendas antigas.)
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.sales'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%payment%'
  loop
    execute format('alter table public.sales drop constraint %I', c.conname);
  end loop;
end
$$;
alter table public.sales
  add constraint sales_payment_check
  check (payment in ('dinheiro', 'pix', 'credito', 'debito', 'cartao'));

-- 2) Venda cancelada fica registrada (não é apagada) ---------------------
alter table public.sales
  add column if not exists status       text not null default 'ativa',
  add column if not exists canceled_at  timestamptz,
  add column if not exists canceled_by  uuid references auth.users(id) on delete set null,
  add column if not exists cancel_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sales_status_check') then
    alter table public.sales
      add constraint sales_status_check check (status in ('ativa', 'cancelada'));
  end if;
end
$$;

-- Venda nova nasce sempre ativa e só em evento aberto.
drop policy if exists "sales_insert" on public.sales;
create policy "sales_insert" on public.sales
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'ativa'
    and exists (select 1 from public.events e where e.id = event_id and e.status = 'aberto')
  );

-- Ninguém edita venda direto; o operador não apaga mais (agora pede cancelamento).
drop policy if exists "sales_delete" on public.sales;
create policy "sales_delete" on public.sales
  for delete to authenticated using (public.is_admin());

-- 3) Pedidos de cancelamento ---------------------------------------------
create table if not exists public.cancel_requests (
  id            uuid primary key default gen_random_uuid(),
  sale_id       uuid not null references public.sales(id) on delete cascade,
  event_id      uuid not null references public.events(id) on delete cascade,
  requested_by  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reason        text not null check (length(trim(reason)) > 0),
  status        text not null default 'pendente' check (status in ('pendente', 'aprovada', 'negada')),
  decided_by    uuid references auth.users(id) on delete set null,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now()
);
create unique index if not exists cancel_requests_uma_pendente
  on public.cancel_requests (sale_id) where status = 'pendente';
create index if not exists cancel_requests_event_idx on public.cancel_requests (event_id, created_at);

-- O evento do pedido vem sempre da venda (o app não consegue mentir).
create or replace function public.cancel_requests_fill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select s.event_id into new.event_id from public.sales s where s.id = new.sale_id;
  if new.event_id is null then
    raise exception 'venda não encontrada' using errcode = 'P0002';
  end if;
  return new;
end
$$;
revoke execute on function public.cancel_requests_fill() from public, anon, authenticated;

drop trigger if exists cancel_requests_fill_trg on public.cancel_requests;
create trigger cancel_requests_fill_trg
  before insert on public.cancel_requests
  for each row execute function public.cancel_requests_fill();

alter table public.cancel_requests enable row level security;

drop policy if exists "cancel_select" on public.cancel_requests;
create policy "cancel_select" on public.cancel_requests
  for select to authenticated
  using (public.is_admin() or requested_by = auth.uid());

-- Operador só pede cancelamento de venda SUA, ainda ativa, em evento aberto.
drop policy if exists "cancel_insert" on public.cancel_requests;
create policy "cancel_insert" on public.cancel_requests
  for insert to authenticated
  with check (
    requested_by = auth.uid()
    and status = 'pendente'
    and decided_by is null
    and exists (
      select 1 from public.sales s join public.events e on e.id = s.event_id
      where s.id = sale_id and s.user_id = auth.uid() and s.status = 'ativa' and e.status = 'aberto'
    )
  );

-- Quem pediu pode retirar o pedido enquanto estiver pendente.
drop policy if exists "cancel_delete" on public.cancel_requests;
create policy "cancel_delete" on public.cancel_requests
  for delete to authenticated
  using (requested_by = auth.uid() and status = 'pendente');

-- Decisões do admin (só por aqui: ninguém atualiza venda nem pedido direto).
create or replace function public.decide_cancellation(p_request uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.cancel_requests;
begin
  if not public.is_admin() then
    raise exception 'apenas admin decide cancelamentos' using errcode = '42501';
  end if;
  select * into r from public.cancel_requests where id = p_request for update;
  if not found then raise exception 'pedido não encontrado' using errcode = 'P0002'; end if;
  if r.status <> 'pendente' then raise exception 'pedido já foi decidido'; end if;

  update public.cancel_requests
     set status = case when p_approve then 'aprovada' else 'negada' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = p_request;

  if p_approve then
    update public.sales
       set status = 'cancelada', canceled_at = now(), canceled_by = auth.uid(), cancel_reason = r.reason
     where id = r.sale_id and status = 'ativa';
  end if;
end
$$;

-- Admin cancela direto, sem pedido.
create or replace function public.cancel_sale(p_sale uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'apenas admin cancela vendas' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'informe o motivo do cancelamento';
  end if;
  update public.sales
     set status = 'cancelada', canceled_at = now(), canceled_by = auth.uid(), cancel_reason = trim(p_reason)
   where id = p_sale and status = 'ativa';
  if not found then raise exception 'venda não encontrada ou já cancelada' using errcode = 'P0002'; end if;
  update public.cancel_requests
     set status = 'aprovada', decided_by = auth.uid(), decided_at = now(), decision_note = 'Cancelada direto pelo admin'
   where sale_id = p_sale and status = 'pendente';
end
$$;

-- Admin desfaz um cancelamento (caso tenha sido engano).
create or replace function public.restore_sale(p_sale uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'apenas admin reativa vendas' using errcode = '42501';
  end if;
  update public.sales
     set status = 'ativa', canceled_at = null, canceled_by = null, cancel_reason = null
   where id = p_sale and status = 'cancelada';
  if not found then raise exception 'venda não encontrada ou não está cancelada' using errcode = 'P0002'; end if;
end
$$;

revoke execute on function public.decide_cancellation(uuid, boolean, text) from public, anon;
revoke execute on function public.cancel_sale(uuid, text)                  from public, anon;
revoke execute on function public.restore_sale(uuid)                       from public, anon;
grant  execute on function public.decide_cancellation(uuid, boolean, text) to authenticated;
grant  execute on function public.cancel_sale(uuid, text)                  to authenticated;
grant  execute on function public.restore_sale(uuid)                       to authenticated;

-- 4) Contas e transferências ---------------------------------------------
-- kind: 'banco' (conta bancária), 'caixa' (dinheiro do evento), 'outro'.
-- Cada evento ganha sozinho a sua conta "caixa" (ver gatilho mais abaixo).
create table if not exists public.accounts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(trim(name)) > 0),
  kind            text not null default 'banco' check (kind in ('banco', 'caixa', 'outro')),
  event_id        uuid references public.events(id) on delete cascade,
  opening_balance numeric(12,2) not null default 0,
  created_at      timestamptz not null default now()
);
create unique index if not exists accounts_um_caixa_por_evento
  on public.accounts (event_id) where kind = 'caixa' and event_id is not null;

-- Transferência: um lado pode ser nulo = "fora do sistema" (depósito, saque, Pix recebido...).
-- Transferência NÃO é receita nem gasto: só move dinheiro, o lucro do evento não muda.
create table if not exists public.transfers (
  id           uuid primary key default gen_random_uuid(),
  from_account uuid references public.accounts(id) on delete restrict,
  to_account   uuid references public.accounts(id) on delete restrict,
  amount       numeric(12,2) not null check (amount > 0),
  description  text,
  occurred_at  date not null default current_date,
  event_id     uuid references public.events(id) on delete set null,
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  check (from_account is not null or to_account is not null),
  check (from_account is distinct from to_account)
);
create index if not exists transfers_from_idx on public.transfers (from_account);
create index if not exists transfers_to_idx   on public.transfers (to_account);

-- Conta que recebe Pix/crédito/débito de cada evento (vazio = primeira conta bancária).
alter table public.events
  add column if not exists receipts_account_id uuid references public.accounts(id) on delete set null;
-- De qual conta saiu o dinheiro de um gasto (vazio = do bolso de alguém ou não informado).
alter table public.expenses
  add column if not exists account_id uuid references public.accounts(id) on delete set null;

-- Todo evento novo ganha a sua conta "caixa".
create or replace function public.events_create_cash_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.accounts (name, kind, event_id)
  values ('Caixa — ' || new.name, 'caixa', new.id)
  on conflict do nothing;
  return new;
end
$$;
revoke execute on function public.events_create_cash_account() from public, anon, authenticated;

drop trigger if exists events_create_cash_account_trg on public.events;
create trigger events_create_cash_account_trg
  after insert on public.events
  for each row execute function public.events_create_cash_account();

-- Dados que já existem: uma conta bancária e um caixa para cada evento.
insert into public.accounts (name, kind)
select 'Conta bancária', 'banco'
where not exists (select 1 from public.accounts where kind = 'banco' and event_id is null);

insert into public.accounts (name, kind, event_id)
select 'Caixa — ' || e.name, 'caixa', e.id
from public.events e
where not exists (select 1 from public.accounts a where a.kind = 'caixa' and a.event_id = e.id);

-- 5) Saldos ---------------------------------------------------------------
-- saldo = inicial + transferências que entraram − que saíram
--         + vendas (dinheiro → caixa do evento; Pix/crédito/débito → conta que recebe)
--         − gastos pagos com a conta. Venda cancelada não conta.
create or replace view public.account_balances
with (security_invoker = true) as
select q.*,
       (q.opening_balance + q.transfers_in - q.transfers_out + q.sales_in - q.expenses_out)::numeric(12,2) as balance
from (
  select
    a.id, a.name, a.kind, a.event_id, a.opening_balance, a.created_at,
    coalesce((select sum(t.amount) from public.transfers t where t.to_account = a.id), 0)::numeric(12,2)   as transfers_in,
    coalesce((select sum(t.amount) from public.transfers t where t.from_account = a.id), 0)::numeric(12,2) as transfers_out,
    coalesce((
      select sum(s.total)
      from public.sales s join public.events e on e.id = s.event_id
      where s.status = 'ativa' and (
        (s.payment = 'dinheiro' and a.kind = 'caixa' and a.event_id = s.event_id)
        or (s.payment <> 'dinheiro' and a.id = coalesce(
              e.receipts_account_id,
              (select b.id from public.accounts b where b.kind = 'banco' and b.event_id is null order by b.created_at, b.id limit 1)))
      )
    ), 0)::numeric(12,2) as sales_in,
    coalesce((select sum(x.amount) from public.expenses x where x.account_id = a.id), 0)::numeric(12,2)   as expenses_out
  from public.accounts a
) q;

-- Totais por evento: agora sem as vendas canceladas.
create or replace view public.event_totals
with (security_invoker = true) as
select
  e.id as event_id,
  e.name,
  e.event_date,
  e.status,
  e.created_at,
  coalesce((select sum(s.total) from public.sales s where s.event_id = e.id and s.status = 'ativa'), 0)::numeric(12,2) as revenue,
  coalesce((select count(*)     from public.sales s where s.event_id = e.id and s.status = 'ativa'), 0)::int            as sales_count,
  coalesce((select sum(x.amount) from public.expenses x where x.event_id = e.id), 0)::numeric(12,2) as expenses
from public.events e;

-- Reembolso: marca os gastos como reembolsados e, se informar a conta que pagou,
-- registra a saída de dinheiro (tudo ou nada).
create or replace function public.reimburse_expenses(p_ids uuid[], p_account uuid default null)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare total numeric(12,2); n int; who text; ev uuid;
begin
  if not public.is_admin() then
    raise exception 'apenas admin registra reembolsos' using errcode = '42501';
  end if;
  select coalesce(sum(x.amount), 0), count(*), string_agg(distinct x.paid_by, ', '), (array_agg(x.event_id))[1]
    into total, n, who, ev
    from public.expenses x
   where x.id = any(p_ids) and not x.reimbursed and x.paid_by is not null;
  if n = 0 then return 0; end if;

  update public.expenses set reimbursed = true
   where id = any(p_ids) and not reimbursed and paid_by is not null;

  if p_account is not null and total > 0 then
    insert into public.transfers (from_account, to_account, amount, description, event_id)
    values (p_account, null, total, 'Reembolso: ' || who, ev);
  end if;
  return total;
end
$$;
revoke execute on function public.reimburse_expenses(uuid[], uuid) from public, anon;
grant  execute on function public.reimburse_expenses(uuid[], uuid) to authenticated;

-- 6) Regras de acesso: contas e transferências são só do admin ---------
alter table public.accounts  enable row level security;
alter table public.transfers enable row level security;

drop policy if exists "accounts_all" on public.accounts;
create policy "accounts_all" on public.accounts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "transfers_all" on public.transfers;
create policy "transfers_all" on public.transfers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 7) Permissões -----------------------------------------------------------
revoke all on public.accounts         from anon;
revoke all on public.transfers        from anon;
revoke all on public.cancel_requests  from anon;
revoke all on public.account_balances from anon;

grant select, insert, update, delete on public.accounts        to authenticated;
grant select, insert, update, delete on public.transfers       to authenticated;
grant select, insert,         delete on public.cancel_requests to authenticated;
grant select                         on public.account_balances to authenticated;
grant select                         on public.event_totals     to authenticated;

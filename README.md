# Caixa EJC

Sistema de caixa e **controle financeiro de eventos** do EJC. Roda no navegador (celular ou
computador) e usa o **Supabase** como banco: eventos, cardápios, vendas, gastos e usuários ficam
num lugar só, compartilhados entre todos. **Precisa de internet** (wifi do local).

## Dois perfis, dois layouts

**Operador** (caixa): layout de celular com barra inferior.
- **Vender** no evento aberto (troco, dinheiro/Pix/crédito/débito, combos) e "Minhas vendas hoje".
- **Cancelar venda**: o operador pede o cancelamento (com motivo) e o **admin aprova ou nega**. Aprovado, ele pode "Refazer pedido".
- **Relatório** do evento, **Fechamento de caixa** e **Config** (tema, sair).

**Admin**: layout com **barra lateral** (no celular vira menu).
- **Visão geral**: receita, gastos, lucro, ticket médio, reembolsos pendentes e gráficos (receita × gastos × lucro, vendas por pagamento, vendas por horário, produtos mais vendidos, gastos por categoria, comparativo entre eventos).
- **Vender** e **Vendas** (relatório, fechamento, cancelar/reativar venda, exportar backup e CSV).
- **Cancelamentos**: fila de pedidos dos operadores (aprovar/negar com resposta) e histórico. O admin cancela direto, sem pedido.
- **Cardápio** do evento (produtos e combos; dá pra copiar o cardápio de outro evento).
- **Estoque e margem**: comprado, vendido, saldo, custo médio, margem e lucro bruto por produto.
- **Gastos**: estoque, decoração, estrutura, serviços e outros, com data, quem pagou do bolso e controle de reembolso. Exporta CSV.
- **Contas**: saldo bancário, caixa de cada evento e outras contas; **transferências** entre elas (ex.: banco → caixa do evento como fundo de troco), ajuste de saldo e histórico de movimentações.
- **Eventos**: cria, abre, encerra, renomeia e exclui eventos; mostra receita, gastos e lucro de cada um.
- **Configurações**: tema, conta e apagar as vendas do evento (exige digitar APAGAR).

### Como os eventos funcionam
- Todo produto, venda e gasto pertence a **um evento**.
- Só **um evento fica aberto** por vez, e é nele que os caixas vendem. O banco recusa venda em evento encerrado.
- O admin escolhe qual evento está olhando (seletor na barra lateral). Mudar de evento não afeta quem está vendendo.
- Abrir outro evento encerra o que estava aberto. Evento com vendas ou gastos não pode ser excluído.

### Formas de pagamento
Dinheiro, Pix, **Crédito** e **Débito** (vendas antigas "Cartão" continuam aparecendo como "Cartão (antigo)").

### Como as contas e os saldos funcionam
O saldo de cada conta é calculado pelo banco de dados a partir do que já é registrado:

`saldo = saldo inicial + transferências recebidas − enviadas + vendas − gastos pagos com a conta`

- **Vendas em dinheiro** entram no **caixa do evento** (cada evento ganha o seu automaticamente).
- **Pix, crédito e débito** entram na **conta que recebe** (padrão: a primeira conta bancária; dá pra trocar por evento em Eventos → Renomear).
- **Gastos**: em "Pago com" escolha a conta (debita o saldo) ou "do bolso de alguém" (entra nos reembolsos pendentes; ao reembolsar, escolha de qual conta saiu o dinheiro).
- **Transferência não é receita nem gasto**: só muda o dinheiro de lugar, então o lucro do evento não muda. O lado "Fora do sistema" serve pra depósito, saque, doação etc.
- **Venda cancelada** sai dos totais, do estoque e dos saldos, mas continua registrada (com motivo e quem cancelou).
- O app considera Pix e cartão recebidos na hora da venda (não calcula taxa da maquininha nem prazo de compensação). Use "Ajustar saldo" pra acertar com o extrato.

### Como o estoque é calculado
Não existe um cadastro separado de estoque. Ao registrar um **gasto da categoria Estoque** e ligá-lo a um
produto com a **quantidade comprada**, o app calcula sozinho:
- **Comprado** = soma das quantidades dos gastos ligados ao produto;
- **Vendido** = unidades nas vendas do evento (item de combo conta nos produtos que o compõem);
- **Saldo** = comprado − vendido (vermelho se vendeu mais do que o comprado registrado);
- **Custo unitário** = média paga por unidade; **margem** = preço − custo; o custo do combo é a soma dos itens.
Gastos de estoque sem produto (gelo, copos) entram no total de gastos, mas não na margem de cada produto.

## Configurando o Supabase

Ordem importante (rode no **SQL Editor**, uma vez cada):

1. `supabase/schema.sql` (perfis, produtos, vendas e regras de acesso).
2. `supabase/002_eventos_e_financeiro.sql` (eventos, gastos, regras novas).
   Quem já tem dados: os produtos e vendas existentes viram o evento **"Luau"** (renomeie em Eventos).
3. `supabase/003_pagamentos_cancelamentos_contas.sql` (crédito/débito, cancelamento com autorização, contas e transferências).
   Cria uma "Conta bancária" e um caixa para cada evento já existente.
4. Authentication → Sign In / Providers: desligue **Allow new users to sign up**.
5. Authentication → Users → Add user: e-mail `usuario@lual.app`, senha, **Auto Confirm User**. (No app a pessoa digita só `usuario`.)
6. Table Editor → `profiles`: ajuste `name` e marque `is_admin` de quem for admin.
7. No topo de `script.js`, confira `SUPABASE_URL` e `SUPABASE_KEY` (chave **publishable**).

> ⚠️ **Rode cada migração e publique a versão do app correspondente juntas.** A 002 exige evento em venda e produto; a 003 troca
> "cartão" por crédito/débito e o operador deixa de apagar venda direto (passa a pedir cancelamento). Uma versão antiga do app
> deixa de funcionar direito depois da migração nova.

> O projeto gratuito pausa após 1 semana sem uso: confira no painel antes do evento.

## Rodando e publicando
- Local: abra a pasta com o Live Server (ou outro servidor estático).
- Publicar: qualquer hospedagem estática (Netlify, GitHub Pages...). Publique a pasta inteira, **incluindo `vendor/`**.
- O nome no topo (`APP_NAME`) fica no começo do `script.js`.

## Estrutura
```
caixa-lual-src/
├── index.html                          → telas (operador e admin)
├── styles.css                          → visual, temas, layout, barra lateral
├── script.js                           → núcleo: login, dados, vendas, relatório, fechamento
├── admin.js                            → admin: eventos, gastos, estoque, gráficos, CSV
├── main.js                             → inicialização (carrega por último)
├── vendor/supabase.js                  → supabase-js 2.117.2
├── vendor/chart.umd.js                 → Chart.js 4.5.1
├── supabase/schema.sql                 → banco, parte 1
├── supabase/002_eventos_e_financeiro.sql → banco, parte 2 (eventos e gastos)
├── supabase/003_pagamentos_cancelamentos_contas.sql → banco, parte 3 (pagamentos, cancelamentos, contas)
├── ejc-logo.png
└── README.md
```

## Segurança
- A chave `publishable` é feita pra ficar no código. Quem protege os dados são as regras (RLS) do banco:
  sem login ninguém lê nem grava; só admin altera produtos, eventos e **vê gastos, contas e transferências**; operador só registra
  vendas (em evento aberto) e **pede** cancelamento das próprias (quem decide é o admin). Ninguém edita venda direto: o cancelamento
  passa por funções do banco que conferem se quem chama é admin.
- **Nunca** coloque no código a chave `secret` / `service_role`.
- As senhas ficam no Supabase Auth (com hash), não no código.

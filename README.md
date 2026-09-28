# Caixa Luau

App de caixa (PDV) para eventos do EJC. Roda no navegador (celular ou computador) e usa o
**Supabase** como banco: cardápio, usuários e vendas ficam num lugar só, compartilhados
entre todos os caixas. **Precisa de internet** (wifi do local).

## Funcionalidades

- **Login por usuário e senha**, com dois perfis: `admin` (produtos, apagar vendas) e `operador` (só vende e consulta).
- **Vender**: monta o pedido, escolhe Dinheiro/Pix/Cartão, calcula o troco. A venda vai direto pro banco.
- **Produtos e combos** (admin): cadastra uma vez e todos os caixas enxergam o cardápio.
- **Minhas vendas hoje** e **Desfazer última venda** (operador desfaz a própria venda até 10 min depois; admin, qualquer uma).
- **Relatório consolidado** de todos os caixas, por forma de pagamento, com filtro por caixa e por período ("hoje" vira às 5h, então evento que passa da meia-noite não quebra).
- **Fechamento de caixa**: confere o dinheiro da gaveta (fundo de troco + vendas em dinheiro).
- **Exportar backup** (JSON) e **apagar todas as vendas** (admin, exige digitar APAGAR).
- Tela de descanso com a logo, tema claro/escuro/automático.
- Os dados se atualizam sozinhos a cada 20 s (e ao voltar pro app ou reconectar). Se a conexão cair, aparece um aviso e a venda **não** é perdida em silêncio: o pedido continua na tela pra tentar de novo, sem duplicar.

## Configurando o Supabase (uma vez)

1. Crie um projeto no [Supabase](https://supabase.com).
2. No **SQL Editor**, cole e rode o conteúdo de `supabase/schema.sql`.
3. Em **Authentication → Sign In / Providers**, desligue **Allow new users to sign up**.
4. Em **Authentication → Users → Add user → Create new user**, crie cada pessoa com e-mail `usuario@lual.app`, uma senha e **Auto Confirm User** marcado. (No app a pessoa digita só `usuario`.)
5. Em **Table Editor → profiles**, ajuste `name` (nome que aparece no app e nos relatórios) e marque `is_admin` de quem for admin.
6. No topo de `script.js`, confira `SUPABASE_URL` e `SUPABASE_KEY` (chave **publishable**, começa com `sb_publishable_`).

Pra tirar alguém, apague o usuário em Authentication → Users.

> **Projeto gratuito pausa após 1 semana sem uso.** Antes do evento, abra o painel do Supabase e confira se está ativo (se estiver pausado, é só clicar em restaurar).

## Rodando e publicando

- Local: abra a pasta com o Live Server (ou qualquer servidor estático) e acesse `index.html`.
- Publicar: qualquer hospedagem estática (Netlify, GitHub Pages...). Publique a pasta inteira, **incluindo `vendor/`**.

## Estrutura

```
caixa-lual-src/
├── index.html         → estrutura das telas
├── styles.css         → visual (cores, temas, layout)
├── script.js          → lógica (login, vendas, combos, relatório, Supabase)
├── vendor/supabase.js → cliente oficial do Supabase (supabase-js 2.117.2)
├── supabase/schema.sql→ tabelas e regras de acesso do banco
├── ejc-logo.png       → logo da tela de descanso
└── README.md
```

Sem build, sem framework. Só a fonte "Plus Jakarta Sans" vem do Google Fonts (sem internet, cai pra fonte do sistema).

## Segurança

- A chave `publishable` é feita pra ficar no código do site. O que protege os dados são as regras de acesso (RLS) em `supabase/schema.sql`: sem login, ninguém lê nem grava; só admin altera produtos; operador só registra vendas e desfaz a própria nos 10 minutos seguintes.
- **Nunca** coloque no código a chave `secret` / `service_role`.
- As senhas ficam no Supabase Auth (com hash), não no código.
- Não há mais lista de usuários no código. Se uma versão antiga do repositório tinha senhas reais, elas continuam no histórico do Git: use senhas novas.

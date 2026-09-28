# Caixa Lual

App de caixa/PDV offline para eventos do EJC (lual, festas, bazares).

## Como usar

1. Abra o `index.html` em qualquer navegador (Chrome, Safari etc.), no celular ou no computador.
2. Não precisa instalar nada nem ter servidor. Mantenha todos os arquivos juntos na mesma pasta.
3. Depois de aberto, funciona **offline**: os dados ficam salvos no navegador daquele aparelho (localStorage).

## Funcionalidades

- **Tela de descanso** com a logo do EJC: aparece ao abrir e volta sozinha após 90s sem uso (não aparece com uma janela aberta, tipo no meio do fechamento).
- **Vender**: monta o pedido tocando nos produtos, escolhe Dinheiro/Pix/Cartão e calcula o troco.
- **Contador do caixa**: número de vendas e total deste caixa sempre visíveis na tela de venda.
- **Desfazer última venda**: apaga a última venda deste caixa, com opção de voltar o pedido pro carrinho pra corrigir.
- **Produtos e combos**: cadastro do cardápio. Combos juntam vários itens por um preço só e mostram quanto o cliente economiza.
- **Relatório**: total geral e por forma de pagamento, lista de vendas, filtro por caixa.
- **Fechamento de caixa**: resumo + conferência do dinheiro da gaveta (fundo de troco + vendas em dinheiro = esperado), mostrando se bateu, sobrou ou faltou.
- **Login por usuário** (opcional): cadastre a equipe direto no código (arquivo `script.js`, lista `USERS` no topo). Cada pessoa loga com usuário e senha próprios; quem é `admin: true` acessa Produtos, Config completo e pode apagar vendas/dados — quem é `admin: false` só vende e vê o relatório. Sem ninguém cadastrado, o app fica aberto (como antes).
- **Tema** claro, escuro ou automático.

## Cadastrando a equipe (login)

Abra `script.js` e edite a lista `USERS`, logo no topo do arquivo:

```js
var USERS = [
  { user: 'otavio', pass: 'suaSenha1', name: 'Otávio', admin: true },
  { user: 'maria',  pass: 'suaSenha2', name: 'Maria',  admin: false },
];
```

- `user` / `pass`: o que a pessoa digita pra entrar.
- `name`: aparece no topo do app e também vira o nome do caixa dela nos relatórios (não precisa mais digitar manualmente).
- `admin: true`: acessa Produtos, Config completo e pode apagar vendas/dados. `admin: false`: só vende e consulta o relatório.

Depois de editar, reimplante o site (arraste a pasta de novo no mesmo projeto do Netlify) pra valer pra todo mundo. Deixe `USERS = []` pra manter o app sem login, aberto pra qualquer um com o link.

**Atenção:** como é um site sem servidor, essa lista fica visível pra quem souber inspecionar o código da página (view-source). Serve como controle de acesso pra uso interno do evento, não como segurança de nível bancário. Evite reaproveitar senhas importantes nela.

## Vários caixas (vários celulares)

Cada aparelho roda separado, sem sincronizar em tempo real. No fim do evento:

1. Em cada caixa: Relatório → **Exportar dados** (baixa um `.json`).
2. Escolha um aparelho "consolidador" e mande os arquivos pra ele (WhatsApp, Bluetooth etc.).
3. Nele: Relatório → **Importar (consolidar)**, um arquivo por vez. Vendas repetidas são ignoradas.
4. O relatório passa a mostrar todos os caixas, com filtro individual.

## Estrutura

```
caixa-lual-src/
├── index.html    → estrutura das telas
├── styles.css    → visual (cores, temas, layout)
├── script.js     → lógica (vendas, combos, login/usuários, fechamento, exportar/importar)
├── ejc-logo.png  → logo da tela de descanso
└── README.md
```

Sem build, sem backend, sem framework. Só a fonte "Plus Jakarta Sans" vem do Google Fonts; sem internet, cai pra fonte padrão do sistema.

## Observações

- O login é uma trava contra acesso indevido, não é segurança de nível bancário (a lista de usuários fica no próprio código, ver seção acima).
- Limpar dados do navegador ou usar aba anônima faz a pessoa precisar logar de novo naquele aparelho — mas não apaga produtos/vendas de outros aparelhos, só o que estava salvo ali.

/* =========================================================
   Caixa EJC — área do admin
   Barra lateral, eventos, gastos, estoque/margem e gráficos.
   Depende do script.js (state, sb, safe, h, fmtMoney...).
   ========================================================= */

var EXPENSE_CATEGORIES = [
  { id: 'estoque',   label: 'Estoque (compras pra vender)', short: 'Estoque' },
  { id: 'decoracao', label: 'Decoração',                    short: 'Decoração' },
  { id: 'estrutura', label: 'Estrutura / aluguel',          short: 'Estrutura' },
  { id: 'servicos',  label: 'Serviços',                     short: 'Serviços' },
  { id: 'outros',    label: 'Outros',                       short: 'Outros' }
];
function catShort(id) {
  var c = EXPENSE_CATEGORIES.filter(function (x) { return x.id === id; })[0];
  return c ? c.short : (id || 'Outros');
}

/* ---------- Utils do admin ---------- */
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
/* Recarrega agora, esperando uma busca em andamento terminar. */
async function reloadNow() {
  var n = 0;
  while (state.loading && n++ < 100) await sleep(50);
  return loadAll(false);
}
function todayISO() {
  var d = new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function fmtDate(iso) {
  if (!iso) return '';
  var p = String(iso).slice(0, 10).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
}
function fmtNum(n) {
  var v = round2(n);
  return (Math.abs(v - Math.round(v)) < 0.005 ? String(Math.round(v)) : String(v).replace('.', ','));
}
function pct(n) { return (Math.round(n * 1000) / 10).toString().replace('.', ',') + '%'; }
function sum(arr, fn) { return arr.reduce(function (s, x) { return s + (fn ? fn(x) : x); }, 0); }
function statusPill(st) { return h('span', { className: 'status-pill ' + st, text: statusLabel(st) }); }

/* ---------- Barra lateral ---------- */
function toggleSidebar(open) {
  var side = el('sidebar'), ov = el('sbOverlay');
  var want = (open === undefined) ? !side.classList.contains('open') : !!open;
  side.classList.toggle('open', want);
  ov.classList.toggle('show', want);
}

function renderEventSelect() {
  var sel = el('eventSelect');
  if (!sel) return;
  sel.innerHTML = '';
  if (!state.events.length) sel.appendChild(h('option', { value: '' }, 'Nenhum evento'));
  state.events.slice().reverse().forEach(function (e) {
    sel.appendChild(h('option', { value: e.id }, e.name));
  });
  if (state.event) sel.value = state.event.id;
  var pill = el('eventStatusPill');
  pill.textContent = state.event ? statusLabel(state.event.status) : '';
  pill.className = 'status-pill ' + (state.event ? state.event.status : '');
}

async function selecionarEvento(id) {
  if (!id || (state.event && state.event.id === id)) return;
  lsSet(KEYS.eventId, id);
  state.mutations++;                       // descarta resposta de busca em andamento
  state.event = state.events.filter(function (e) { return e.id === id; })[0] || state.event;
  state.products = []; state.sales = []; state.expenses = []; state.loaded = false;
  state.cart = []; state.pendingSale = null; state.editingId = null; state.comboDraft = [];
  limparPagamento(); renderCart();
  renderAll();
  await reloadNow();
}

function renderAdminView(v) {
  if (!isAdmin()) return;
  var ev = state.event;
  var sub = ev ? ev.name + ' · ' + statusLabel(ev.status) : 'Sem evento';
  ['dashSub', 'cardapioSub', 'estoqueSub', 'gastosSub', 'vendasSub', 'contasSub', 'cancelSub'].forEach(function (id) {
    if (el(id)) el(id).textContent = sub;
  });
  if (v === 'dashboard') renderDashboard();
  if (v === 'estoque') renderStock();
  if (v === 'gastos') { renderExpenseForm(); renderExpenses(); }
  if (v === 'eventos') renderEvents();
  if (v === 'contas') renderContas();
  if (v === 'cancelamentos') renderCancelamentos();
}

/* ---------- Eventos ---------- */
function eventTotalsFor(id) {
  var t = state.totals.filter(function (x) { return x.eventId === id; })[0];
  if (t) return t;
  if (state.event && state.event.id === id) {
    var rev = sum(activeSales(), function (s) { return s.total; });
    return { revenue: round2(rev), expenses: round2(sum(state.expenses, function (x) { return x.amount; })), salesCount: state.sales.length };
  }
  return { revenue: 0, expenses: 0, salesCount: 0 };
}

function renderEvents() {
  var list = el('eventList');
  list.innerHTML = '';
  if (!state.events.length) {
    list.appendChild(h('div', { className: 'empty-hint', text: 'Nenhum evento ainda. Crie o primeiro acima.' }));
    return;
  }
  state.events.slice().reverse().forEach(function (e) {
    var t = eventTotalsFor(e.id);
    var profit = round2(t.revenue - t.expenses);
    var isCurrent = state.event && state.event.id === e.id;
    var canDelete = t.salesCount === 0 && t.expenses === 0;
    list.appendChild(h('div', { className: 'event-card' + (isCurrent ? ' current' : '') },
      h('div', { className: 'ec-head' },
        h('div', null,
          h('div', { className: 'ec-name', text: e.name }),
          h('div', { className: 'ec-meta', text: (e.date ? fmtDate(e.date) + ' · ' : '') + t.salesCount + ' venda(s)' })
        ),
        statusPill(e.status)
      ),
      h('div', { className: 'ec-kpis' },
        h('div', null, h('span', { className: 'ec-k', text: 'Receita' }), h('b', { text: fmtMoney(t.revenue) })),
        h('div', null, h('span', { className: 'ec-k', text: 'Gastos' }), h('b', { text: fmtMoney(t.expenses) })),
        h('div', null, h('span', { className: 'ec-k', text: 'Lucro' }), h('b', { className: profit < 0 ? 'neg' : 'pos', text: fmtMoney(profit) }))
      ),
      h('div', { className: 'ec-actions' },
        isCurrent ? h('span', { className: 'ec-current', text: '● Em exibição' })
                  : h('button', { className: 'btn-secondary btn-small', type: 'button', onclick: function () { selecionarEvento(e.id); showToast('Exibindo "' + e.name + '"'); } }, 'Ver este evento'),
        e.status !== 'aberto' ? h('button', { className: 'btn-secondary btn-small', type: 'button', onclick: function () { abrirEvento(e.id); } }, 'Abrir pra vender') : null,
        e.status === 'aberto' ? h('button', { className: 'btn-secondary btn-small', type: 'button', onclick: function () { encerrarEvento(e.id); } }, 'Encerrar') : null,
        h('button', { className: 'btn-secondary btn-small', type: 'button', onclick: function () { editarEvento(e.id); } }, 'Renomear'),
        canDelete ? h('button', { className: 'btn-secondary btn-small btn-danger', type: 'button', onclick: function () { excluirEvento(e.id); } }, 'Excluir') : null
      )
    ));
  });
}

async function criarEvento() {
  var nome = el('evNome').value.trim();
  var data = el('evData').value || null;
  if (!nome) { showToast('Digite o nome do evento'); return; }
  el('criarEventoBtn').disabled = true;
  var r = await safe(function () { return sb.from('events').insert({ name: nome, event_date: data }).select(); });
  el('criarEventoBtn').disabled = false;
  if (r.error) { showToast(friendlyError(r.error)); return; }
  if (!r.data || !r.data.length) { showToast('Não foi possível criar o evento.'); return; }
  var ev = mapEvent(r.data[0]);
  state.mutations++;
  state.events.push(ev);
  el('evNome').value = ''; el('evData').value = '';
  showToast('Evento criado. Agora monte o cardápio dele.');
  await selecionarEvento(ev.id);
}

function abrirEvento(id) {
  var ev = state.events.filter(function (e) { return e.id === id; })[0];
  if (!ev) return;
  var other = state.events.filter(function (e) { return e.status === 'aberto' && e.id !== id; })[0];
  confirmModal({
    icon: '🎪', title: 'Abrir "' + ev.name + '" pra vender?',
    text: other
      ? 'Só um evento fica aberto por vez. "' + other.name + '" será encerrado e os caixas passam a vender em "' + ev.name + '".'
      : 'Os caixas passam a vender neste evento assim que abrirem o app.',
    confirmLabel: 'Abrir evento',
    onConfirm: async function () {
      var r = await safe(function () { return sb.rpc('open_event', { p_event: id }); });
      if (r.error) { showToast(friendlyError(r.error)); return; }
      state.mutations++;
      showToast('Evento aberto');
      await selecionarEventoForce(id);
    }
  });
}
/* Seleciona o evento mesmo que já seja o atual (só pra recarregar o status). */
async function selecionarEventoForce(id) {
  lsSet(KEYS.eventId, id);
  state.mutations++;
  await reloadNow();
}

function encerrarEvento(id) {
  var ev = state.events.filter(function (e) { return e.id === id; })[0];
  if (!ev) return;
  confirmModal({
    icon: '🏁', title: 'Encerrar "' + ev.name + '"?',
    text: 'Os caixas não conseguem mais vender nele. Dá pra reabrir depois, se precisar.',
    confirmLabel: 'Encerrar evento',
    onConfirm: async function () {
      var r = await safe(function () { return sb.from('events').update({ status: 'encerrado' }).eq('id', id).select(); });
      if (r.error) { showToast(friendlyError(r.error)); return; }
      if (!r.data || !r.data.length) { showToast('Não foi possível encerrar (sem permissão).'); return; }
      state.mutations++;
      showToast('Evento encerrado');
      await reloadNow();
    }
  });
}

function editarEvento(id) {
  var ev = state.events.filter(function (e) { return e.id === id; })[0];
  if (!ev) return;
  var nome = h('input', { type: 'text', value: ev.name });
  var data = h('input', { type: 'date' });
  data.value = ev.date || '';
  var recv = h('select', null, h('option', { value: '' }, 'Padrão (primeira conta bancária)'));
  state.balances.filter(function (a) { return a.kind !== 'caixa'; }).forEach(function (a) {
    recv.appendChild(h('option', { value: a.id }, a.name));
  });
  recv.value = ev.receiptsAccountId || '';
  openModal(h('div', null,
    h('div', { className: 'modal-icon' }, '✏️'),
    h('h3', { className: 'modal-title', text: 'Editar evento' }),
    h('div', { className: 'form-row' }, h('label', { text: 'Nome' }), nome),
    h('div', { className: 'form-row' }, h('label', { text: 'Data' }), data),
    h('div', { className: 'form-row' }, h('label', { text: 'Conta que recebe Pix, crédito e débito' }), recv),
    h('div', { className: 'modal-actions' },
      h('button', {
        className: 'btn-primary', type: 'button', onclick: async function () {
          var n = nome.value.trim();
          if (!n) { showToast('Digite o nome'); return; }
          var r = await safe(function () { return sb.from('events').update({ name: n, event_date: data.value || null, receipts_account_id: recv.value || null }).eq('id', id).select(); });
          if (r.error) { showToast(friendlyError(r.error)); return; }
          closeModal(); state.mutations++; showToast('Evento atualizado'); await reloadNow();
        }
      }, 'Salvar'),
      h('button', { className: 'modal-cancel', type: 'button', onclick: closeModal }, 'Cancelar')
    )
  ));
}

function excluirEvento(id) {
  var ev = state.events.filter(function (e) { return e.id === id; })[0];
  if (!ev) return;
  confirmModal({
    icon: '🗑️', title: 'Excluir "' + ev.name + '"?',
    text: 'O cardápio dele também é apagado. Só dá pra excluir eventos sem vendas e sem gastos.',
    confirmLabel: 'Excluir', danger: true,
    onConfirm: async function () {
      var r = await safe(function () { return sb.from('events').delete().eq('id', id).select(); });
      if (r.error) {
        showToast(r.error.code === '23503' ? 'Esse evento tem vendas ou gastos, então não pode ser excluído.' : friendlyError(r.error));
        return;
      }
      if (!r.data || !r.data.length) { showToast('Não foi possível excluir (sem permissão).'); return; }
      if (lsGet(KEYS.eventId, '') === id) lsDel(KEYS.eventId);
      state.mutations++;
      showToast('Evento excluído');
      await reloadNow();
    }
  });
}

/* ---------- Copiar cardápio de outro evento ---------- */
function abrirCopiarCardapio() {
  if (!state.event) { showToast('Crie ou selecione um evento primeiro.'); return; }
  var others = state.events.filter(function (e) { return e.id !== state.event.id; });
  if (!others.length) { showToast('Não há outro evento pra copiar.'); return; }
  var sel = h('select', null, others.slice().reverse().map(function (e) { return h('option', { value: e.id }, e.name); }));
  openModal(h('div', null,
    h('div', { className: 'modal-icon' }, '📋'),
    h('h3', { className: 'modal-title', text: 'Copiar cardápio' }),
    h('p', { className: 'modal-sub', text: 'Copia produtos e combos (com preços) pra "' + state.event.name + '".' + (state.products.length ? ' Os que já existem aqui são mantidos, então pode ficar item repetido.' : '') }),
    h('div', { className: 'form-row' }, h('label', { text: 'Copiar de' }), sel),
    h('div', { className: 'modal-actions' },
      h('button', { className: 'btn-primary', type: 'button', onclick: function () { closeModal(); copiarCardapio(sel.value); } }, 'Copiar'),
      h('button', { className: 'modal-cancel', type: 'button', onclick: closeModal }, 'Cancelar')
    )
  ));
}

async function copiarCardapio(srcId) {
  var src = await fetchAll('products', 'created_at', srcId);
  if (src.error) { showToast(friendlyError(src.error)); return; }
  if (!src.data.length) { showToast('O evento escolhido não tem cardápio.'); return; }
  var evId = state.event.id;
  var singles = src.data.filter(function (r) { return !r.is_combo; });
  var combos = src.data.filter(function (r) { return r.is_combo; });
  var idMap = {};

  if (singles.length) {
    var ins = await safe(function () {
      return sb.from('products').insert(singles.map(function (r) {
        return { event_id: evId, name: r.name, price: r.price, category: r.category, is_combo: false, components: [] };
      })).select();
    });
    if (ins.error) { showToast(friendlyError(ins.error)); return; }
    singles.forEach(function (old, i) {
      var nw = ins.data[i] && ins.data[i].name === old.name ? ins.data[i]
        : ins.data.filter(function (x) { return x.name === old.name; })[0];
      if (nw) idMap[old.id] = nw.id;
    });
  }
  if (combos.length) {
    var ins2 = await safe(function () {
      return sb.from('products').insert(combos.map(function (r) {
        var comps = (r.components || []).filter(function (c) { return idMap[c.productId]; })
          .map(function (c) { return { productId: idMap[c.productId], name: c.name, qty: c.qty }; });
        return { event_id: evId, name: r.name, price: r.price, category: r.category, is_combo: true, components: comps };
      })).select();
    });
    if (ins2.error) { showToast(friendlyError(ins2.error)); return; }
  }
  state.mutations++;
  showToast(src.data.length + ' produto(s) copiado(s)');
  await reloadNow();
}

/* ---------- Gastos ---------- */
var editingExpenseId = null;

function renderExpenseForm() {
  var catSel = el('expCategoria');
  if (!catSel.options.length) {
    EXPENSE_CATEGORIES.forEach(function (c) { catSel.appendChild(h('option', { value: c.id }, c.label)); });
    var f = el('expFiltroCat');
    f.appendChild(h('option', { value: '' }, 'Todas as categorias'));
    EXPENSE_CATEGORIES.forEach(function (c) { f.appendChild(h('option', { value: c.id }, c.short)); });
  }
  var isStock = catSel.value === 'estoque';
  el('expStockRow').style.display = isStock ? '' : 'none';

  var ps = el('expProduto');
  var prev = ps.value;
  ps.innerHTML = '';
  ps.appendChild(h('option', { value: '' }, 'Nenhum (insumo geral: gelo, copos...)'));
  state.products.filter(function (p) { return !p.isCombo; }).forEach(function (p) {
    ps.appendChild(h('option', { value: p.id }, p.name));
  });
  if (prev) ps.value = prev;
  if (!el('expData').value) el('expData').value = todayISO();

  /* Pago com: bolso de alguém (reembolsa depois) ou uma conta (debita o saldo) */
  var pc = el('expPagoCom');
  var prevPc = pc.value;
  fillSelect(pc, [{ value: '', label: 'Do bolso de alguém (reembolsar depois)' }].concat(
    accountChoices().map(function (a) { return { value: a.id, label: accountLabel(a) }; })), prevPc);
  var bolso = pc.value === '';
  el('expBolsoRow').style.display = bolso ? '' : 'none';
  el('expReembRow').style.display = bolso ? '' : 'none';
}

function resetExpenseForm() {
  editingExpenseId = null;
  el('expDescricao').value = ''; el('expValor').value = ''; el('expQtd').value = '';
  el('expPagoPor').value = ''; el('expReembolsado').checked = false;
  el('expData').value = todayISO();
  el('expProduto').value = '';
  el('expPagoCom').value = '';
  el('salvarGastoBtn').textContent = 'Registrar gasto';
  el('expFormTitle').textContent = 'Novo gasto';
  el('cancelGastoBtn').style.display = 'none';
  renderExpenseForm();
}

async function salvarGasto() {
  if (!isAdmin() || state.saving) return;
  if (!state.event) { showToast('Crie ou selecione um evento primeiro.'); return; }
  var cat = el('expCategoria').value;
  var desc = el('expDescricao').value.trim();
  var valor = round2(parseMoney(el('expValor').value));
  var isStock = cat === 'estoque';
  var prod = isStock ? el('expProduto').value : '';
  var qtd = parseMoney(el('expQtd').value);
  if (!desc) { showToast('Descreva o gasto'); return; }
  if (!(valor > 0)) { showToast('Digite o valor do gasto'); return; }
  if (prod && !(qtd > 0)) { showToast('Informe a quantidade comprada desse produto'); return; }
  var conta = el('expPagoCom').value;
  var quem = el('expPagoPor').value.trim();
  if (!conta && !quem) { showToast('Informe quem pagou do bolso ou escolha a conta'); return; }

  var row = {
    event_id: state.event.id, category: cat, description: desc, amount: valor,
    product_id: prod || null, qty: prod ? qtd : null,
    account_id: conta || null,
    paid_by: conta ? null : quem,
    paid_at: el('expData').value || todayISO(),
    reimbursed: conta ? false : el('expReembolsado').checked
  };
  var editing = editingExpenseId;
  state.saving = true;
  el('salvarGastoBtn').disabled = true;
  var r = await safe(function () {
    return editing ? sb.from('expenses').update(row).eq('id', editing).select() : sb.from('expenses').insert(row).select();
  });
  state.saving = false;
  el('salvarGastoBtn').disabled = false;
  if (r.error) { showToast(friendlyError(r.error)); return; }
  if (!r.data || !r.data.length) { showToast('Não foi possível salvar (sem permissão ou gasto removido).'); return; }
  state.mutations++;
  var saved = mapExpense(r.data[0]);
  if (editing) state.expenses = state.expenses.map(function (x) { return x.id === editing ? saved : x; });
  else state.expenses.push(saved);
  showToast(editing ? 'Gasto atualizado' : 'Gasto registrado: ' + fmtMoney(saved.amount));
  resetExpenseForm();
  renderExpenses();
  loadAll(true);                       // atualiza os saldos das contas
}

function editarGasto(id) {
  var x = state.expenses.filter(function (e) { return e.id === id; })[0];
  if (!x) return;
  editingExpenseId = id;
  el('expCategoria').value = x.category;
  renderExpenseForm();
  el('expDescricao').value = x.description;
  el('expValor').value = String(x.amount).replace('.', ',');
  el('expProduto').value = x.productId || '';
  el('expQtd').value = x.qty ? String(x.qty).replace('.', ',') : '';
  el('expData').value = x.paidAt;
  el('expPagoCom').value = x.accountId || '';
  renderExpenseForm();
  el('expPagoPor').value = x.paidBy;
  el('expReembolsado').checked = x.reimbursed;
  el('salvarGastoBtn').textContent = 'Salvar alteração';
  el('expFormTitle').textContent = 'Editando gasto';
  el('cancelGastoBtn').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function excluirGasto(id) {
  var x = state.expenses.filter(function (e) { return e.id === id; })[0];
  if (!x) return;
  confirmModal({
    icon: '🗑️', title: 'Excluir este gasto?',
    text: x.description + ' · ' + fmtMoney(x.amount),
    confirmLabel: 'Excluir', danger: true,
    onConfirm: async function () {
      var r = await safe(function () { return sb.from('expenses').delete().eq('id', id).select(); });
      if (r.error) { showToast(friendlyError(r.error)); return; }
      if (!r.data || !r.data.length) { showToast('Não foi possível excluir (sem permissão).'); return; }
      state.mutations++;
      state.expenses = state.expenses.filter(function (e) { return e.id !== id; });
      if (editingExpenseId === id) resetExpenseForm();
      renderExpenses();
      showToast('Gasto excluído');
      loadAll(true);
    }
  });
}

function marcarReembolsado(ids, who, total) {
  var banco = state.balances.filter(function (a) { return a.kind === 'banco'; })[0];
  var sel = h('select', null);
  fillSelect(sel, [{ value: '', label: 'Não registrar movimentação de conta' }].concat(
    accountChoices().map(function (a) { return { value: a.id, label: accountLabel(a) + ' (saldo ' + fmtMoney(a.balance) + ')' }; })), banco ? banco.id : '');
  openModal(h('div', null,
    h('div', { className: 'modal-icon' }, '💸'),
    h('h3', { className: 'modal-title', text: 'Reembolsar ' + who }),
    h('p', { className: 'modal-sub', text: fmtMoney(total) + ' em ' + ids.length + ' gasto(s). De qual conta saiu o dinheiro? Isso tira o valor do saldo da conta, mas não vira um gasto novo.' }),
    h('div', { className: 'form-row' }, h('label', { text: 'Pago pela conta' }), sel),
    h('div', { className: 'modal-actions' },
      h('button', {
        className: 'btn-primary', type: 'button', onclick: async function () {
          var r = await safe(function () { return sb.rpc('reimburse_expenses', { p_ids: ids, p_account: sel.value || null }); });
          if (r.error) { showToast(friendlyError(r.error)); return; }
          closeModal(); state.mutations++;
          showToast('Reembolso registrado');
          await reloadNow();
        }
      }, 'Registrar reembolso'),
      h('button', { className: 'modal-cancel', type: 'button', onclick: closeModal }, 'Cancelar')
    )
  ));
}

function pendingReimbursements() {
  var byPerson = {};
  state.expenses.forEach(function (x) {
    if (x.paidBy && !x.reimbursed) {
      var k = x.paidBy.trim();
      byPerson[k] = byPerson[k] || { who: k, total: 0, ids: [] };
      byPerson[k].total += x.amount;
      byPerson[k].ids.push(x.id);
    }
  });
  return Object.keys(byPerson).map(function (k) { byPerson[k].total = round2(byPerson[k].total); return byPerson[k]; });
}

function renderExpenses() {
  renderExpenseList();
  var total = round2(sum(state.expenses, function (x) { return x.amount; }));
  var pend = pendingReimbursements();
  var pendTotal = round2(sum(pend, function (p) { return p.total; }));
  var k = el('expKpis');
  k.innerHTML = '';
  k.appendChild(kpi('Total gasto', fmtMoney(total), state.expenses.length + ' lançamento(s)'));
  var stock = round2(sum(state.expenses.filter(function (x) { return x.category === 'estoque'; }), function (x) { return x.amount; }));
  k.appendChild(kpi('Estoque', fmtMoney(stock), total ? pct(stock / total) + ' do total' : ''));
  k.appendChild(kpi('A reembolsar', fmtMoney(pendTotal), pend.length ? pend.length + ' pessoa(s)' : 'nada pendente', pendTotal > 0 ? 'warn' : ''));

  var rl = el('reimbList');
  rl.innerHTML = '';
  if (!pend.length) rl.appendChild(h('div', { className: 'empty-hint', text: 'Nenhum reembolso pendente. (Só entra aqui o gasto com "Quem pagou" preenchido e sem a caixinha de reembolsado.)' }));
  pend.forEach(function (p) {
    rl.appendChild(h('div', { className: 'reimb-row' },
      h('div', null, h('b', { text: p.who }), h('div', { className: 'ec-meta', text: p.ids.length + ' gasto(s)' })),
      h('div', { className: 'reimb-right' },
        h('b', { text: fmtMoney(p.total) }),
        h('button', { className: 'btn-secondary btn-small', type: 'button', onclick: function () { marcarReembolsado(p.ids, p.who, p.total); } }, 'Reembolsar')
      )
    ));
  });
}

function renderExpenseList() {
  var list = el('expenseList');
  list.innerHTML = '';
  var cat = el('expFiltroCat').value;
  var rows = state.expenses.filter(function (x) { return !cat || x.category === cat; })
    .sort(function (a, b) { return a.paidAt < b.paidAt ? 1 : (a.paidAt > b.paidAt ? -1 : (a.createdAt < b.createdAt ? 1 : -1)); });
  el('noExpensesHint').style.display = rows.length ? 'none' : 'block';
  rows.forEach(function (x) {
    var prod = x.productId ? state.products.filter(function (p) { return p.id === x.productId; })[0] : null;
    var acc = x.accountId ? state.balances.filter(function (a) { return a.id === x.accountId; })[0] : null;
    var meta = fmtDate(x.paidAt) + (acc ? ' · pago com ' + accountLabel(acc) : (x.paidBy ? ' · pago por ' + x.paidBy + (x.reimbursed ? ' (reembolsado)' : ' (a reembolsar)') : ' · sem conta informada'));
    list.appendChild(h('div', { className: 'expense-row' },
      h('div', { className: 'er-main' },
        h('div', { className: 'er-title' }, x.description, h('span', { className: 'cat-pill', text: catShort(x.category) })),
        h('div', { className: 'er-meta', text: meta }),
        x.qty ? h('div', { className: 'er-meta', text: fmtNum(x.qty) + ' un' + (prod ? ' de ' + prod.name + ' · ' + fmtMoney(x.amount / x.qty) + ' cada' : '') }) : null
      ),
      h('div', { className: 'er-right' },
        h('b', { text: fmtMoney(x.amount) }),
        h('div', { className: 'pi-actions' },
          h('button', { type: 'button', 'aria-label': 'Editar', onclick: function () { editarGasto(x.id); } }, '✏️'),
          h('button', { type: 'button', className: 'danger', 'aria-label': 'Excluir', onclick: function () { excluirGasto(x.id); } }, '🗑️')
        )
      )
    ));
  });
}

/* ---------- Estoque e margem ---------- */
/* Comprado = soma das quantidades dos gastos de estoque ligados ao produto.
   Vendido  = unidades nas vendas do evento (combo conta nos itens que o compõem).
   Custo un. = média do que foi pago por unidade comprada. */
function computeStock() {
  var rows = {};
  state.products.forEach(function (p) {
    rows[p.id] = { product: p, bought: 0, spent: 0, sold: 0, direct: 0, revenue: 0, unitCost: null };
  });
  state.expenses.forEach(function (x) {
    var r = x.productId && x.qty ? rows[x.productId] : null;
    if (r) { r.bought += x.qty; r.spent += x.amount; }
  });
  Object.keys(rows).forEach(function (id) {
    var r = rows[id];
    r.unitCost = r.bought > 0 ? r.spent / r.bought : null;
  });
  activeSales().forEach(function (s) {
    s.items.forEach(function (it) {
      var own = rows[it.productId];
      /* direct = unidades vendidas como o próprio item (base do lucro bruto);
         sold   = unidades que saíram do estoque, inclusive dentro de combos. */
      if (own) { own.revenue += it.price * it.qty; own.direct += it.qty; if (it.isCombo) own.sold += it.qty; }
      if (it.isCombo) {
        (it.components || []).forEach(function (c) {
          var r = rows[c.productId];
          if (r) r.sold += c.qty * it.qty;
        });
      } else if (own) {
        own.sold += it.qty;
      }
    });
  });
  /* custo do combo = soma do custo dos itens que o compõem */
  Object.keys(rows).forEach(function (id) {
    var r = rows[id];
    if (!r.product.isCombo) return;
    var comps = r.product.components || [];
    var cost = 0, ok = comps.length > 0;
    comps.forEach(function (c) {
      var cr = rows[c.productId];
      if (cr && cr.unitCost !== null) cost += cr.unitCost * c.qty; else ok = false;
    });
    r.unitCost = ok ? cost : null;
  });
  return Object.keys(rows).map(function (id) { return rows[id]; });
}

function renderStock() {
  var table = el('stockTable');
  table.innerHTML = '';
  var hint = el('noStockHint');
  if (!state.event) { hint.style.display = 'block'; hint.textContent = 'Crie um evento pra começar.'; return; }
  var rows = computeStock();
  if (!rows.length) { hint.style.display = 'block'; hint.textContent = 'Cadastre o cardápio deste evento (aba Cardápio) e registre as compras de estoque em Gastos.'; return; }
  hint.style.display = 'none';

  table.appendChild(h('thead', null, h('tr', null,
    ['Produto', 'Comprado', 'Vendido', 'Saldo', 'Custo un.', 'Preço', 'Margem un.', 'Lucro bruto'].map(function (t, i) {
      return h('th', { className: i ? 'num' : '', text: t });
    })
  )));
  var tbody = h('tbody');
  var totalProfit = 0, anyProfit = false;
  rows.forEach(function (r) {
    var p = r.product;
    var hasCost = r.unitCost !== null;
    var saldo = p.isCombo ? null : (r.bought > 0 ? r.bought - r.sold : null);
    var saldoCls = '';
    if (saldo !== null) saldoCls = saldo < 0 ? 'neg' : (saldo === 0 || saldo / r.bought <= 0.15 ? 'warn' : 'pos');
    var margin = hasCost ? p.price - r.unitCost : null;
    var profit = hasCost ? r.revenue - r.direct * r.unitCost : null;
    if (profit !== null) { totalProfit += profit; anyProfit = true; }
    tbody.appendChild(h('tr', null,
      h('td', null, p.name, p.isCombo ? h('span', { className: 'combo-badge inline', text: 'Combo' }) : null),
      h('td', { className: 'num', text: p.isCombo ? '—' : (r.bought > 0 ? fmtNum(r.bought) : '—') }),
      h('td', { className: 'num', text: fmtNum(r.sold) }),
      h('td', { className: 'num ' + saldoCls, text: saldo === null ? '—' : fmtNum(saldo), title: saldo !== null && saldo < 0 ? 'Vendeu mais do que o comprado registrado: confira os gastos de estoque.' : '' }),
      h('td', { className: 'num', text: hasCost ? fmtMoney(r.unitCost) : '—' }),
      h('td', { className: 'num', text: fmtMoney(p.price) }),
      h('td', { className: 'num ' + (margin !== null && margin < 0 ? 'neg' : ''), text: margin === null ? '—' : fmtMoney(margin) + ' (' + pct(margin / p.price) + ')' }),
      h('td', { className: 'num ' + (profit !== null && profit < 0 ? 'neg' : ''), text: profit === null ? '—' : fmtMoney(profit) })
    ));
  });
  table.appendChild(tbody);
  if (anyProfit) {
    table.appendChild(h('tfoot', null, h('tr', null,
      h('td', { colSpan: 7, text: 'Lucro bruto dos produtos com custo informado' }),
      h('td', { className: 'num', text: fmtMoney(totalProfit) })
    )));
  }
  var general = round2(sum(state.expenses.filter(function (x) { return x.category === 'estoque' && !x.productId; }), function (x) { return x.amount; }));
  if (general > 0) {
    hint.style.display = 'block';
    hint.textContent = 'Insumos gerais sem produto (gelo, copos...): ' + fmtMoney(general) + '. Esse valor entra no total de gastos, mas não na margem de cada produto.';
  }
}

/* ---------- Visão geral (KPIs e gráficos) ---------- */
function kpi(label, value, sub, cls) {
  return h('div', { className: 'kpi' + (cls ? ' ' + cls : '') },
    h('div', { className: 'kpi-label', text: label }),
    h('div', { className: 'kpi-value', text: value }),
    sub ? h('div', { className: 'kpi-sub', text: sub }) : null
  );
}

var charts = {};
function chartColors() {
  var cs = getComputedStyle(document.documentElement);
  function v(n) { return cs.getPropertyValue(n).trim(); }
  return {
    accent: v('--accent-solid'), success: v('--success'), pix: v('--pix'), cartao: v('--cartao'), debito: v('--debito'),
    danger: v('--danger'), text: v('--text-secondary'), grid: v('--border-c'), card: v('--bg-card')
  };
}
function setChartEmpty(id, empty) {
  var box = el(id).parentNode;
  box.classList.toggle('empty', !!empty);
  if (empty && charts[id]) { charts[id].destroy(); delete charts[id]; }
}
function drawChart(id, config, empty) {
  if (typeof Chart === 'undefined' || !el(id)) return;
  setChartEmpty(id, empty);
  if (empty) return;
  if (charts[id]) charts[id].destroy();
  var c = chartColors();
  Chart.defaults.color = c.text;
  Chart.defaults.borderColor = c.grid;
  Chart.defaults.font.family = '"Plus Jakarta Sans", -apple-system, "Segoe UI", sans-serif';
  config.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false }, config.options || {});
  charts[id] = new Chart(el(id), config);
}
function moneyTick(v) { return 'R$ ' + (Math.abs(v) >= 1000 ? (v / 1000).toString().replace('.', ',') + ' mil' : v); }
function moneyTip(ctx) { return ' ' + (ctx.dataset.label ? ctx.dataset.label + ': ' : '') + fmtMoney(ctx.parsed.y !== undefined && ctx.chart.config.type !== 'doughnut' ? ctx.parsed.y : ctx.parsed); }
function onThemeChanged() { if (currentView() === 'dashboard') renderDashboard(); }

/* Vendas agrupadas por hora (cronológico, completando horas sem venda). */
function salesByHour() {
  if (!activeSales().length) return { labels: [], values: [], counts: [] };
  var HOUR = 3600 * 1000;
  var buckets = {}, min = Infinity, max = -Infinity;
  activeSales().forEach(function (s) {
    var b = Math.floor(new Date(s.timestamp).getTime() / HOUR);
    buckets[b] = buckets[b] || { v: 0, n: 0 };
    buckets[b].v += s.total; buckets[b].n += 1;
    if (b < min) min = b; if (b > max) max = b;
  });
  var multiDay = (max - min) >= 20;
  var labels = [], values = [], counts = [];
  for (var b = min; b <= max; b++) {
    var d = new Date(b * HOUR);
    labels.push((multiDay ? ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + ' ' : '') + ('0' + d.getHours()).slice(-2) + 'h');
    values.push(round2(buckets[b] ? buckets[b].v : 0));
    counts.push(buckets[b] ? buckets[b].n : 0);
  }
  return { labels: labels, values: values, counts: counts };
}

function topProducts(limit) {
  var map = {};
  activeSales().forEach(function (s) {
    s.items.forEach(function (it) {
      var k = it.productId || it.name;
      map[k] = map[k] || { name: it.name, qty: 0, revenue: 0 };
      map[k].qty += it.qty; map[k].revenue += it.price * it.qty;
    });
  });
  return Object.keys(map).map(function (k) { return map[k]; })
    .sort(function (a, b) { return b.qty - a.qty || b.revenue - a.revenue; }).slice(0, limit);
}

function renderDashboard() {
  var grid = el('kpiGrid'), grid2 = el('kpiGrid2');
  grid.innerHTML = ''; grid2.innerHTML = '';
  var ev = state.event;
  if (!ev) {
    grid.appendChild(h('div', { className: 'empty-hint', style: 'grid-column:1/-1;', text: 'Nenhum evento ainda. Vá em Eventos e crie o primeiro pra ver os números aqui.' }));
    ['chResumo', 'chPagamento', 'chHora', 'chProdutos', 'chCategorias', 'chEventos'].forEach(function (id) { setChartEmpty(id, true); });
    el('chEventosCard').style.display = 'none';
    return;
  }
  if (!state.loaded) return;
  var t = computeTotals('Todos', 'tudo');
  var revenue = t.total;
  var expenses = round2(sum(state.expenses, function (x) { return x.amount; }));
  var profit = round2(revenue - expenses);
  var pend = round2(sum(pendingReimbursements(), function (p) { return p.total; }));
  grid.appendChild(kpi('Receita', fmtMoney(revenue), t.count + ' venda(s)' + (t.canceled ? ' · ' + t.canceled + ' cancelada(s)' : '')));
  grid.appendChild(kpi('Gastos', fmtMoney(expenses), state.expenses.length + ' lançamento(s)'));
  grid.appendChild(kpi('Lucro', fmtMoney(profit), revenue > 0 ? 'margem de ' + pct(profit / revenue) : '', profit < 0 ? 'neg' : 'pos'));
  grid2.appendChild(kpi('Ticket médio', fmtMoney(t.count ? revenue / t.count : 0), 'por venda'));
  grid2.appendChild(kpi('A reembolsar', fmtMoney(pend), pend > 0 ? 'ver em Gastos' : 'nada pendente', pend > 0 ? 'warn' : ''));
  var bancos = state.balances.filter(function (a) { return a.kind === 'banco'; });
  if (bancos.length) grid2.appendChild(kpi('Saldo bancário', fmtMoney(sum(bancos, function (a) { return a.balance; })), bancos.length > 1 ? bancos.length + ' contas' : accountLabel(bancos[0])));
  var cx = eventCashAccount();
  if (cx) grid2.appendChild(kpi('Caixa do evento', fmtMoney(cx.balance), 'dinheiro na gaveta (esperado)', cx.balance < 0 ? 'neg' : ''));
  var np = pendingCancels().length;
  if (np) grid2.appendChild(kpi('Cancelamentos', String(np), 'aguardando você', 'warn'));

  var c = chartColors();
  var moneyScale = { y: { beginAtZero: true, ticks: { callback: moneyTick }, grid: { color: c.grid } }, x: { grid: { display: false } } };

  drawChart('chResumo', {
    type: 'bar',
    data: { labels: ['Receita', 'Gastos', 'Lucro'], datasets: [{ data: [revenue, expenses, profit], backgroundColor: [c.success, c.accent, profit >= 0 ? c.pix : c.danger], borderRadius: 8 }] },
    options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: moneyTip } } }, scales: moneyScale }
  }, revenue === 0 && expenses === 0);

  var payLabels = ['Dinheiro', 'Pix', 'Crédito', 'Débito'], payData = [t.dinheiro, t.pix, t.credito, t.debito];
  var payColors = [c.success, c.pix, c.cartao, c.debito];
  if (t.cartao > 0) { payLabels.push('Cartão (antigo)'); payData.push(t.cartao); payColors.push(c.text); }
  drawChart('chPagamento', {
    type: 'doughnut',
    data: { labels: payLabels, datasets: [{ data: payData, backgroundColor: payColors, borderColor: c.card, borderWidth: 3 }] },
    options: {
      cutout: '58%',
      plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: function (ctx) {
        return ' ' + ctx.label + ': ' + fmtMoney(ctx.parsed) + (revenue ? ' (' + pct(ctx.parsed / revenue) + ')' : '');
      } } } }
    }
  }, revenue === 0);

  var hours = salesByHour();
  drawChart('chHora', {
    type: 'bar',
    data: { labels: hours.labels, datasets: [{ label: 'Vendas', data: hours.values, backgroundColor: c.accent, borderRadius: 6 }] },
    options: {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (ctx) {
        return ' ' + fmtMoney(ctx.parsed.y) + ' em ' + hours.counts[ctx.dataIndex] + ' venda(s)';
      } } } },
      scales: moneyScale
    }
  }, !hours.labels.length);

  var top = topProducts(8);
  drawChart('chProdutos', {
    type: 'bar',
    data: { labels: top.map(function (x) { return x.name; }), datasets: [{ label: 'Unidades', data: top.map(function (x) { return x.qty; }), backgroundColor: c.accent, borderRadius: 6 }] },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (ctx) {
        return ' ' + ctx.parsed.x + ' un · ' + fmtMoney(top[ctx.dataIndex].revenue);
      } } } },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: c.grid } }, y: { grid: { display: false } } }
    }
  }, !top.length);

  var byCat = {};
  state.expenses.forEach(function (x) { byCat[x.category] = (byCat[x.category] || 0) + x.amount; });
  var cats = Object.keys(byCat);
  var palette = [c.accent, c.pix, c.cartao, c.success, c.danger, c.text];
  drawChart('chCategorias', {
    type: 'doughnut',
    data: { labels: cats.map(catShort), datasets: [{ data: cats.map(function (k) { return round2(byCat[k]); }), backgroundColor: cats.map(function (k, i) { return palette[i % palette.length]; }), borderColor: c.card, borderWidth: 3 }] },
    options: {
      cutout: '58%',
      plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: function (ctx) {
        return ' ' + ctx.label + ': ' + fmtMoney(ctx.parsed) + (expenses ? ' (' + pct(ctx.parsed / expenses) + ')' : '');
      } } } }
    }
  }, !cats.length);

  var many = state.totals.length >= 2;
  el('chEventosCard').style.display = many ? '' : 'none';
  if (many) {
    drawChart('chEventos', {
      type: 'bar',
      data: {
        labels: state.totals.map(function (x) { return x.name; }),
        datasets: [
          { label: 'Receita', data: state.totals.map(function (x) { return x.revenue; }), backgroundColor: c.success, borderRadius: 6 },
          { label: 'Gastos', data: state.totals.map(function (x) { return x.expenses; }), backgroundColor: c.accent, borderRadius: 6 },
          { label: 'Lucro', data: state.totals.map(function (x) { return round2(x.revenue - x.expenses); }), backgroundColor: c.pix, borderRadius: 6 }
        ]
      },
      options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: moneyTip } } }, scales: moneyScale }
    }, false);
  }
}

/* ---------- Exportar CSV ---------- */
function csvCell(v) {
  var s = String(v === null || v === undefined ? '' : v);
  return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvNum(n) { return String(round2(n)).replace('.', ','); }
function downloadCSV(name, rows) {
  downloadFile(name, '\ufeff' + rows.map(function (r) { return r.map(csvCell).join(';'); }).join('\r\n'), 'text/csv;charset=utf-8');
}
function exportarVendasCSV() {
  if (!state.event) { showToast('Nenhum evento selecionado.'); return; }
  var rows = [['Data/hora', 'Caixa', 'Pagamento', 'Total', 'Recebido', 'Troco', 'Itens', 'Situação', 'Motivo do cancelamento']];
  state.sales.forEach(function (s) {
    rows.push([dateTimeStr(s.timestamp), s.caixa, payLabel(s.payment), csvNum(s.total),
      s.recebido === null ? '' : csvNum(s.recebido), s.troco === null ? '' : csvNum(s.troco), summarizeItems(s.items),
      s.status === 'cancelada' ? 'Cancelada' : 'Ativa', s.cancelReason || '']);
  });
  downloadCSV('vendas-' + slug(state.event.name) + '-' + stampNow() + '.csv', rows);
  showToast('Vendas exportadas');
}
function exportarGastosCSV() {
  if (!state.event) { showToast('Nenhum evento selecionado.'); return; }
  var rows = [['Data', 'Categoria', 'Descrição', 'Valor', 'Produto', 'Quantidade', 'Pago com', 'Quem pagou do bolso', 'Reembolsado']];
  state.expenses.forEach(function (x) {
    var p = x.productId ? state.products.filter(function (q) { return q.id === x.productId; })[0] : null;
    rows.push([fmtDate(x.paidAt), catShort(x.category), x.description, csvNum(x.amount), p ? p.name : '',
      x.qty ? csvNum(x.qty) : '', x.accountId ? accountLabel(state.balances.filter(function (a) { return a.id === x.accountId; })[0] || { name: '' }) : '',
      x.paidBy, x.paidBy ? (x.reimbursed ? 'sim' : 'não') : '']);
  });
  downloadCSV('gastos-' + slug(state.event.name) + '-' + stampNow() + '.csv', rows);
  showToast('Gastos exportados');
}

/* =========================================================
   Contas, saldos e transferências
   saldo = inicial + transferências recebidas − enviadas
           + vendas (dinheiro → caixa do evento; Pix/crédito/débito → conta que recebe)
           − gastos pagos com a conta   (calculado no banco, view account_balances)
   ========================================================= */
function fillSelect(sel, opts, preferred) {
  var first = sel.dataset.sig === undefined;
  var prev = sel.value;
  var sig = opts.map(function (o) { return o.value + '|' + o.label; }).join('§');
  if (sel.dataset.sig !== sig) {
    sel.innerHTML = '';
    opts.forEach(function (o) { sel.appendChild(h('option', { value: o.value }, o.label)); });
    sel.dataset.sig = sig;
  }
  var has = function (v) { return opts.some(function (o) { return o.value === v; }); };
  var want;
  if (!first && has(prev)) want = prev;
  else if (preferred !== undefined && has(preferred)) want = preferred;
  else want = opts.length ? opts[0].value : '';
  sel.value = want;
}
function accountById(id) {
  return id ? (state.balances.filter(function (a) { return a.id === id; })[0] || null) : null;
}
function accountLabel(a) {
  if (!a) return 'Fora do sistema';
  if (a.kind === 'caixa' && a.eventId) {
    var ev = state.events.filter(function (e) { return e.id === a.eventId; })[0];
    return 'Caixa — ' + (ev ? ev.name : 'evento');
  }
  return a.name;
}
/* contas que dá pra usar agora: as gerais + o caixa do evento em exibição */
function accountChoices() {
  return sortAccounts(state.balances.filter(function (a) { return !a.eventId || (state.event && a.eventId === state.event.id); }));
}
/* banco primeiro, depois outras contas, depois o caixa do evento */
function sortAccounts(list) {
  var rank = { banco: 0, outro: 1, caixa: 2 };
  return list.slice().sort(function (a, b) {
    return (rank[a.kind] - rank[b.kind]) || (a.createdAt < b.createdAt ? -1 : (a.createdAt > b.createdAt ? 1 : (a.name < b.name ? -1 : 1)));
  });
}
function kindLabel(k) { return k === 'banco' ? 'Conta bancária' : (k === 'caixa' ? 'Dinheiro do evento' : 'Outra conta'); }
function hasMovements(a) { return a.salesIn || a.expensesOut || a.transfersIn || a.transfersOut; }
function transferEventFor(deId, paraId) {
  var d = accountById(deId), p = accountById(paraId);
  if (d && d.kind === 'caixa') return d.eventId;
  if (p && p.kind === 'caixa') return p.eventId;
  return null;
}

function renderContas() {
  var k = el('contasKpis');
  k.innerHTML = '';
  if (!state.balances.length) {
    k.appendChild(h('div', { className: 'empty-hint', style: 'grid-column:1/-1;', text: 'Nenhuma conta encontrada. Rode a migração 003 no Supabase.' }));
    return;
  }
  var shown = accountChoices();
  k.appendChild(kpi('Saldo total', fmtMoney(sum(shown, function (a) { return a.balance; })), shown.length + ' conta(s)'));
  var bancos = state.balances.filter(function (a) { return a.kind === 'banco'; });
  if (bancos.length) k.appendChild(kpi('Saldo bancário', fmtMoney(sum(bancos, function (a) { return a.balance; })), bancos.length > 1 ? bancos.length + ' contas' : bancos[0].name));
  var cx = eventCashAccount();
  if (cx) k.appendChild(kpi('Caixa do evento', fmtMoney(cx.balance), state.event ? state.event.name : '', cx.balance < 0 ? 'neg' : ''));

  var opts = [{ value: '', label: '— Fora do sistema —' }].concat(
    accountChoices().map(function (a) { return { value: a.id, label: accountLabel(a) }; }));
  fillSelect(el('trDe'), opts, bancos.length ? bancos[0].id : '');
  fillSelect(el('trPara'), opts, cx ? cx.id : '');
  if (!el('trData').value) el('trData').value = todayISO();
  renderAccountList();
  renderTransferList();
}

function accountCard(a, dim) {
  function line(label, val, cls) {
    return h('div', { className: 'ac-line' + (cls ? ' ' + cls : '') }, h('span', { text: label }), h('span', { text: fmtMoney(val) }));
  }
  var lines = [line('Saldo inicial', a.opening)];
  if (a.salesIn) lines.push(line('+ Vendas', a.salesIn, 'pos'));
  if (a.transfersIn) lines.push(line('+ Transferências recebidas', a.transfersIn, 'pos'));
  if (a.expensesOut) lines.push(line('− Gastos pagos', a.expensesOut, 'neg'));
  if (a.transfersOut) lines.push(line('− Transferências enviadas', a.transfersOut, 'neg'));
  return h('div', { className: 'account-card' + (dim ? ' dim' : '') },
    h('div', { className: 'ac-head' },
      h('div', null, h('div', { className: 'ac-name', text: accountLabel(a) }), h('span', { className: 'kind-pill', text: kindLabel(a.kind) })),
      h('div', { className: 'ac-balance' + (a.balance < 0 ? ' neg' : ''), text: fmtMoney(a.balance) })
    ),
    h('div', { className: 'ac-lines' }, lines),
    h('div', { className: 'ec-actions' },
      h('button', { className: 'btn-secondary btn-small', type: 'button', onclick: function () { transferirDe(a.id); } }, 'Transferir daqui'),
      h('button', { className: 'btn-secondary btn-small', type: 'button', onclick: function () { ajustarSaldo(a.id); } }, 'Ajustar saldo'),
      h('button', { className: 'btn-secondary btn-small', type: 'button', onclick: function () { editarConta(a.id); } }, 'Editar'),
      (!hasMovements(a) && a.kind !== 'caixa') ? h('button', { className: 'btn-secondary btn-small btn-danger', type: 'button', onclick: function () { excluirConta(a.id); } }, 'Excluir') : null
    )
  );
}

function renderAccountList() {
  var list = el('accountList');
  list.innerHTML = '';
  var mine = accountChoices();
  mine.forEach(function (a) { list.appendChild(accountCard(a, false)); });
  var others = sortAccounts(state.balances.filter(function (a) { return mine.indexOf(a) === -1; }));
  if (others.length) {
    list.appendChild(h('div', { className: 'section-title', text: 'Caixas de outros eventos' }));
    others.forEach(function (a) { list.appendChild(accountCard(a, true)); });
  }
}

function renderTransferList() {
  var list = el('transferList');
  list.innerHTML = '';
  var rows = state.transfers.slice().sort(function (a, b) {
    return a.date < b.date ? 1 : (a.date > b.date ? -1 : (a.createdAt < b.createdAt ? 1 : -1));
  });
  if (!rows.length) { list.appendChild(h('div', { className: 'empty-hint', text: 'Nenhuma movimentação ainda.' })); return; }
  rows.forEach(function (t) {
    var ev = t.eventId ? state.events.filter(function (e) { return e.id === t.eventId; })[0] : null;
    list.appendChild(h('div', { className: 'expense-row' },
      h('div', { className: 'er-main' },
        h('div', { className: 'er-title', text: accountLabel(accountById(t.from)) + '  →  ' + accountLabel(accountById(t.to)) }),
        h('div', { className: 'er-meta', text: fmtDate(t.date) + (t.description ? ' · ' + t.description : '') + (ev ? ' · ' + ev.name : '') })
      ),
      h('div', { className: 'er-right' },
        h('b', { text: fmtMoney(t.amount) }),
        h('div', { className: 'pi-actions' },
          h('button', { type: 'button', className: 'danger', 'aria-label': 'Excluir transferência', onclick: function () { excluirTransferencia(t.id); } }, '🗑️')
        )
      )
    ));
  });
}

function transferirDe(id) {
  switchView('contas');
  el('trDe').value = id;
  if (el('trPara').value === id) el('trPara').value = '';
  el('trValor').focus();
  el('trValor').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function preencherFundoTroco() {
  var banco = state.balances.filter(function (a) { return a.kind === 'banco'; })[0];
  var cx = eventCashAccount();
  if (!cx) { showToast('Selecione um evento primeiro.'); return; }
  if (banco) el('trDe').value = banco.id;
  el('trPara').value = cx.id;
  el('trDesc').value = 'Fundo de troco';
  el('trValor').focus();
}

async function inserirTransferencia(row) {
  var r = await safe(function () { return sb.from('transfers').insert(row).select(); });
  if (r.error) { showToast(friendlyError(r.error)); return false; }
  state.mutations++;
  await reloadNow();
  return true;
}

function salvarTransferencia() {
  if (!isAdmin() || state.saving) return;
  var de = el('trDe').value, para = el('trPara').value;
  var valor = round2(parseMoney(el('trValor').value));
  if (!(valor > 0)) { showToast('Digite o valor da transferência'); return; }
  if (!de && !para) { showToast('Escolha pelo menos uma conta'); return; }
  if (de === para) { showToast('Origem e destino não podem ser a mesma conta'); return; }
  var row = {
    from_account: de || null, to_account: para || null, amount: valor,
    description: el('trDesc').value.trim() || null,
    occurred_at: el('trData').value || todayISO(),
    event_id: transferEventFor(de, para)
  };
  async function go() {
    el('trBtn').disabled = true;
    var ok = await inserirTransferencia(row);
    el('trBtn').disabled = false;
    if (ok) { el('trValor').value = ''; el('trDesc').value = ''; showToast('Transferência registrada: ' + fmtMoney(valor)); }
  }
  var src = accountById(de);
  if (src && valor > src.balance + 0.004) {
    confirmModal({
      icon: '⚠️', title: 'Saldo insuficiente',
      text: accountLabel(src) + ' tem ' + fmtMoney(src.balance) + ' e você está transferindo ' + fmtMoney(valor) + '. A conta vai ficar negativa. Continuar?',
      confirmLabel: 'Transferir mesmo assim', onConfirm: go
    });
    return;
  }
  go();
}

function excluirTransferencia(id) {
  var t = state.transfers.filter(function (x) { return x.id === id; })[0];
  if (!t) return;
  confirmModal({
    icon: '🗑️', title: 'Excluir esta transferência?',
    text: accountLabel(accountById(t.from)) + ' → ' + accountLabel(accountById(t.to)) + ' · ' + fmtMoney(t.amount) + '. Os saldos das duas contas voltam como estavam antes dela.',
    confirmLabel: 'Excluir', danger: true,
    onConfirm: async function () {
      var r = await safe(function () { return sb.from('transfers').delete().eq('id', id).select(); });
      if (r.error) { showToast(friendlyError(r.error)); return; }
      state.mutations++;
      showToast('Transferência excluída');
      await reloadNow();
    }
  });
}

/* "Ajustar saldo": você informa o saldo real (do extrato) e o app registra a diferença. */
function ajustarSaldo(id) {
  var a = accountById(id);
  if (!a) return;
  var real = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'Saldo real, ex: 1250,00', autocomplete: 'off' });
  var info = h('div', { className: 'diff-box' });
  function upd() {
    if (!real.value.trim()) { info.className = 'diff-box'; info.textContent = 'Saldo no app: ' + fmtMoney(a.balance); return; }
    var diff = round2(parseMoney(real.value) - a.balance);
    if (Math.abs(diff) < 0.005) { info.className = 'diff-box ok'; info.textContent = '✅ Já confere com o app'; }
    else { info.className = 'diff-box ' + (diff > 0 ? 'warn' : 'bad'); info.textContent = (diff > 0 ? 'Vai registrar uma entrada de ' : 'Vai registrar uma saída de ') + fmtMoney(Math.abs(diff)); }
  }
  real.addEventListener('input', upd); upd();
  openModal(h('div', null,
    h('div', { className: 'modal-icon' }, '⚖️'),
    h('h3', { className: 'modal-title', text: 'Ajustar saldo' }),
    h('p', { className: 'modal-sub', text: accountLabel(a) + '. Digite o saldo que realmente existe (extrato do banco ou dinheiro contado).' }),
    h('div', { className: 'form-row' }, h('label', { text: 'Saldo real (R$)' }), real),
    info,
    h('div', { className: 'modal-actions' },
      h('button', {
        className: 'btn-primary', type: 'button', onclick: async function () {
          if (!real.value.trim()) { showToast('Digite o saldo real'); return; }
          await reloadNow();                         // usa o saldo de agora, não o de quando abriu a janela
          a = accountById(id) || a;
          var diff = round2(parseMoney(real.value) - a.balance);
          if (Math.abs(diff) < 0.005) { closeModal(); showToast('O saldo já confere'); return; }
          var row = {
            from_account: diff < 0 ? a.id : null, to_account: diff > 0 ? a.id : null, amount: Math.abs(diff),
            description: 'Ajuste de saldo', occurred_at: todayISO(), event_id: a.kind === 'caixa' ? a.eventId : null
          };
          if (await inserirTransferencia(row)) { closeModal(); showToast('Saldo ajustado'); }
        }
      }, 'Registrar ajuste'),
      h('button', { className: 'modal-cancel', type: 'button', onclick: closeModal }, 'Cancelar')
    )
  ));
}

function abrirNovaConta() {
  var nome = h('input', { type: 'text', placeholder: 'Ex: Poupança, Conta do evento' });
  var tipo = h('select', null, h('option', { value: 'banco' }, 'Conta bancária'), h('option', { value: 'outro' }, 'Outra conta'));
  var saldo = h('input', { type: 'text', inputmode: 'decimal', placeholder: '0,00' });
  openModal(h('div', null,
    h('div', { className: 'modal-icon' }, '🏦'),
    h('h3', { className: 'modal-title', text: 'Nova conta' }),
    h('div', { className: 'form-row' }, h('label', { text: 'Nome' }), nome),
    h('div', { className: 'form-row' }, h('label', { text: 'Tipo' }), tipo),
    h('div', { className: 'form-row' }, h('label', { text: 'Saldo inicial (R$)' }), saldo),
    h('div', { className: 'modal-actions' },
      h('button', {
        className: 'btn-primary', type: 'button', onclick: async function () {
          var n = nome.value.trim();
          if (!n) { showToast('Digite o nome da conta'); return; }
          var r = await safe(function () { return sb.from('accounts').insert({ name: n, kind: tipo.value, opening_balance: round2(parseMoney(saldo.value)) }).select(); });
          if (r.error) { showToast(friendlyError(r.error)); return; }
          closeModal(); state.mutations++; showToast('Conta criada'); await reloadNow();
        }
      }, 'Criar conta'),
      h('button', { className: 'modal-cancel', type: 'button', onclick: closeModal }, 'Cancelar')
    )
  ));
}

function editarConta(id) {
  var a = accountById(id);
  if (!a) return;
  var nome = h('input', { type: 'text', value: a.name });
  var saldo = h('input', { type: 'text', inputmode: 'decimal' });
  saldo.value = String(a.opening).replace('.', ',');
  openModal(h('div', null,
    h('div', { className: 'modal-icon' }, '✏️'),
    h('h3', { className: 'modal-title', text: 'Editar conta' }),
    a.kind === 'caixa'
      ? h('p', { className: 'modal-sub', text: 'O nome do caixa do evento acompanha o evento.' })
      : h('div', { className: 'form-row' }, h('label', { text: 'Nome' }), nome),
    h('div', { className: 'form-row' }, h('label', { text: 'Saldo inicial (R$)' }), saldo),
    h('p', { className: 'fc-note', text: 'Pra acertar o saldo com o extrato sem mexer no histórico, prefira "Ajustar saldo".' }),
    h('div', { className: 'modal-actions' },
      h('button', {
        className: 'btn-primary', type: 'button', onclick: async function () {
          var patch = { opening_balance: round2(parseMoney(saldo.value)) };
          if (a.kind !== 'caixa') {
            if (!nome.value.trim()) { showToast('Digite o nome'); return; }
            patch.name = nome.value.trim();
          }
          var r = await safe(function () { return sb.from('accounts').update(patch).eq('id', id).select(); });
          if (r.error) { showToast(friendlyError(r.error)); return; }
          closeModal(); state.mutations++; showToast('Conta atualizada'); await reloadNow();
        }
      }, 'Salvar'),
      h('button', { className: 'modal-cancel', type: 'button', onclick: closeModal }, 'Cancelar')
    )
  ));
}

function excluirConta(id) {
  var a = accountById(id);
  if (!a) return;
  confirmModal({
    icon: '🗑️', title: 'Excluir "' + accountLabel(a) + '"?',
    text: 'Só dá pra excluir conta sem nenhuma movimentação.',
    confirmLabel: 'Excluir', danger: true,
    onConfirm: async function () {
      var r = await safe(function () { return sb.from('accounts').delete().eq('id', id).select(); });
      if (r.error) { showToast(r.error.code === '23503' ? 'Essa conta tem movimentações, então não pode ser excluída.' : friendlyError(r.error)); return; }
      state.mutations++; showToast('Conta excluída'); await reloadNow();
    }
  });
}

/* =========================================================
   Cancelamentos (aprovação do admin)
   ========================================================= */
function cancelCard(r) {
  var sale = state.sales.filter(function (x) { return x.id === r.saleId; })[0];
  var pend = r.status === 'pendente';
  return h('div', { className: 'cancel-card' },
    h('div', { className: 'cc-head' },
      h('div', { className: 'cc-items', text: sale ? summarizeItems(sale.items) : 'Venda removida' }),
      h('div', { className: 'cc-total', text: sale ? fmtMoney(sale.total) : '' })
    ),
    h('div', { className: 'cc-meta', text: sale ? (sale.caixa + ' · ' + dateTimeStr(sale.timestamp) + ' · ' + payLabel(sale.payment)) : '' }),
    h('div', { className: 'cc-reason' }, h('b', { text: 'Motivo: ' }), r.reason),
    !pend ? h('div', { className: 'cc-meta' }, reqStatusPill(r.status), r.note ? '  ' + r.note : '') : null,
    pend ? h('div', { className: 'ec-actions' },
      h('button', { className: 'btn-primary btn-small', type: 'button', style: 'width:auto;margin:0;', onclick: function () { decidirCancelamento(r, true); } }, 'Aprovar cancelamento'),
      h('button', { className: 'btn-secondary btn-small', type: 'button', onclick: function () { decidirCancelamento(r, false); } }, 'Negar')
    ) : null
  );
}

function renderCancelamentos() {
  var pend = el('cancelPending'), hist = el('cancelHistory');
  pend.innerHTML = ''; hist.innerHTML = '';
  var p = pendingCancels().slice().sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; });
  if (!p.length) pend.appendChild(h('div', { className: 'empty-hint', text: 'Nenhum pedido aguardando. 🎉' }));
  p.forEach(function (r) { pend.appendChild(cancelCard(r)); });
  var done = state.cancels.filter(function (r) { return r.status !== 'pendente'; })
    .sort(function (a, b) { return (a.decidedAt || '') < (b.decidedAt || '') ? 1 : -1; }).slice(0, 30);
  if (!done.length) hist.appendChild(h('div', { className: 'empty-hint', text: 'Ainda não há pedidos decididos neste evento.' }));
  done.forEach(function (r) { hist.appendChild(cancelCard(r)); });
}

function decidirCancelamento(r, approve) {
  var sale = state.sales.filter(function (x) { return x.id === r.saleId; })[0];
  var note = h('input', { type: 'text', placeholder: approve ? 'Observação (opcional)' : 'Por que está negando? (opcional)', autocomplete: 'off' });
  var busy = false;
  openModal(h('div', null,
    h('div', { className: 'modal-icon' }, approve ? '✅' : '🚫'),
    h('h3', { className: 'modal-title', text: approve ? 'Aprovar cancelamento?' : 'Negar cancelamento?' }),
    sale ? h('div', { className: 'undo-summary' },
      h('div', { className: 'us-items', text: summarizeItems(sale.items) }),
      h('div', { className: 'us-meta', text: sale.caixa + ' · ' + payLabel(sale.payment) }),
      h('div', { className: 'us-total', text: fmtMoney(sale.total) })
    ) : null,
    h('p', { className: 'modal-sub', text: 'Motivo informado: ' + r.reason }),
    approve && sale && sale.payment === 'dinheiro' ? h('p', { className: 'modal-sub', text: 'Pagamento em dinheiro: devolva ' + fmtMoney(sale.total) + ' ao cliente.' }) : null,
    h('div', { className: 'form-row' }, h('label', { text: 'Resposta pro operador' }), note),
    h('div', { className: 'modal-actions' },
      h('button', {
        className: approve ? 'btn-primary' : 'btn-primary btn-primary-danger', type: 'button', onclick: async function () {
          if (busy) return; busy = true;
          var res = await safe(function () { return sb.rpc('decide_cancellation', { p_request: r.id, p_approve: approve, p_note: note.value.trim() || null }); });
          busy = false;
          if (res.error) { showToast(friendlyError(res.error)); return; }
          closeModal(); state.mutations++;
          showToast(approve ? 'Cancelamento aprovado' : 'Pedido negado');
          await reloadNow();
        }
      }, approve ? 'Aprovar e cancelar a venda' : 'Negar pedido'),
      h('button', { className: 'modal-cancel', type: 'button', onclick: closeModal }, 'Voltar')
    )
  ));
}

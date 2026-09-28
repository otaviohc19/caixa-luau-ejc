/* =========================================================
   Caixa Lual — lógica do app
   ========================================================= */

/* Lista de quem pode acessar o app. Fica junto com o código publicado,
   ou seja, vale pra TODOS os aparelhos que abrirem o site — não é preciso
   configurar em cada celular. Pra adicionar/remover/trocar senha de
   alguém, edite aqui e reimplante (mesma pasta de novo no Netlify).

   admin: true  → acessa Produtos, apaga vendas/dados
   admin: false → só vende e vê o relatório

   Deixe a lista vazia ([]) pra desativar o login (app fica aberto pra
   qualquer um, como antes). */
var USERS = [
  // { user: 'otavio',  pass: 'trocar123', name: 'Otávio', admin: true },
  // { user: 'maria',   pass: 'trocar456', name: 'Maria',  admin: false },
];

var KEYS = {
  products: 'lual_products',
  sales: 'lual_sales',
  caixa: 'lual_caixa_name',
  theme: 'lual_theme',
  fundo: 'lual_fundo',
  loggedUser: 'lual_logged_user'
};

var state = {
  products: [],
  sales: [],
  caixaName: 'Caixa 1',
  cart: [],
  selectedCategory: 'Todos',
  payment: null,
  currentUser: null,
  editingId: null,
  comboDraft: []
};

/* ---------- Storage ---------- */
function lsGet(k, fallback) {
  try { var v = localStorage.getItem(k); return v === null ? fallback : v; } catch (e) { return fallback; }
}
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

function loadState() {
  try { state.products = JSON.parse(lsGet(KEYS.products, '[]')) || []; } catch (e) { state.products = []; }
  try { state.sales = JSON.parse(lsGet(KEYS.sales, '[]')) || []; } catch (e) { state.sales = []; }
  state.caixaName = lsGet(KEYS.caixa, 'Caixa 1') || 'Caixa 1';
}
function saveProducts() { lsSet(KEYS.products, JSON.stringify(state.products)); }
function saveSales() { lsSet(KEYS.sales, JSON.stringify(state.sales)); }

/* ---------- Utils ---------- */
function el(id) { return document.getElementById(id); }
function fmtMoney(v) { return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function parseMoney(str) {
  if (str === null || str === undefined) return 0;
  var s = String(str).trim().replace(/\s/g, '').replace('R$', '');
  if (s.indexOf(',') !== -1) s = s.replace(/\./g, '').replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function timeStr(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function payLabel(p) { return p === 'dinheiro' ? 'Dinheiro' : (p === 'pix' ? 'Pix' : 'Cartão'); }
function summarizeItems(items) { return items.map(function (i) { return i.qty + 'x ' + i.name; }).join(', '); }
function showToast(msg) {
  var t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(function () { t.classList.remove('show'); }, 2000);
}

/* Cria elementos DOM: h('div', {className:'x', onclick:fn}, filho1, filho2...) */
function h(tag, props) {
  var node = document.createElement(tag);
  props = props || {};
  Object.keys(props).forEach(function (k) {
    var v = props[k];
    if (k === 'text') node.textContent = v;
    else if (k === 'className') node.className = v;
    else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  });
  for (var i = 2; i < arguments.length; i++) {
    var c = arguments[i];
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) c.forEach(function (x) { if (x) node.appendChild(x); });
    else node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/* ---------- Tema ---------- */
function getSavedTheme() { return lsGet(KEYS.theme, 'auto'); }
function applyTheme(theme) {
  var root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  document.querySelectorAll('.theme-btn').forEach(function (b) {
    b.classList.toggle('selected', b.getAttribute('data-theme-opt') === theme);
  });
}
function setTheme(theme) { lsSet(KEYS.theme, theme); applyTheme(theme); }

/* ---------- Modal ---------- */
function isModalOpen() { return el('modalRoot').classList.contains('active'); }
function openModal(content) {
  var root = el('modalRoot');
  root.innerHTML = '';
  root.appendChild(h('div', { className: 'modal' }, content));
  root.classList.add('active');
}
function closeModal() {
  var root = el('modalRoot');
  root.classList.remove('active');
  root.innerHTML = '';
}
el('modalRoot').addEventListener('click', function (e) { if (e.target === el('modalRoot')) closeModal(); });

function confirmModal(opts) {
  openModal(h('div', null,
    opts.icon ? h('div', { className: 'modal-icon' }, opts.icon) : null,
    h('h3', { className: 'modal-title', text: opts.title }),
    opts.text ? h('p', { className: 'modal-sub', text: opts.text }) : null,
    opts.body || null,
    h('div', { className: 'modal-actions' },
      h('button', {
        className: opts.danger ? 'btn-primary btn-primary-danger' : 'btn-primary', type: 'button',
        onclick: function () { closeModal(); opts.onConfirm(); }
      }, opts.confirmLabel || 'Confirmar'),
      h('button', { className: 'modal-cancel', type: 'button', onclick: closeModal }, 'Cancelar')
    )
  ));
}

/* ---------- Login ---------- */
function findUser(user, pass) {
  var u = (user || '').trim().toLowerCase();
  return USERS.filter(function (x) { return x.user.toLowerCase() === u && x.pass === pass; })[0] || null;
}
function getLoggedUser() {
  if (!USERS.length) return null;
  var saved = lsGet(KEYS.loggedUser, '');
  if (!saved) return null;
  return USERS.filter(function (x) { return x.user === saved; })[0] || null;
}
function isAdmin() { return !USERS.length || (state.currentUser && state.currentUser.admin); }

function checkGate() {
  if (!USERS.length) { el('gateScreen').classList.remove('active'); return; }
  var u = getLoggedUser();
  if (u) {
    state.currentUser = u;
    state.caixaName = u.name;
    el('caixaBadge').textContent = u.name;
    el('gateScreen').classList.remove('active');
    return;
  }
  el('gateScreen').classList.add('active');
  setTimeout(function () { el('gateUserInput').focus(); }, 100);
}
function tentarLogin() {
  var user = el('gateUserInput').value;
  var pass = el('gatePassInput').value;
  var match = findUser(user, pass);
  if (match) {
    lsSet(KEYS.loggedUser, match.user);
    state.currentUser = match;
    state.caixaName = match.name;
    lsSet(KEYS.caixa, match.name);
    el('caixaBadge').textContent = match.name;
    el('gateScreen').classList.remove('active');
    el('gateError').textContent = '';
    el('gateUserInput').value = ''; el('gatePassInput').value = '';
    renderCategoryChips(); renderProductGrid(); renderTodayBar();
    applyNavVisibility();
  } else {
    el('gateError').textContent = 'Usuário ou senha incorretos';
    el('gatePassInput').value = '';
    el('gatePassInput').focus();
  }
}
function fazerLogout() {
  lsDel(KEYS.loggedUser);
  state.currentUser = null;
  doSwitchView('vender');
  checkGate();
}
['gateUserInput', 'gatePassInput'].forEach(function (id) {
  var elm = el(id);
  elm && elm.addEventListener('keydown', function (e) { if (e.key === 'Enter') tentarLogin(); });
});

function renderLoginSection() {
  var box = el('loginSection');
  if (!box) return;
  box.innerHTML = '';
  if (!USERS.length) {
    box.appendChild(h('p', { className: 'pin-status', text: 'Login desativado. Qualquer pessoa com o link acessa o app inteiro, sem se identificar.' }));
    box.appendChild(h('p', { className: 'pin-status', style: 'margin-top:8px;', text: 'Pra ativar, peça pra cadastrar usuários no código (lista USERS) e reimplante o site.' }));
    return;
  }
  var u = state.currentUser;
  box.appendChild(h('p', { className: 'pin-status on', text: '👤 Logado como ' + (u ? u.name : '?') + (u && u.admin ? ' (admin)' : ' (operador)') }));
  box.appendChild(h('p', { className: 'pin-status', style: 'margin-top:8px;', text: 'Pra adicionar, remover ou trocar a senha de alguém, peça uma atualização do código (lista USERS) e reimplante o site.' }));
  box.appendChild(h('button', { className: 'clear-cart-link', type: 'button', onclick: fazerLogout }, 'Sair (trocar de usuário)'));
}

/* ---------- Navegação ---------- */
function currentView() {
  var v = document.querySelector('.view.active');
  return v ? v.id.replace('view-', '') : 'vender';
}
function applyNavVisibility() {
  var admin = isAdmin();
  var prodBtn = document.querySelector('.bottomnav button[data-view="produtos"]');
  if (prodBtn) prodBtn.style.display = admin ? '' : 'none';
  var resetCard = el('resetDataCard');
  if (resetCard) resetCard.style.display = admin ? '' : 'none';
}
function switchView(name) {
  if (name === 'produtos' && !isAdmin()) { showToast('Só admins acessam Produtos'); return; }
  doSwitchView(name);
}
function doSwitchView(name) {
  document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
  el('view-' + name).classList.add('active');
  document.querySelectorAll('.bottomnav button').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-view') === name);
  });
  if (name === 'vender') { renderCategoryChips(); renderProductGrid(); renderTodayBar(); }
  if (name === 'produtos') { renderProductList(); renderComboEditor(); }
  if (name === 'relatorio') { populateFiltroCaixa(); renderRelatorio(); }
  if (name === 'config') {
    el('caixaNomeInput').value = state.caixaName;
    el('caixaNomeRow').style.display = USERS.length ? 'none' : 'block';
    applyTheme(getSavedTheme());
    renderLoginSection();
    applyNavVisibility();
  }
  window.scrollTo(0, 0);
}

/* ---------- Vender ---------- */
function ownSales() { return state.sales.filter(function (s) { return s.caixa === state.caixaName; }); }
function lastOwnSale() {
  for (var i = state.sales.length - 1; i >= 0; i--) if (state.sales[i].caixa === state.caixaName) return state.sales[i];
  return null;
}

function renderTodayBar() {
  var mine = ownSales();
  var total = mine.reduce(function (s, x) { return s + x.total; }, 0);
  el('tbCount').textContent = mine.length;
  el('tbTotal').textContent = fmtMoney(total);
  el('undoBtn').style.display = mine.length ? 'block' : 'none';
}

function renderCategoryChips() {
  var cats = ['Todos'];
  state.products.forEach(function (p) {
    var c = (p.category || 'Geral').trim() || 'Geral';
    if (cats.indexOf(c) === -1) cats.push(c);
  });
  if (cats.indexOf(state.selectedCategory) === -1) state.selectedCategory = 'Todos';
  var row = el('catChipRow');
  row.innerHTML = '';
  cats.forEach(function (c) {
    row.appendChild(h('button', {
      className: 'cat-chip' + (state.selectedCategory === c ? ' active' : ''), type: 'button',
      onclick: function () { state.selectedCategory = c; renderCategoryChips(); renderProductGrid(); }
    }, c));
  });
  row.style.display = state.products.length ? 'flex' : 'none';
}

function comboLine(components) {
  return (components || []).map(function (c) { return c.qty + 'x ' + c.name; }).join(' + ');
}

function renderProductGrid() {
  var grid = el('productGrid');
  grid.innerHTML = '';
  el('noProductsHint').style.display = state.products.length ? 'none' : 'block';
  state.products
    .filter(function (p) { return state.selectedCategory === 'Todos' || (p.category || 'Geral') === state.selectedCategory; })
    .forEach(function (p) {
      grid.appendChild(h('button', { className: 'product-btn' + (p.isCombo ? ' is-combo' : ''), type: 'button', onclick: function () { addToCart(p); } },
        p.isCombo ? h('span', { className: 'combo-badge' }, 'Combo') : null,
        h('span', { className: 'pname', text: p.name }),
        p.isCombo ? h('span', { className: 'pcombo', text: comboLine(p.components) }) : null,
        h('span', { className: 'pprice', text: fmtMoney(p.price) }),
        h('span', { className: 'pcat', text: p.category || '' })
      ));
    });
}

function addToCart(product) {
  var item = state.cart.find(function (i) { return i.productId === product.id; });
  if (item) item.qty += 1;
  else state.cart.push({
    productId: product.id, name: product.name, price: product.price, qty: 1,
    isCombo: !!product.isCombo, components: product.components || []
  });
  renderCart();
}

function changeQty(productId, delta) {
  var item = state.cart.find(function (i) { return i.productId === productId; });
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) state.cart = state.cart.filter(function (i) { return i.productId !== productId; });
  renderCart();
}

function cartTotalValue() { return round2(state.cart.reduce(function (s, i) { return s + i.price * i.qty; }, 0)); }

function renderCart() {
  var card = el('cartCard');
  var itemsEl = el('cartItems');
  itemsEl.innerHTML = '';
  if (!state.cart.length) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  state.cart.forEach(function (i) {
    itemsEl.appendChild(h('div', { className: 'cart-item' },
      h('div', null,
        h('div', { className: 'ci-name', text: i.name }),
        h('div', { className: 'ci-price', text: fmtMoney(i.price) + ' cada' + (i.isCombo ? ' · ' + comboLine(i.components) : '') })
      ),
      h('div', { className: 'qty-ctl' },
        h('button', { type: 'button', onclick: function () { changeQty(i.productId, -1); } }, '−'),
        h('span', { text: String(i.qty) }),
        h('button', { type: 'button', onclick: function () { changeQty(i.productId, 1); } }, '+')
      )
    ));
  });
  el('cartTotal').textContent = fmtMoney(cartTotalValue());
  calcTroco();
  updateFinalizeState();
}

function selectPayment(method) {
  state.payment = method;
  document.querySelectorAll('.pay-btn').forEach(function (b) {
    b.classList.toggle('selected', b.getAttribute('data-pay') === method);
  });
  if (method === 'dinheiro') {
    el('trocoBox').classList.add('show');
    setTimeout(function () { el('recebidoInput').focus(); }, 50);
  } else {
    el('trocoBox').classList.remove('show');
    el('recebidoInput').value = '';
    el('trocoResult').textContent = '';
  }
  updateFinalizeState();
}

function calcTroco() {
  if (state.payment !== 'dinheiro') return;
  var raw = el('recebidoInput').value;
  var resultEl = el('trocoResult');
  if (!raw.trim()) { resultEl.textContent = ''; updateFinalizeState(); return; }
  var troco = round2(parseMoney(raw) - cartTotalValue());
  if (troco < 0) {
    resultEl.textContent = 'Faltam ' + fmtMoney(-troco);
    resultEl.className = 'troco-result bad';
  } else {
    resultEl.textContent = 'Troco: ' + fmtMoney(troco);
    resultEl.className = 'troco-result ok';
  }
  updateFinalizeState();
}

function updateFinalizeState() {
  var valid = state.cart.length > 0 && !!state.payment;
  if (state.payment === 'dinheiro') {
    var recebido = parseMoney(el('recebidoInput').value);
    valid = valid && recebido > 0 && round2(recebido) >= cartTotalValue();
  }
  el('finalizeBtn').disabled = !valid;
}

function limparCarrinho() {
  state.cart = [];
  state.payment = null;
  document.querySelectorAll('.pay-btn').forEach(function (b) { b.classList.remove('selected'); });
  el('trocoBox').classList.remove('show');
  el('recebidoInput').value = '';
  el('trocoResult').textContent = '';
  renderCart();
}

function finalizarVenda() {
  if (el('finalizeBtn').disabled) return;
  var total = cartTotalValue();
  var recebido = state.payment === 'dinheiro' ? round2(parseMoney(el('recebidoInput').value)) : null;
  state.sales.push({
    id: uid(),
    timestamp: new Date().toISOString(),
    items: state.cart.map(function (i) {
      return { productId: i.productId, name: i.name, price: i.price, qty: i.qty, isCombo: i.isCombo, components: i.components };
    }),
    total: total,
    payment: state.payment,
    recebido: recebido,
    troco: recebido !== null ? round2(recebido - total) : null,
    caixa: state.caixaName
  });
  saveSales();
  showToast('Venda registrada: ' + fmtMoney(total));
  limparCarrinho();
  renderTodayBar();
}

/* ---------- Desfazer última venda ---------- */
function desfazerUltimaVenda() {
  var s = lastOwnSale();
  if (!s) return;
  var removeIt = function () {
    state.sales = state.sales.filter(function (x) { return x.id !== s.id; });
    saveSales();
    renderTodayBar();
  };
  openModal(h('div', null,
    h('div', { className: 'modal-icon' }, '↩️'),
    h('h3', { className: 'modal-title', text: 'Desfazer a última venda?' }),
    h('div', { className: 'undo-summary' },
      h('div', { className: 'us-items', text: summarizeItems(s.items) }),
      h('div', { className: 'us-meta', text: timeStr(s.timestamp) + ' · ' + payLabel(s.payment) }),
      h('div', { className: 'us-total', text: fmtMoney(s.total) })
    ),
    s.payment === 'dinheiro'
      ? h('p', { className: 'modal-sub', text: 'Se for devolver ao cliente: ' + fmtMoney(s.total) + ' (o troco dado já foi descontado).' })
      : null,
    h('div', { className: 'modal-actions' },
      h('button', {
        className: 'btn-primary', type: 'button', onclick: function () {
          removeIt();
          state.cart = s.items.map(function (i) {
            return { productId: i.productId || ('x' + uid()), name: i.name, price: i.price, qty: i.qty, isCombo: !!i.isCombo, components: i.components || [] };
          });
          closeModal();
          limparPagamento();
          renderCart();
          showToast('Venda desfeita — pedido voltou pro carrinho');
        }
      }, 'Desfazer e corrigir o pedido'),
      h('button', {
        className: 'btn-secondary', type: 'button', style: 'width:100%;', onclick: function () {
          removeIt(); closeModal(); showToast('Venda desfeita');
        }
      }, 'Só desfazer'),
      h('button', { className: 'modal-cancel', type: 'button', onclick: closeModal }, 'Cancelar')
    )
  ));
}
function limparPagamento() {
  state.payment = null;
  document.querySelectorAll('.pay-btn').forEach(function (b) { b.classList.remove('selected'); });
  el('trocoBox').classList.remove('show');
  el('recebidoInput').value = '';
  el('trocoResult').textContent = '';
}

/* ---------- Produtos / combos ---------- */
function renderComboEditor() {
  var isCombo = el('prodCombo').checked;
  el('comboEditor').classList.toggle('show', isCombo);
  if (!isCombo) return;

  var sel = el('comboSelect');
  var prev = sel.value;
  sel.innerHTML = '';
  var options = state.products.filter(function (p) { return !p.isCombo && p.id !== state.editingId; });
  if (!options.length) sel.appendChild(h('option', { value: '' }, 'Cadastre itens avulsos primeiro'));
  options.forEach(function (p) { sel.appendChild(h('option', { value: p.id }, p.name + ' — ' + fmtMoney(p.price))); });
  if (prev && options.some(function (p) { return p.id === prev; })) sel.value = prev;

  var list = el('comboItems');
  list.innerHTML = '';
  state.comboDraft.forEach(function (c, idx) {
    list.appendChild(h('div', { className: 'combo-item' },
      h('span', { text: c.qty + 'x ' + c.name }),
      h('button', { type: 'button', className: 'combo-remove', 'aria-label': 'Remover', onclick: function () {
        state.comboDraft.splice(idx, 1); renderComboEditor();
      } }, '✕')
    ));
  });

  var hint = el('comboHint');
  if (!state.comboDraft.length) { hint.textContent = 'Escolha os itens que fazem parte do combo.'; hint.className = 'combo-hint'; return; }
  var avulso = round2(state.comboDraft.reduce(function (s, c) {
    var p = state.products.find(function (x) { return x.id === c.productId; });
    return s + (p ? p.price : 0) * c.qty;
  }, 0));
  var preco = parseMoney(el('prodPreco').value);
  var txt = 'Separado sairia ' + fmtMoney(avulso);
  if (preco > 0 && preco < avulso) txt += ' · economia de ' + fmtMoney(avulso - preco) + ' pro cliente';
  if (preco > avulso) txt += ' · atenção: combo mais caro que os itens separados';
  hint.textContent = txt;
  hint.className = 'combo-hint' + (preco > avulso ? ' warn' : '');
}

function addComboComponent() {
  var id = el('comboSelect').value;
  var qty = parseInt(el('comboQty').value, 10) || 1;
  var p = state.products.find(function (x) { return x.id === id; });
  if (!p) { showToast('Escolha um item'); return; }
  var existing = state.comboDraft.find(function (c) { return c.productId === id; });
  if (existing) existing.qty += qty;
  else state.comboDraft.push({ productId: p.id, name: p.name, qty: qty });
  el('comboQty').value = '1';
  renderComboEditor();
}

function resetProductForm() {
  state.editingId = null;
  state.comboDraft = [];
  el('prodNome').value = '';
  el('prodPreco').value = '';
  el('prodCategoria').value = '';
  el('prodCombo').checked = false;
  el('salvarProdBtn').textContent = 'Adicionar produto';
  el('prodFormTitle').textContent = 'Cadastrar produto';
  el('cancelEditBtn').style.display = 'none';
  renderComboEditor();
}

function salvarProduto() {
  var nome = el('prodNome').value.trim();
  var preco = round2(parseMoney(el('prodPreco').value));
  var isCombo = el('prodCombo').checked;
  var cat = el('prodCategoria').value.trim() || (isCombo ? 'Combos' : 'Geral');
  if (!nome) { showToast('Digite o nome do produto'); return; }
  if (!(preco > 0)) { showToast('Digite um preço válido'); return; }
  if (isCombo && !state.comboDraft.length) { showToast('Adicione pelo menos um item ao combo'); return; }

  var data = { name: nome, price: preco, category: cat, isCombo: isCombo, components: isCombo ? state.comboDraft.slice() : [] };
  if (state.editingId) {
    var p = state.products.find(function (x) { return x.id === state.editingId; });
    if (p) Object.assign(p, data);
    showToast('Produto atualizado');
  } else {
    data.id = uid();
    state.products.push(data);
    showToast(isCombo ? 'Combo adicionado' : 'Produto adicionado');
  }
  saveProducts();
  resetProductForm();
  renderProductList();
  renderCategoryChips();
  renderProductGrid();
}

function editarProduto(id) {
  var p = state.products.find(function (x) { return x.id === id; });
  if (!p) return;
  state.editingId = id;
  state.comboDraft = (p.components || []).map(function (c) { return { productId: c.productId, name: c.name, qty: c.qty }; });
  el('prodNome').value = p.name;
  el('prodPreco').value = String(p.price).replace('.', ',');
  el('prodCategoria').value = p.category || '';
  el('prodCombo').checked = !!p.isCombo;
  el('salvarProdBtn').textContent = 'Salvar alteração';
  el('prodFormTitle').textContent = 'Editando: ' + p.name;
  el('cancelEditBtn').style.display = 'block';
  renderComboEditor();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function excluirProduto(id) {
  var p = state.products.find(function (x) { return x.id === id; });
  if (!p) return;
  var usedIn = state.products.filter(function (x) {
    return x.isCombo && (x.components || []).some(function (c) { return c.productId === id; });
  });
  confirmModal({
    icon: '🗑️', title: 'Excluir "' + p.name + '"?',
    text: usedIn.length
      ? 'Esse item faz parte de: ' + usedIn.map(function (x) { return x.name; }).join(', ') + '. Os combos continuam existindo.'
      : 'As vendas já registradas não são afetadas.',
    confirmLabel: 'Excluir', danger: true,
    onConfirm: function () {
      state.products = state.products.filter(function (x) { return x.id !== id; });
      saveProducts();
      if (state.editingId === id) resetProductForm();
      renderProductList(); renderCategoryChips(); renderProductGrid(); renderComboEditor();
      showToast('Produto removido');
    }
  });
}

function renderProductList() {
  var list = el('productList');
  list.innerHTML = '';
  el('noProductsHint2').style.display = state.products.length ? 'none' : 'block';
  state.products.forEach(function (p) {
    list.appendChild(h('div', { className: 'product-list-item' },
      h('div', { className: 'pi-info' },
        h('div', { className: 'pi-name' }, p.name, p.isCombo ? h('span', { className: 'combo-badge inline' }, 'Combo') : null),
        h('div', { className: 'pi-meta', text: fmtMoney(p.price) + ' · ' + (p.category || 'Geral') + (p.isCombo ? ' · ' + comboLine(p.components) : '') })
      ),
      h('div', { className: 'pi-actions' },
        h('button', { type: 'button', 'aria-label': 'Editar', onclick: function () { editarProduto(p.id); } }, '✏️'),
        h('button', { type: 'button', className: 'danger', 'aria-label': 'Excluir', onclick: function () { excluirProduto(p.id); } }, '🗑️')
      )
    ));
  });
}

/* ---------- Relatório ---------- */
function populateFiltroCaixa() {
  var sel = el('filtroCaixa');
  var current = sel.value || 'Todos';
  var caixas = ['Todos'];
  state.sales.forEach(function (s) { if (caixas.indexOf(s.caixa) === -1) caixas.push(s.caixa); });
  sel.innerHTML = '';
  caixas.forEach(function (c) { sel.appendChild(h('option', { value: c }, c === 'Todos' ? 'Todos os caixas' : c)); });
  sel.value = caixas.indexOf(current) !== -1 ? current : 'Todos';
}

function computeTotals(filtro) {
  var sales = state.sales.filter(function (s) { return filtro === 'Todos' || s.caixa === filtro; });
  var t = { sales: sales, count: sales.length, total: 0, dinheiro: 0, pix: 0, cartao: 0 };
  sales.forEach(function (s) {
    t.total += s.total;
    if (t[s.payment] !== undefined) t[s.payment] += s.total;
  });
  ['total', 'dinheiro', 'pix', 'cartao'].forEach(function (k) { t[k] = round2(t[k]); });
  return t;
}

function renderRelatorio() {
  var filtro = el('filtroCaixa').value || 'Todos';
  var t = computeTotals(filtro);
  el('repTotal').textContent = fmtMoney(t.total);
  el('repDinheiro').textContent = fmtMoney(t.dinheiro);
  el('repPix').textContent = fmtMoney(t.pix);
  el('repCartao').textContent = fmtMoney(t.cartao);
  el('repCount').textContent = t.count;

  var listEl = el('salesList');
  listEl.innerHTML = '';
  el('noSalesHint').style.display = t.count ? 'none' : 'block';
  t.sales.slice().reverse().forEach(function (s) {
    var summary = summarizeItems(s.items);
    listEl.appendChild(h('div', { className: 'sale-row' },
      h('div', { className: 'sr-left' },
        h('div', { text: summary.length > 34 ? summary.slice(0, 34) + '…' : summary }),
        h('div', { className: 'sr-time', text: timeStr(s.timestamp) + ' · ' + s.caixa })
      ),
      h('span', { className: 'sr-badge badge-' + s.payment, text: payLabel(s.payment) }),
      h('span', { className: 'sr-value', text: fmtMoney(s.total) }),
      h('button', { className: 'sr-del', type: 'button', 'aria-label': 'Apagar venda', onclick: function () { excluirVenda(s.id); } }, '✕')
    ));
  });
}

function excluirVenda(id) {
  var s = state.sales.find(function (x) { return x.id === id; });
  if (!s) return;
  if (!isAdmin()) { showToast('Só admins apagam vendas'); return; }
  confirmModal({
    icon: '🗑️', title: 'Apagar esta venda?',
    text: summarizeItems(s.items) + ' · ' + fmtMoney(s.total) + ' · ' + payLabel(s.payment) + ' · ' + timeStr(s.timestamp),
    confirmLabel: 'Apagar venda', danger: true,
    onConfirm: function () {
      state.sales = state.sales.filter(function (x) { return x.id !== id; });
      saveSales();
      populateFiltroCaixa(); renderRelatorio(); renderTodayBar();
      showToast('Venda apagada');
    }
  });
}

/* ---------- Fechamento de caixa ---------- */
function abrirFechamento() {
  var filtro = el('filtroCaixa').value || 'Todos';
  var t = computeTotals(filtro);

  var fundoInput = h('input', { type: 'text', inputmode: 'decimal', placeholder: '0,00' });
  fundoInput.value = lsGet(KEYS.fundo, '');
  var contadoInput = h('input', { type: 'text', inputmode: 'decimal', placeholder: '0,00' });
  var esperadoEl = h('span', { className: 'fc-strong' });
  var diffBox = h('div', { className: 'diff-box' });

  function update() {
    lsSet(KEYS.fundo, fundoInput.value);
    var esperado = round2(parseMoney(fundoInput.value) + t.dinheiro);
    esperadoEl.textContent = fmtMoney(esperado);
    if (!contadoInput.value.trim()) {
      diffBox.className = 'diff-box';
      diffBox.textContent = 'Conte as notas e moedas da gaveta e digite acima pra conferir.';
      return;
    }
    var diff = round2(parseMoney(contadoInput.value) - esperado);
    if (Math.abs(diff) < 0.005) { diffBox.className = 'diff-box ok'; diffBox.textContent = '✅ O caixa bateu certinho!'; }
    else if (diff > 0) { diffBox.className = 'diff-box warn'; diffBox.textContent = '⚠️ Sobrando ' + fmtMoney(diff) + ' na gaveta'; }
    else { diffBox.className = 'diff-box bad'; diffBox.textContent = '❌ Faltando ' + fmtMoney(-diff) + ' na gaveta'; }
  }
  fundoInput.addEventListener('input', update);
  contadoInput.addEventListener('input', update);

  function row(label, value, cls) {
    return h('div', { className: 'fc-row' + (cls ? ' ' + cls : '') }, h('span', { text: label }), h('span', { className: 'fc-val', text: value }));
  }

  openModal(h('div', null,
    h('div', { className: 'modal-icon' }, '🧾'),
    h('h3', { className: 'modal-title', text: 'Fechamento de caixa' }),
    h('p', { className: 'modal-sub', text: filtro === 'Todos' ? 'Todos os caixas deste aparelho' : filtro }),
    h('div', { className: 'fc-summary' },
      row('Vendas', String(t.count)),
      row('💵 Dinheiro', fmtMoney(t.dinheiro)),
      row('📱 Pix', fmtMoney(t.pix)),
      row('💳 Cartão', fmtMoney(t.cartao)),
      row('Total', fmtMoney(t.total), 'fc-total')
    ),
    h('p', { className: 'fc-note', text: 'Pix e cartão: confira no extrato do banco e na maquininha.' }),
    h('div', { className: 'form-row' }, h('label', { text: 'Fundo de troco no início (R$)' }), fundoInput),
    h('div', { className: 'fc-row' }, h('span', { text: 'Dinheiro esperado na gaveta' }), esperadoEl),
    h('div', { className: 'form-row', style: 'margin-top:12px;' }, h('label', { text: 'Dinheiro contado na gaveta (R$)' }), contadoInput),
    diffBox,
    h('div', { className: 'modal-actions' },
      h('button', { className: 'btn-primary', type: 'button', onclick: exportarDados }, '⬇️ Exportar dados'),
      h('button', { className: 'modal-cancel', type: 'button', onclick: closeModal }, 'Fechar')
    )
  ));
  update();
}

/* ---------- Exportar / Importar ---------- */
function exportarDados() {
  var payload = { app: 'caixa-lual', version: 2, products: state.products, sales: state.sales, caixa: state.caixaName, exportedAt: new Date().toISOString() };
  var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  var a = h('a', { href: url, download: 'caixa-lual-' + (state.caixaName || 'dados').replace(/\s+/g, '_') + '-' + stamp + '.json' });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  showToast('Dados exportados');
}

function importarDados(event) {
  var file = event.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function (e) {
    try {
      var data = JSON.parse(e.target.result);
      var ids = {};
      state.sales.forEach(function (s) { ids[s.id] = true; });
      var newSales = (data.sales || []).filter(function (s) { return s && s.id && !ids[s.id]; });
      state.sales = state.sales.concat(newSales);
      state.sales.sort(function (a, b) { return a.timestamp < b.timestamp ? -1 : 1; });
      saveSales();

      var names = {};
      state.products.forEach(function (p) { names[p.name.toLowerCase()] = true; });
      (data.products || []).forEach(function (p) {
        if (p && p.name && !names[p.name.toLowerCase()]) { state.products.push(p); names[p.name.toLowerCase()] = true; }
      });
      saveProducts();

      populateFiltroCaixa(); renderRelatorio(); renderCategoryChips(); renderProductGrid(); renderTodayBar();
      showToast(newSales.length + ' venda(s) importada(s)');
    } catch (err) {
      showToast('Arquivo inválido');
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}

/* ---------- Config ---------- */
function salvarNomeCaixa() {
  var nome = el('caixaNomeInput').value.trim();
  if (!nome) { showToast('Digite um nome'); return; }
  state.caixaName = nome;
  lsSet(KEYS.caixa, nome);
  el('caixaBadge').textContent = nome;
  renderTodayBar();
  showToast('Nome do caixa salvo');
}

function resetarTudo() {
  if (!isAdmin()) { showToast('Só admins apagam os dados'); return; }
  var t = computeTotals('Todos');
  openModal(h('div', null,
    h('div', { className: 'modal-icon' }, '⚠️'),
    h('h3', { className: 'modal-title', text: 'Apagar tudo deste aparelho?' }),
    h('p', { className: 'modal-sub', text: 'Isso não tem volta. Confira o que vai ser apagado:' }),
    h('div', { className: 'fc-summary' },
      h('div', { className: 'fc-row' }, h('span', { text: 'Produtos cadastrados' }), h('span', { className: 'fc-val', text: String(state.products.length) })),
      h('div', { className: 'fc-row' }, h('span', { text: 'Vendas registradas' }), h('span', { className: 'fc-val', text: String(t.count) })),
      h('div', { className: 'fc-row fc-total' }, h('span', { text: 'Total em vendas' }), h('span', { className: 'fc-val', text: fmtMoney(t.total) }))
    ),
    t.count ? h('p', { className: 'fc-note', text: 'Recomendado: exporte os dados antes, pra não perder o relatório.' }) : null,
    h('div', { className: 'modal-actions' },
      t.count ? h('button', { className: 'btn-secondary', type: 'button', style: 'width:100%;', onclick: exportarDados }, '⬇️ Exportar antes') : null,
      h('button', {
        className: 'btn-primary btn-primary-danger', type: 'button', onclick: function () {
          state.products = []; state.sales = []; state.cart = [];
          saveProducts(); saveSales(); lsDel(KEYS.fundo);
          closeModal(); resetProductForm(); limparCarrinho();
          renderProductList(); renderCategoryChips(); renderProductGrid(); renderTodayBar();
          showToast('Dados apagados');
        }
      }, 'Apagar tudo'),
      h('button', { className: 'modal-cancel', type: 'button', onclick: closeModal }, 'Cancelar')
    )
  ));
}

/* ---------- Tela de descanso ---------- */
var IDLE_TIMEOUT_MS = 90000;
var idleTimer = null;

function dismissIdle() {
  el('idleScreen').classList.remove('active');
  resetIdleTimer();
}
function showIdleScreen() {
  if (isModalOpen()) { resetIdleTimer(); return; }
  el('idleScreen').classList.add('active');
}
function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(showIdleScreen, IDLE_TIMEOUT_MS);
}
['pointerdown', 'keydown'].forEach(function (evt) {
  document.addEventListener(evt, function () {
    if (!el('idleScreen').classList.contains('active')) resetIdleTimer();
  });
});

/* ---------- Init ---------- */
applyTheme(getSavedTheme());
loadState();
el('caixaBadge').textContent = state.caixaName;
renderCategoryChips();
renderProductGrid();
renderCart();
renderTodayBar();
resetIdleTimer();
checkGate();
applyNavVisibility();

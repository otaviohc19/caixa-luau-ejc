/* =========================================================
   Caixa luau — lógica do app (versão com Supabase)
   Dados (produtos, vendas, usuários) ficam no Supabase e são
   compartilhados entre todos os caixas. Precisa de internet.
   ========================================================= */

/* --- Configuração do Supabase -------------------------------------
   A chave "publishable" é PÚBLICA por natureza (pode ficar no código).
   Quem protege os dados são as regras (RLS) do banco — ver
   supabase/schema.sql. NUNCA coloque aqui a chave "secret"/service_role. */
var SUPABASE_URL = 'https://sxxpjgivnvgkdmxmvfar.supabase.co';
var SUPABASE_KEY = 'sb_publishable_GD3sTzj2-qe0RXf742tw1w_kF0feLPD';

/* O login é "usuário + senha", mas o Supabase Auth usa e-mail. O app
   completa com este domínio: "maria" vira "maria@luau.app".
   (Nenhum e-mail é enviado — é só um identificador.) */
var EMAIL_DOMAIN = 'luau.app';

var POLL_MS = 20000;        // de quanto em quanto tempo atualiza os dados
var REQUEST_TIMEOUT_MS = 15000;
var DAY_START_HOUR = 5;     // o "dia" vira às 5h (evento que passa da meia-noite)
var UNDO_WINDOW_MIN = 10;   // igual à regra sales_delete do banco

var KEYS = { theme: 'luau_theme', fundo: 'luau_fundo' };

var state = {
  products: [],
  sales: [],
  caixaName: '',
  cart: [],
  selectedCategory: 'Todos',
  payment: null,
  currentUser: null,   // { id, username, name, admin }
  editingId: null,
  comboDraft: [],
  saving: false,
  pendingSale: null,   // { id, sig } — deixa o "tentar de novo" idempotente
  mutations: 0,        // sobe a cada alteração local (evita resposta velha sobrescrever)
  loading: false,
  loaded: false
};

/* ---------- Storage local (só preferências deste aparelho) ---------- */
function lsGet(k, fallback) {
  try { var v = localStorage.getItem(k); return v === null ? fallback : v; } catch (e) { return fallback; }
}
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

/* ---------- Utils ---------- */
function el(id) { return document.getElementById(id); }
function fmtMoney(v) { return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  var b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  var s = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  return s.slice(0, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16) + '-' + s.slice(16, 20) + '-' + s.slice(20);
}
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
function dateTimeStr(iso) {
  var d = new Date(iso);
  return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + ' ' + timeStr(iso);
}
function dayKey(d) {
  var t = new Date(new Date(d).getTime() - DAY_START_HOUR * 3600 * 1000);
  return t.getFullYear() + '-' + (t.getMonth() + 1) + '-' + t.getDate();
}
function isToday(iso) { return dayKey(iso) === dayKey(Date.now()); }
function payLabel(p) { return p === 'dinheiro' ? 'Dinheiro' : (p === 'pix' ? 'Pix' : 'Cartão'); }
function summarizeItems(items) { return items.map(function (i) { return i.qty + 'x ' + i.name; }).join(', '); }
function showToast(msg) {
  var t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(function () { t.classList.remove('show'); }, 2600);
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

/* ---------- Supabase ---------- */
function fetchWithTimeout(url, opts) {
  opts = opts || {};
  var ctrl = new AbortController();
  var timer = setTimeout(function () { ctrl.abort(); }, REQUEST_TIMEOUT_MS);
  if (opts.signal) opts.signal.addEventListener('abort', function () { ctrl.abort(); });
  return fetch(url, Object.assign({}, opts, { signal: ctrl.signal })).finally(function () { clearTimeout(timer); });
}

if (!window.supabase || !window.supabase.createClient) {
  document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">Não foi possível carregar o app (arquivo vendor/supabase.js ausente). Confira se a pasta <b>vendor</b> foi publicada junto.</p>';
  throw new Error('supabase-js não carregou');
}
var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'luau-auth' },
  global: { fetch: fetchWithTimeout }
});

function isNetErr(e) {
  var m = String((e && (e.message || e.name)) || e || '').toLowerCase();
  return /failed to fetch|networkerror|network request|load failed|abort|timeout|fetch/.test(m);
}
function friendlyError(e) {
  if (isNetErr(e)) return 'Sem conexão com o servidor. Confira o wifi.';
  if (e && (e.code === '42501' || /row-level security|permission/i.test(e.message || ''))) return 'Sem permissão pra isso.';
  return (e && e.message) || 'Erro inesperado.';
}
function setOnline(ok) {
  var b = el('netBanner');
  if (b) b.style.display = ok ? 'none' : 'block';
}
/* Executa uma chamada do Supabase sem nunca lançar exceção. */
async function safe(fn) {
  try {
    var r = await fn();
    setOnline(!(r && r.error && isNetErr(r.error)));
    return r || { data: null, error: null };
  } catch (e) {
    if (isNetErr(e)) setOnline(false);
    return { data: null, error: e };
  }
}
/* Busca uma tabela inteira (o Supabase devolve no máximo 1000 linhas por vez). */
async function fetchAll(table, orderCol) {
  var out = [], from = 0, size = 1000;
  while (true) {
    var r = await safe(function () {
      return sb.from(table).select('*')
        .order(orderCol, { ascending: true }).order('id', { ascending: true })
        .range(from, from + size - 1);
    });
    if (r.error) return { data: null, error: r.error };
    out = out.concat(r.data || []);
    if (!r.data || r.data.length < size) break;
    from += size;
  }
  return { data: out, error: null };
}
function mapProduct(r) {
  return { id: r.id, name: r.name, price: Number(r.price), category: r.category, isCombo: !!r.is_combo, components: r.components || [] };
}
function mapSale(r) {
  return {
    id: r.id, userId: r.user_id, timestamp: r.created_at, items: r.items || [], total: Number(r.total),
    payment: r.payment, recebido: r.recebido === null ? null : Number(r.recebido),
    troco: r.troco === null ? null : Number(r.troco), caixa: r.caixa
  };
}

/* Carrega produtos e vendas. silent = não mostra aviso de erro (usado no polling). */
async function loadAll(silent) {
  if (state.loading || !state.currentUser) return false;
  state.loading = true;
  var version = state.mutations;
  var p = await fetchAll('products', 'created_at');
  var s = p.error ? { error: p.error } : await fetchAll('sales', 'created_at');
  state.loading = false;
  if (p.error || s.error) {
    if (!silent) showToast(friendlyError(p.error || s.error));
    return false;
  }
  if (version !== state.mutations) return false;   // algo mudou localmente durante a busca
  state.products = p.data.map(mapProduct);
  state.sales = s.data.map(mapSale);
  state.loaded = true;
  renderAll();
  return true;
}
function refreshData(manual) {
  loadAll(!manual).then(function (ok) { if (manual && ok) showToast('Atualizado'); });
}
function renderAll() {
  renderCategoryChips(); renderProductGrid(); renderTodayBar();
  var v = currentView();
  if (v === 'produtos') renderProductList();
  if (v === 'relatorio') { populateFiltroCaixa(); renderRelatorio(); }
}
var pollTimer = null;
function startPolling() {
  stopPolling();
  pollTimer = setInterval(function () { if (!document.hidden) loadAll(true); }, POLL_MS);
}
function stopPolling() { clearInterval(pollTimer); pollTimer = null; }
document.addEventListener('visibilitychange', function () { if (!document.hidden) loadAll(true); });
window.addEventListener('online', function () { loadAll(true); });

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
function isAdmin() { return !!(state.currentUser && state.currentUser.admin); }

function showGate(errMsg, showRetry) {
  el('gateScreen').classList.add('active');
  el('gateError').textContent = errMsg || '';
  el('gateRetry').style.display = showRetry ? 'block' : 'none';
  setTimeout(function () { el('gateUserInput').focus(); }, 100);
}
function hideGate() {
  el('gateScreen').classList.remove('active');
  el('gateError').textContent = '';
  el('gateUserInput').value = '';
  el('gatePassInput').value = '';
}
function setGateBusy(busy) {
  el('gateBtn').disabled = busy;
  el('gateBtn').textContent = busy ? 'Entrando…' : 'Entrar';
}

async function tentarLogin() {
  var user = el('gateUserInput').value.trim().toLowerCase();
  var pass = el('gatePassInput').value;
  if (!user || !pass) { el('gateError').textContent = 'Digite usuário e senha'; return; }
  var email = user.indexOf('@') !== -1 ? user : user + '@' + EMAIL_DOMAIN;
  setGateBusy(true);
  var r = await safe(function () { return sb.auth.signInWithPassword({ email: email, password: pass }); });
  setGateBusy(false);
  if (r.error) {
    var msg = isNetErr(r.error) ? friendlyError(r.error)
      : (r.error.status === 429 ? 'Muitas tentativas. Espere um minuto e tente de novo.' : 'Usuário ou senha incorretos');
    el('gateError').textContent = msg;
    el('gatePassInput').value = '';
    el('gatePassInput').focus();
    return;
  }
  await afterLogin(r.data.user);
}

/* Busca o perfil (nome + admin) e liga o app. Devolve true se entrou. */
async function afterLogin(user) {
  var pr = await safe(function () { return sb.from('profiles').select('*').eq('id', user.id).maybeSingle(); });
  if (pr.error && isNetErr(pr.error)) { showGate(friendlyError(pr.error), true); return false; }
  if (pr.error || !pr.data) {
    await safe(function () { return sb.auth.signOut({ scope: 'local' }); });
    showGate('Perfil não encontrado. Peça pro admin conferir a tabela profiles.');
    return false;
  }
  state.currentUser = { id: user.id, username: pr.data.username, name: pr.data.name, admin: !!pr.data.is_admin };
  state.caixaName = pr.data.name;
  el('caixaBadge').textContent = state.caixaName;
  hideGate();
  applyNavVisibility();
  doSwitchView('vender');
  renderAll();
  await loadAll(false);
  startPolling();
  return true;
}

async function boot() {
  el('gateRetry').style.display = 'none';
  var r = await safe(function () { return sb.auth.getSession(); });
  var session = r.data && r.data.session;
  if (!session) {
    showGate(r.error && isNetErr(r.error) ? friendlyError(r.error) : '', !!(r.error && isNetErr(r.error)));
    return;
  }
  await afterLogin(session.user);
}

function resetSession() {
  stopPolling();
  state.currentUser = null; state.products = []; state.sales = []; state.cart = [];
  state.payment = null; state.pendingSale = null; state.loaded = false; state.saving = false;
  closeModal();
  el('idleScreen').classList.remove('active');
  limparPagamento();
  renderCart(); renderCategoryChips(); renderProductGrid(); renderTodayBar();
  applyNavVisibility();
  doSwitchView('vender');
  showGate('');
}
async function fazerLogout() {
  await safe(function () { return sb.auth.signOut({ scope: 'local' }); });
  resetSession();
}
/* Se a sessão morrer sozinha (usuário removido, token inválido), volta pro login. */
sb.auth.onAuthStateChange(function (event) {
  if (event === 'SIGNED_OUT' && state.currentUser) setTimeout(resetSession, 0);
});
['gateUserInput', 'gatePassInput'].forEach(function (id) {
  el(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') tentarLogin(); });
});

function renderLoginSection() {
  var box = el('loginSection');
  box.innerHTML = '';
  var u = state.currentUser;
  box.appendChild(h('p', { className: 'pin-status on', text: '👤 Logado como ' + (u ? u.name : '?') + (u && u.admin ? ' (admin)' : ' (operador)') }));
  if (isAdmin()) {
    box.appendChild(h('p', { className: 'pin-status', style: 'margin-top:8px;', text: 'Pra adicionar ou remover gente, use Authentication → Users no painel do Supabase. O nome e o perfil de admin ficam na tabela profiles.' }));
  }
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
  el('resetDataCard').style.display = admin ? '' : 'none';
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
  if (name === 'relatorio') { populateFiltroCaixa(); renderRelatorio(); loadAll(true); }
  if (name === 'config') { applyTheme(getSavedTheme()); renderLoginSection(); applyNavVisibility(); }
  window.scrollTo(0, 0);
}

/* ---------- Vender ---------- */
function ownSales() {
  if (!state.currentUser) return [];
  return state.sales.filter(function (s) { return s.userId === state.currentUser.id; });
}
function lastOwnSale() {
  var mine = ownSales();
  return mine.length ? mine[mine.length - 1] : null;
}

function renderTodayBar() {
  var mine = ownSales().filter(function (s) { return isToday(s.timestamp); });
  var total = mine.reduce(function (s, x) { return s + x.total; }, 0);
  el('tbCount').textContent = mine.length;
  el('tbTotal').textContent = fmtMoney(total);
  el('undoBtn').style.display = lastOwnSale() ? 'block' : 'none';
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
  var hint = el('noProductsHint');
  if (!state.loaded) {
    hint.textContent = state.currentUser ? 'Carregando cardápio…' : '';
    hint.style.display = state.currentUser ? 'block' : 'none';
    return;
  }
  hint.textContent = isAdmin()
    ? 'Nenhum produto cadastrado ainda. Vá em "Produtos" pra cadastrar o cardápio.'
    : 'Nenhum produto cadastrado ainda. Peça pro admin cadastrar o cardápio.';
  hint.style.display = state.products.length ? 'none' : 'block';
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
  var valid = state.cart.length > 0 && !!state.payment && !state.saving;
  if (state.payment === 'dinheiro') {
    var recebido = parseMoney(el('recebidoInput').value);
    valid = valid && recebido > 0 && round2(recebido) >= cartTotalValue();
  }
  el('finalizeBtn').disabled = !valid;
}

function limparPagamento() {
  state.payment = null;
  document.querySelectorAll('.pay-btn').forEach(function (b) { b.classList.remove('selected'); });
  el('trocoBox').classList.remove('show');
  el('recebidoInput').value = '';
  el('trocoResult').textContent = '';
}
function limparCarrinho() {
  state.cart = [];
  state.pendingSale = null;
  limparPagamento();
  renderCart();
}

/* Assinatura do pedido: se o "tentar de novo" for do mesmo pedido, reaproveita o id
   (assim uma venda que chegou no servidor mas cuja resposta se perdeu não duplica). */
function saleSignature(recebido) {
  return JSON.stringify([
    state.cart.map(function (i) { return [i.productId, i.qty]; }),
    cartTotalValue(), state.payment, recebido
  ]);
}

async function finalizarVenda() {
  if (el('finalizeBtn').disabled || state.saving || !state.currentUser) return;
  var total = cartTotalValue();
  var recebido = state.payment === 'dinheiro' ? round2(parseMoney(el('recebidoInput').value)) : null;
  var sig = saleSignature(recebido);
  if (!state.pendingSale || state.pendingSale.sig !== sig) state.pendingSale = { id: uuid(), sig: sig };

  var row = {
    id: state.pendingSale.id,
    caixa: state.caixaName,
    payment: state.payment,
    total: total,
    recebido: recebido,
    troco: recebido !== null ? round2(recebido - total) : null,
    items: state.cart.map(function (i) {
      return { productId: i.productId, name: i.name, price: i.price, qty: i.qty, isCombo: i.isCombo, components: i.components };
    })
  };

  state.saving = true;
  el('finalizeBtn').disabled = true;
  el('finalizeBtn').textContent = 'Registrando…';
  var r = await safe(function () { return sb.from('sales').insert(row).select(); });
  state.saving = false;
  el('finalizeBtn').textContent = 'Finalizar venda';

  var duplicate = r.error && r.error.code === '23505';   // já tinha chegado numa tentativa anterior
  if (r.error && !duplicate) {
    updateFinalizeState();
    showToast('Venda NÃO registrada: ' + friendlyError(r.error) + ' O pedido continua aqui, tente de novo.');
    return;
  }
  state.mutations++;
  if (!duplicate && r.data && r.data[0]) state.sales.push(mapSale(r.data[0]));
  else loadAll(true);
  showToast('Venda registrada: ' + fmtMoney(total));
  limparCarrinho();
  renderTodayBar();
}

/* ---------- Desfazer última venda ---------- */
async function deleteSaleById(id) {
  var r = await safe(function () { return sb.from('sales').delete().eq('id', id).select(); });
  if (r.error) return { ok: false, msg: friendlyError(r.error) };
  if (!r.data || !r.data.length) {
    return { ok: false, msg: isAdmin() ? 'Venda não encontrada (talvez já tenha sido apagada).' : 'Só dá pra desfazer vendas dos últimos ' + UNDO_WINDOW_MIN + ' minutos.' };
  }
  state.mutations++;
  state.sales = state.sales.filter(function (x) { return x.id !== id; });
  return { ok: true };
}

function desfazerUltimaVenda() {
  var s = lastOwnSale();
  if (!s) return;
  var busy = false;
  function act(afterOk) {
    return async function () {
      if (busy) return;
      busy = true;
      var res = await deleteSaleById(s.id);
      busy = false;
      closeModal();
      renderTodayBar();
      if (!res.ok) { showToast(res.msg); return; }
      afterOk();
    };
  }
  openModal(h('div', null,
    h('div', { className: 'modal-icon' }, '↩️'),
    h('h3', { className: 'modal-title', text: 'Desfazer a última venda?' }),
    h('div', { className: 'undo-summary' },
      h('div', { className: 'us-items', text: summarizeItems(s.items) }),
      h('div', { className: 'us-meta', text: dateTimeStr(s.timestamp) + ' · ' + payLabel(s.payment) }),
      h('div', { className: 'us-total', text: fmtMoney(s.total) })
    ),
    s.payment === 'dinheiro'
      ? h('p', { className: 'modal-sub', text: 'Se for devolver ao cliente: ' + fmtMoney(s.total) + ' (o troco dado já foi descontado).' })
      : null,
    h('div', { className: 'modal-actions' },
      h('button', {
        className: 'btn-primary', type: 'button', onclick: act(function () {
          state.cart = s.items.map(function (i) {
            return { productId: i.productId || ('x' + uuid()), name: i.name, price: i.price, qty: i.qty, isCombo: !!i.isCombo, components: i.components || [] };
          });
          state.pendingSale = null;
          limparPagamento();
          renderCart();
          showToast('Venda desfeita — pedido voltou pro carrinho');
        })
      }, 'Desfazer e corrigir o pedido'),
      h('button', {
        className: 'btn-secondary', type: 'button', style: 'width:100%;', onclick: act(function () { showToast('Venda desfeita'); })
      }, 'Só desfazer'),
      h('button', { className: 'modal-cancel', type: 'button', onclick: closeModal }, 'Cancelar')
    )
  ));
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

async function salvarProduto() {
  if (!isAdmin() || state.saving) return;
  var nome = el('prodNome').value.trim();
  var preco = round2(parseMoney(el('prodPreco').value));
  var isCombo = el('prodCombo').checked;
  var cat = el('prodCategoria').value.trim() || (isCombo ? 'Combos' : 'Geral');
  if (!nome) { showToast('Digite o nome do produto'); return; }
  if (!(preco > 0)) { showToast('Digite um preço válido'); return; }
  if (isCombo && !state.comboDraft.length) { showToast('Adicione pelo menos um item ao combo'); return; }

  var row = { name: nome, price: preco, category: cat, is_combo: isCombo, components: isCombo ? state.comboDraft.slice() : [] };
  var editing = state.editingId;
  state.saving = true;
  el('salvarProdBtn').disabled = true;
  var r = await safe(function () {
    return editing
      ? sb.from('products').update(row).eq('id', editing).select()
      : sb.from('products').insert(row).select();
  });
  state.saving = false;
  el('salvarProdBtn').disabled = false;

  if (r.error) { showToast(friendlyError(r.error)); return; }
  if (!r.data || !r.data.length) { showToast('Não foi possível salvar (sem permissão ou produto removido).'); return; }
  state.mutations++;
  var saved = mapProduct(r.data[0]);
  if (editing) {
    state.products = state.products.map(function (p) { return p.id === editing ? saved : p; });
    showToast('Produto atualizado');
  } else {
    state.products.push(saved);
    showToast(isCombo ? 'Combo adicionado' : 'Produto adicionado');
  }
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
    onConfirm: async function () {
      var r = await safe(function () { return sb.from('products').delete().eq('id', id).select(); });
      if (r.error) { showToast(friendlyError(r.error)); return; }
      if (!r.data || !r.data.length) { showToast('Não foi possível excluir (sem permissão).'); return; }
      state.mutations++;
      state.products = state.products.filter(function (x) { return x.id !== id; });
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

function computeTotals(filtro, periodo) {
  var sales = state.sales.filter(function (s) {
    return (filtro === 'Todos' || s.caixa === filtro) && (periodo === 'tudo' || isToday(s.timestamp));
  });
  var t = { sales: sales, count: sales.length, total: 0, dinheiro: 0, pix: 0, cartao: 0 };
  sales.forEach(function (s) {
    t.total += s.total;
    if (t[s.payment] !== undefined) t[s.payment] += s.total;
  });
  ['total', 'dinheiro', 'pix', 'cartao'].forEach(function (k) { t[k] = round2(t[k]); });
  return t;
}
function currentFilters() {
  return { caixa: el('filtroCaixa').value || 'Todos', periodo: el('filtroPeriodo').value || 'hoje' };
}

function renderRelatorio() {
  var f = currentFilters();
  var t = computeTotals(f.caixa, f.periodo);
  el('repTotal').textContent = fmtMoney(t.total);
  el('repDinheiro').textContent = fmtMoney(t.dinheiro);
  el('repPix').textContent = fmtMoney(t.pix);
  el('repCartao').textContent = fmtMoney(t.cartao);
  el('repCount').textContent = t.count;

  var listEl = el('salesList');
  listEl.innerHTML = '';
  el('noSalesHint').style.display = t.count ? 'none' : 'block';
  var admin = isAdmin();
  t.sales.slice().reverse().forEach(function (s) {
    var summary = summarizeItems(s.items);
    listEl.appendChild(h('div', { className: 'sale-row' },
      h('div', { className: 'sr-left' },
        h('div', { text: summary.length > 34 ? summary.slice(0, 34) + '…' : summary }),
        h('div', { className: 'sr-time', text: (f.periodo === 'tudo' ? dateTimeStr(s.timestamp) : timeStr(s.timestamp)) + ' · ' + s.caixa })
      ),
      h('span', { className: 'sr-badge badge-' + s.payment, text: payLabel(s.payment) }),
      h('span', { className: 'sr-value', text: fmtMoney(s.total) }),
      admin
        ? h('button', { className: 'sr-del', type: 'button', 'aria-label': 'Apagar venda', onclick: function () { excluirVenda(s.id); } }, '✕')
        : h('span', { className: 'sr-del' })
    ));
  });
}

function excluirVenda(id) {
  var s = state.sales.find(function (x) { return x.id === id; });
  if (!s || !isAdmin()) return;
  confirmModal({
    icon: '🗑️', title: 'Apagar esta venda?',
    text: summarizeItems(s.items) + ' · ' + fmtMoney(s.total) + ' · ' + payLabel(s.payment) + ' · ' + dateTimeStr(s.timestamp) + ' · ' + s.caixa,
    confirmLabel: 'Apagar venda', danger: true,
    onConfirm: async function () {
      var res = await deleteSaleById(id);
      if (!res.ok) { showToast(res.msg); return; }
      populateFiltroCaixa(); renderRelatorio(); renderTodayBar();
      showToast('Venda apagada');
    }
  });
}

/* ---------- Fechamento de caixa ---------- */
function abrirFechamento() {
  var f = currentFilters();
  var t = computeTotals(f.caixa, f.periodo);

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
    h('p', { className: 'modal-sub', text: (f.caixa === 'Todos' ? 'Todos os caixas' : f.caixa) + ' · ' + (f.periodo === 'tudo' ? 'todo o período' : 'hoje') }),
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
      h('button', { className: 'btn-primary', type: 'button', onclick: exportarDados }, '⬇️ Exportar backup'),
      h('button', { className: 'modal-cancel', type: 'button', onclick: closeModal }, 'Fechar')
    )
  ));
  update();
}

/* ---------- Exportar (backup) ---------- */
function exportarDados() {
  var payload = { app: 'caixa-luau', version: 3, products: state.products, sales: state.sales, exportedBy: state.caixaName, exportedAt: new Date().toISOString() };
  var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  var a = h('a', { href: url, download: 'caixa-luau-backup-' + stamp + '.json' });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  showToast('Backup exportado');
}

/* ---------- Apagar todas as vendas (admin) ---------- */
function apagarVendas() {
  if (!isAdmin()) { showToast('Só admins apagam as vendas'); return; }
  var t = computeTotals('Todos', 'tudo');
  var typed = h('input', { type: 'text', placeholder: 'Digite APAGAR', autocomplete: 'off', autocapitalize: 'characters' });
  var goBtn = h('button', { className: 'btn-primary btn-primary-danger', type: 'button', disabled: 'disabled' }, 'Apagar todas as vendas');
  typed.addEventListener('input', function () {
    if (typed.value.trim().toUpperCase() === 'APAGAR') goBtn.removeAttribute('disabled');
    else goBtn.setAttribute('disabled', 'disabled');
  });
  goBtn.addEventListener('click', async function () {
    goBtn.setAttribute('disabled', 'disabled');
    var r = await safe(function () {
      return sb.from('sales').delete({ count: 'exact' }).neq('id', '00000000-0000-0000-0000-000000000000');
    });
    if (r.error) { showToast(friendlyError(r.error)); return; }
    state.mutations++;
    state.sales = [];
    lsDel(KEYS.fundo);
    closeModal();
    renderTodayBar(); populateFiltroCaixa(); renderRelatorio();
    showToast('Vendas apagadas');
  });
  openModal(h('div', null,
    h('div', { className: 'modal-icon' }, '⚠️'),
    h('h3', { className: 'modal-title', text: 'Apagar TODAS as vendas?' }),
    h('p', { className: 'modal-sub', text: 'Vale pra todos os caixas, não só este aparelho, e não tem volta.' }),
    h('div', { className: 'fc-summary' },
      h('div', { className: 'fc-row' }, h('span', { text: 'Vendas registradas' }), h('span', { className: 'fc-val', text: String(t.count) })),
      h('div', { className: 'fc-row fc-total' }, h('span', { text: 'Total em vendas' }), h('span', { className: 'fc-val', text: fmtMoney(t.total) }))
    ),
    t.count ? h('p', { className: 'fc-note', text: 'Recomendado: exporte um backup antes.' }) : null,
    h('div', { className: 'form-row' }, typed),
    h('div', { className: 'modal-actions' },
      t.count ? h('button', { className: 'btn-secondary', type: 'button', style: 'width:100%;', onclick: exportarDados }, '⬇️ Exportar backup antes') : null,
      goBtn,
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
  if (isModalOpen() || !state.currentUser) { resetIdleTimer(); return; }
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
renderCart();
renderTodayBar();
resetIdleTimer();
applyNavVisibility();
boot();

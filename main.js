/* Inicialização — roda por último, depois de script.js e admin.js carregarem. */
(function init() {
  document.querySelectorAll('.app-name').forEach(function (n) { n.textContent = APP_NAME; });
  document.title = APP_NAME;
  applyTheme(getSavedTheme());
  renderCart();
  renderTodayBar();
  renderEventInfo();
  resetIdleTimer();
  applyRole();
  boot();
})();

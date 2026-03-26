// ══════════════════════════════════════
// 공통 UI 유틸리티
// ══════════════════════════════════════
const UI = (() => {
  function $(id) { return document.getElementById(id); }

  function loading(containerId) {
    $(containerId).innerHTML = '<div class="loading-box"><div class="spinner"></div>불러오는 중...</div>';
  }

  function errorMsg(containerId, message) {
    $(containerId).innerHTML = `<div class="alert alert-red"><div class="dot dot-red"></div>서버 연결 오류: ${message}</div>`;
  }

  function alertHtml(type, message) {
    return `<div class="alert alert-${type}"><div class="dot dot-${type}"></div>${message}</div>`;
  }

  function badge(type, text) {
    return `<span class="badge badge-${type}">${text}</span>`;
  }

  function showModal(id) { $(id).classList.add('show'); }
  function hideModal(id) { $(id).classList.remove('show'); }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function thisMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function fmtDate(s) {
    const d = new Date(s);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function fmtMonth(m) {
    const [y, mo] = m.split('-');
    return `${y}년 ${parseInt(mo)}월`;
  }

  function yesterdayISO() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  async function checkConnection() {
    try {
      await Api.get('stocks', 'limit=1');
      $('syncDot').className = 'sync-dot ok';
    } catch {
      $('syncDot').className = 'sync-dot err';
    }
  }

  return { $, loading, errorMsg, alertHtml, badge, showModal, hideModal, todayISO, thisMonth, fmtDate, fmtMonth, yesterdayISO, checkConnection };
})();

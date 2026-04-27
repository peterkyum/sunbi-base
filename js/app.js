// ══════════════════════════════════════
// 앱 초기화 및 라우팅
// ══════════════════════════════════════
const App = (() => {
  async function init() {
    // 오늘 날짜 표시
    UI.$('todayStr').textContent = new Date().toLocaleDateString('ko-KR', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
    });

    // config 확인
    if (!window.SUNBI_CONFIG || !window.SUNBI_CONFIG.SB_URL) {
      UI.$('loginErr').textContent = '설정 파일(config.local.js)이 없습니다.';
      UI.$('loginBtn').disabled = true;
      return;
    }

    // 저장된 세션 복원 (토큰 갱신 완료까지 대기)
    const session = await Auth.restore();
    if (session) {
      await onLoginSuccess();
    }
  }

  async function loadSharedItems() {
    // 본사면 비어 있을 때 시드, 그 외엔 단순 refresh
    try {
      if (Auth.role === 'hq') await Items.seedIfEmpty();
      await Items.refresh();
    } catch (e) {
      console.warn('품목 동기화 실패, 캐시 사용:', e.message);
    }
  }

  async function onLoginSuccess() {
    UI.$('loginScreen').style.display = 'none';
    UI.$('appBody').style.display = 'block';

    await loadSharedItems();

    // 역할 배지
    const badge = UI.$('roleBadge');
    if (Auth.role === 'hq') {
      badge.textContent = '본사';
      badge.className = 'role-badge role-hq';
    } else {
      badge.textContent = '유통사';
      badge.className = 'role-badge role-dist';
    }

    // 탭 초기화
    document.querySelectorAll('.tab').forEach(t => { t.style.display = 'flex'; });

    if (Auth.role === 'dist') {
      // 유통사: 재고입력 탭만
      document.querySelectorAll('.tab').forEach((t, i) => {
        if (i !== 0) t.style.display = 'none';
      });
      goTab('input');
    } else {
      // 본사: 대시보드 기본
      document.querySelectorAll('.tab')[0].style.display = 'none';
      goTab('dash');
    }

    UI.checkConnection();
  }

  function goTab(name) {
    document.querySelectorAll('.sec').forEach(s => s.classList.remove('on'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
    const sec = UI.$('sec-' + name);
    if (sec) sec.classList.add('on');

    // 탭 버튼 활성화
    document.querySelectorAll('.tab').forEach(t => {
      if (t.dataset.tab === name) t.classList.add('on');
    });

    if (name === 'input') InputPage.render();
    if (name === 'dash') DashPage.render();
    if (name === 'order') OrderPage.render();
    if (name === 'inbound') InboundPage.render();
    if (name === 'history') HistoryPage.render();
  }

  async function handleLogin() {
    const email = UI.$('loginEmail').value.trim().toLowerCase();
    const pw = UI.$('loginPw').value;
    const btn = UI.$('loginBtn');
    const err = UI.$('loginErr');
    err.textContent = '';
    if (!email || !pw) { err.textContent = '이메일과 비밀번호를 입력해 주세요.'; return; }
    btn.disabled = true;
    btn.textContent = '로그인 중...';
    try {
      await Auth.login(email, pw);
      await onLoginSuccess();
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false;
      btn.textContent = '로그인';
    }
  }

  // 허브로 돌아가기: 새 탭(닫기) / iframe(부모 이동) / 직접 진입(허브 URL)
  function goBackToHub() {
    const HUB_URL = 'https://sunbi-hub.vercel.app';
    if (window.opener != null) {
      window.close(); // window.open으로 열린 새 탭 닫기
      return;
    }
    if (window.top !== window) {
      // iframe 안 — 부모(hub) 페이지를 허브로 이동
      try { window.top.location.href = HUB_URL; return; } catch (_) {}
    }
    // 직접 열린 경우 — 허브로 이동 (history 비어 있을 때 안전)
    window.location.href = HUB_URL;
  }

  return { init, onLoginSuccess, goTab, handleLogin, goBackToHub };
})();

// 앱 시작
document.addEventListener('DOMContentLoaded', App.init);

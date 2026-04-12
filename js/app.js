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
      onLoginSuccess();
    }
  }

  function onLoginSuccess() {
    UI.$('loginScreen').style.display = 'none';
    UI.$('appBody').style.display = 'block';

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
      onLoginSuccess();
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false;
      btn.textContent = '로그인';
    }
  }

  // 허브로 돌아가기: 모바일(탭 닫기) / 데스크탑(뒤로가기)
  function goBackToHub() {
    if (window.opener != null) {
      window.close(); // window.open으로 열린 새 탭 닫기
    } else {
      history.back(); // iframe 또는 일반 뒤로가기
    }
  }

  return { init, onLoginSuccess, goTab, handleLogin, goBackToHub };
})();

// 앱 시작
document.addEventListener('DOMContentLoaded', App.init);

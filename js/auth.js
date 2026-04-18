// ══════════════════════════════════════
// 인증 모듈 — 로그인/로그아웃/세션 관리
// ══════════════════════════════════════
const Auth = (() => {
  let currentUser = null;
  let currentRole = null; // 'dist' | 'hq'

  const cfg = () => window.SUNBI_CONFIG || {};

  const DIST_EMAILS = ['dist@sunbi.com'];
  const HQ_EMAILS   = ['hq@sunbi.com'];

  function getRole(email) {
    const e = email.toLowerCase().trim();
    if (HQ_EMAILS.some(h => h.toLowerCase() === e)) return 'hq';
    return 'dist';
  }

  async function login(email, password) {
    const res = await fetch(`${cfg().SB_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': cfg().SB_KEY },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.error_description || data.msg || '로그인 실패';
      throw new Error(msg === 'Invalid login credentials' ? '이메일 또는 비밀번호가 틀렸어요.' : msg);
    }

    Api.setToken(data.access_token);
    currentUser = data.user;
    currentRole = getRole(email);

    try {
      localStorage.setItem('sunbi_session', JSON.stringify({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        email: email.toLowerCase().trim(),
        role: currentRole
      }));
    } catch (e) {
      // localStorage 사용 불가 시 메모리 세션으로 동작
    }

    startAutoRefresh();
    return { user: currentUser, role: currentRole };
  }

  function logout() {
    stopAutoRefresh();
    Api.setToken(cfg().SB_KEY || '');
    currentUser = null;
    currentRole = null;
    try { localStorage.removeItem('sunbi_session'); } catch (e) { /* ignore */ }
  }

  // 허브 토큰이 아직 저장되지 않았을 때 짧은 대기 후 재시도
  async function waitForHubToken(maxWait) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const raw = localStorage.getItem('sunbi_hub_token');
      if (raw) return raw;
      await new Promise(r => setTimeout(r, 200));
    }
    return null;
  }

  async function restore() {
    try {
      // 1. 허브 공유 토큰 확인 (iframe에서는 항상 허브가 권위)
      let hubRaw = localStorage.getItem('sunbi_hub_token');
      // iframe 내부이면 허브가 토큰을 저장할 때까지 최대 2초 대기
      if (!hubRaw) {
        try {
          const inIframe = window.self !== window.top;
          if (inIframe) hubRaw = await waitForHubToken(2000);
        } catch (_) {
          hubRaw = await waitForHubToken(2000);
        }
      }
      if (hubRaw) {
        const hub = JSON.parse(hubRaw);
        if (hub && hub.access_token && hub.email) {
          Api.setToken(hub.access_token);
          currentUser = { email: hub.email };
          // 허브 역할 → sunbi-base 역할 매핑
          const hubRole = (hub.role || '').toLowerCase();
          if (hubRole === 'admin' || hubRole === 'hq' || hubRole === 'staff') {
            currentRole = 'hq';
          } else {
            currentRole = 'dist';
          }
          try {
            localStorage.setItem('sunbi_session', JSON.stringify({
              access_token: hub.access_token,
              refresh_token: hub.refresh_token || '',
              email: hub.email,
              role: currentRole
            }));
          } catch (_) { /* ignore */ }
          return { user: currentUser, role: currentRole };
        }
      }

      // 2. 허브 토큰 없으면 기존 세션으로 복원 (독립 실행 모드)
      const raw = localStorage.getItem('sunbi_session');
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!saved || !saved.access_token || !saved.role || !saved.email) return null;

      Api.setToken(saved.access_token);
      currentRole = saved.role;
      currentUser = { email: saved.email };

      const refreshed = await Api.refreshToken();
      if (!refreshed) {
        return null;
      }

      // 50분마다 토큰 자동 갱신 (JWT 기본 만료: 1시간)
      startAutoRefresh();

      return { user: currentUser, role: currentRole };
    } catch {
      return null;
    }
  }

  let refreshInterval = null;

  function startAutoRefresh() {
    stopAutoRefresh();
    refreshInterval = setInterval(async () => {
      const ok = await Api.refreshToken();
      if (!ok) {
        // 갱신 실패 시 허브로 돌아가기 (로그아웃은 허브에서만)
        App.goBackToHub();
      }
    }, 50 * 60 * 1000); // 50분
  }

  function stopAutoRefresh() {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  }

  // Hub iframe에서 postMessage로 세션 토큰 수신 (SSO)
  const HUB_ORIGIN = 'https://sunbi-hub.vercel.app';

  function listenForHubSession() {
    window.addEventListener('message', async (e) => {
      if (e.origin !== HUB_ORIGIN) return;
      if (!e.data || e.data.type !== 'SUNBI_HUB_SESSION') return;

      // 이미 유효한 세션이 있으면 hub 토큰 무시 (refresh_token 소비 방지)
      if (currentUser && currentRole) return;

      const { access_token, refresh_token } = e.data;
      if (!access_token || !refresh_token) return;

      try {
        const res = await fetch(`${cfg().SB_URL}/auth/v1/user`, {
          headers: { 'apikey': cfg().SB_KEY, 'Authorization': `Bearer ${access_token}` }
        });
        if (!res.ok) return;
        const user = await res.json();
        const email = (user.email || '').toLowerCase().trim();
        if (!email) return;

        Api.setToken(access_token);
        currentUser = user;
        currentRole = getRole(email);

        try {
          localStorage.setItem('sunbi_session', JSON.stringify({
            access_token,
            refresh_token,
            email,
            role: currentRole
          }));
        } catch (_) { /* ignore */ }

        startAutoRefresh();
        App.onLoginSuccess();
      } catch (_) { /* ignore */ }
    });
  }

  // Hub SSO: URL hash에서 토큰 읽기 (#access_token=xxx)
  async function checkUrlHashSSO() {
    const hash = window.location.hash;
    if (!hash || !hash.includes('access_token=')) return;

    // URL에서 hash 제거 (보안)
    history.replaceState(null, '', window.location.pathname + window.location.search);

    // 이미 유효한 세션이 있으면 hub 토큰 소비하지 않음 (세션 보호)
    try {
      const raw = localStorage.getItem('sunbi_session');
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && saved.access_token && saved.role) return;
      }
    } catch (_) { /* ignore */ }

    const params = new URLSearchParams(hash.substring(1));
    const token = params.get('access_token');
    const refreshToken = params.get('refresh_token') || '';
    if (!token) return;

    try {
      const res = await fetch(`${cfg().SB_URL}/auth/v1/user`, {
        headers: { 'apikey': cfg().SB_KEY, 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return;
      const user = await res.json();
      const email = (user.email || '').toLowerCase().trim();
      if (!email) return;

      Api.setToken(token);
      currentUser = user;
      currentRole = getRole(email);

      try {
        localStorage.setItem('sunbi_session', JSON.stringify({
          access_token: token,
          refresh_token: refreshToken,
          email,
          role: currentRole
        }));
      } catch (_) { /* ignore */ }

      startAutoRefresh();
      App.onLoginSuccess();
    } catch (_) { /* ignore */ }
  }

  // iframe 내부에서 자동 시작
  listenForHubSession();
  checkUrlHashSSO();

  return {
    login,
    restore,
    get user() { return currentUser; },
    get role() { return currentRole; },
  };
})();

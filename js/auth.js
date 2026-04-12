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

  async function restore() {
    try {
      const raw = localStorage.getItem('sunbi_session');
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!saved || !saved.access_token || !saved.role || !saved.email) return null;

      Api.setToken(saved.access_token);
      currentRole = saved.role;
      currentUser = { email: saved.email };

      // 토큰 갱신 — 실패 시 로그아웃
      const refreshed = await Api.refreshToken();
      if (!refreshed) {
        logout();
        return null;
      }

      // 50분마다 토큰 자동 갱신 (JWT 기본 만료: 1시간)
      startAutoRefresh();

      return { user: currentUser, role: currentRole };
    } catch {
      logout();
      return null;
    }
  }

  let refreshInterval = null;

  function startAutoRefresh() {
    stopAutoRefresh();
    refreshInterval = setInterval(async () => {
      const ok = await Api.refreshToken();
      if (!ok) {
        logout();
        location.reload();
      }
    }, 50 * 60 * 1000); // 50분
  }

  function stopAutoRefresh() {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  }

  return {
    login,
    logout,
    restore,
    get user() { return currentUser; },
    get role() { return currentRole; },
  };
})();

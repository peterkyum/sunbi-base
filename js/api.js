// ══════════════════════════════════════
// Supabase REST API 래퍼
// 401 자동 재시도, 토큰 갱신 포함
// ══════════════════════════════════════
const Api = (() => {
  let sessionToken = '';

  const cfg = () => window.SUNBI_CONFIG || {};
  const url = () => cfg().SB_URL;
  const key = () => cfg().SB_KEY;

  function headers() {
    return {
      'Content-Type': 'application/json',
      'apikey': key(),
      'Authorization': `Bearer ${sessionToken || key()}`
    };
  }

  function setToken(token) { sessionToken = token; }
  function getToken() { return sessionToken; }

  async function refreshToken() {
    try {
      const raw = localStorage.getItem('sunbi_session');
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (!saved || !saved.refresh_token) return false;
      const res = await fetch(`${url()}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': key() },
        body: JSON.stringify({ refresh_token: saved.refresh_token })
      });
      if (!res.ok) return false;
      const data = await res.json();
      sessionToken = data.access_token;
      localStorage.setItem('sunbi_session', JSON.stringify({
        ...saved,
        access_token: data.access_token,
        refresh_token: data.refresh_token
      }));
      return true;
    } catch {
      return false;
    }
  }

  async function request(method, table, query, body, extraHeaders) {
    const opts = { method, headers: { ...headers(), ...extraHeaders } };
    if (body) opts.body = JSON.stringify(body);
    const endpoint = `${url()}/rest/v1/${table}?${query || ''}`;

    let res = await fetch(endpoint, opts);

    if (res.status === 401) {
      const refreshed = await refreshToken();
      if (refreshed) {
        opts.headers = { ...headers(), ...extraHeaders };
        res = await fetch(endpoint, opts);
      } else {
        // refresh_token도 만료됨 — 로그인 화면으로
        Auth.logout();
        location.reload();
        throw new Error('세션이 만료되었습니다. 다시 로그인해 주세요.');
      }
    }

    if (!res.ok) {
      const errText = await res.text();
      // JWT 만료 에러 (PostgREST PGRST303)
      try {
        const errObj = JSON.parse(errText);
        if (errObj.code === 'PGRST303' || errObj.message === 'JWT expired') {
          const refreshed = await refreshToken();
          if (refreshed) {
            opts.headers = { ...headers(), ...extraHeaders };
            res = await fetch(endpoint, opts);
            if (res.ok) return method === 'DELETE' ? null : res.json();
          }
          Auth.logout();
          location.reload();
          throw new Error('세션이 만료되었습니다. 다시 로그인해 주세요.');
        }
      } catch (parseErr) {
        // JSON 파싱 실패 시 원본 에러 전달
      }
      throw new Error(errText);
    }

    if (method === 'DELETE') return null;
    return res.json();
  }

  const repr = { 'Prefer': 'return=representation' };

  return {
    setToken,
    getToken,
    refreshToken,
    get(table, query)       { return request('GET', table, query, null, repr); },
    insert(table, data)     { return request('POST', table, '', data, repr); },
    upsert(table, data, on) { return request('POST', table, `on_conflict=${on}`, data, { 'Prefer': 'resolution=merge-duplicates,return=representation' }); },
    delete(table, query)    { return request('DELETE', table, query, null, {}); },
    patch(table, query, data) { return request('PATCH', table, query, data, repr); },
  };
})();

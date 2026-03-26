# App Generator Skill

Supabase + PWA + Telegram 기반 모바일 웹앱을 자동 생성하는 스킬.

## 트리거 조건

사용자가 다음과 같이 요청할 때 활성화:
- "앱 만들어줘", "새 앱 생성", "PWA 만들어줘"
- "재고관리 앱", "주문관리 앱" 등 업무용 앱 요청
- "/app-generate" 명령어

## 생성되는 앱 구조

```
project-root/
├── index.html          # HTML 구조 + 인라인 최소 로딩 CSS
├── css/
│   └── style.css       # 전체 스타일시트
├── js/
│   ├── config.js       # 설정 로더 (config.local.js에서 읽기)
│   ├── api.js          # Supabase REST API 래퍼
│   ├── auth.js         # 로그인/로그아웃/세션 관리
│   ├── router.js       # 탭 네비게이션 라우터
│   ├── ui.js           # 공통 UI 헬퍼 (alert, modal, loading)
│   └── pages/          # 페이지별 모듈
│       ├── input.js    # 메인 입력 페이지
│       ├── dashboard.js # 대시보드
│       └── settings.js # 설정 페이지
├── config.local.js     # 환경 설정 (.gitignore)
├── sw.js               # Service Worker (PWA)
├── manifest.json       # PWA 매니페스트
├── icons/              # 앱 아이콘
└── .env                # 서버사이드 환경변수 (.gitignore)
```

## 생성 단계

### Step 1: 요구사항 수집

사용자에게 다음을 확인:

```
1. 앱 이름과 용도
2. 주요 데이터 모델 (어떤 데이터를 관리?)
3. 사용자 역할 (예: 관리자/일반사용자)
4. 외부 연동 (Telegram 알림, Google Sheets 백업 등)
5. 배포 환경 (GitHub Pages, Vercel 등)
```

### Step 2: Supabase 테이블 설계

요구사항에서 테이블 스키마를 자동 생성:

```sql
-- 예시: 재고관리 앱
CREATE TABLE stocks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  remain_qty INTEGER DEFAULT 0,
  consumed_qty INTEGER DEFAULT 0,
  submitted_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(date, item_id)
);

-- RLS 정책
ALTER TABLE stocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read" ON stocks
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can insert" ON stocks
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
```

### Step 3: config.local.js 템플릿

```javascript
// config.local.js (.gitignore에 추가)
window.APP_CONFIG = {
  APP_NAME: '앱 이름',

  // Supabase
  SB_URL: 'https://YOUR_PROJECT.supabase.co',
  SB_KEY: 'YOUR_ANON_KEY',

  // Telegram (선택)
  TELEGRAM_TOKEN: '',
  TELEGRAM_CHAT_ID: '',

  // Google Apps Script (선택)
  SCRIPT_URL: '',
  SPREADSHEET_ID: '',
};
```

### Step 4: API 래퍼 생성 (js/api.js)

```javascript
// js/api.js — Supabase REST API 래퍼
const Api = (() => {
  let sessionToken = '';

  const cfg = () => window.APP_CONFIG || {};
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
      const raw = localStorage.getItem('app_session');
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (!saved?.refresh_token) return false;
      const res = await fetch(`${url()}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': key() },
        body: JSON.stringify({ refresh_token: saved.refresh_token })
      });
      if (!res.ok) return false;
      const data = await res.json();
      sessionToken = data.access_token;
      localStorage.setItem('app_session', JSON.stringify({
        ...saved,
        access_token: data.access_token,
        refresh_token: data.refresh_token
      }));
      return true;
    } catch { return false; }
  }

  async function request(method, table, query = '', body = null, extraHeaders = {}) {
    const opts = {
      method,
      headers: { ...headers(), ...extraHeaders }
    };
    if (body) opts.body = JSON.stringify(body);

    let res = await fetch(`${url()}/rest/v1/${table}?${query}`, opts);

    // 401 자동 재시도
    if (res.status === 401 && await refreshToken()) {
      opts.headers = { ...headers(), ...extraHeaders };
      res = await fetch(`${url()}/rest/v1/${table}?${query}`, opts);
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText);
    }

    if (method === 'DELETE') return null;
    return res.json();
  }

  return {
    setToken,
    getToken,
    refreshToken,
    get:    (table, query) => request('GET', table, query, null, { 'Prefer': 'return=representation' }),
    insert: (table, data)  => request('POST', table, '', data, { 'Prefer': 'return=representation' }),
    upsert: (table, data, onConflict) => request('POST', table, `on_conflict=${onConflict}`, data, { 'Prefer': 'resolution=merge-duplicates,return=representation' }),
    delete: (table, query) => request('DELETE', table, query),
    patch:  (table, query, data) => request('PATCH', table, query, data, { 'Prefer': 'return=representation' }),
  };
})();
```

### Step 5: 인증 모듈 생성 (js/auth.js)

```javascript
// js/auth.js — 로그인/세션 관리
const Auth = (() => {
  let currentUser = null;
  let currentRole = null;

  const cfg = () => window.APP_CONFIG || {};

  // 역할 매핑 (config에서 로드)
  function getRole(email) {
    const roles = cfg().ROLES || {};
    for (const [role, emails] of Object.entries(roles)) {
      if (emails.some(e => e.toLowerCase() === email.toLowerCase())) return role;
    }
    return 'user'; // 기본 역할
  }

  async function login(email, password) {
    const res = await fetch(`${cfg().SB_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': cfg().SB_KEY },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || '로그인 실패');

    Api.setToken(data.access_token);
    currentUser = data.user;
    currentRole = getRole(email);

    localStorage.setItem('app_session', JSON.stringify({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      email: email.toLowerCase(),
      role: currentRole
    }));

    return { user: currentUser, role: currentRole };
  }

  function logout() {
    Api.setToken(cfg().SB_KEY || '');
    currentUser = null;
    currentRole = null;
    localStorage.removeItem('app_session');
  }

  async function restore() {
    try {
      const raw = localStorage.getItem('app_session');
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!saved?.access_token || !saved?.role || !saved?.email) return null;

      Api.setToken(saved.access_token);
      currentRole = saved.role;
      currentUser = { email: saved.email };

      // 백그라운드 토큰 갱신
      Api.refreshToken();

      return { user: currentUser, role: currentRole };
    } catch {
      logout();
      return null;
    }
  }

  return {
    login, logout, restore,
    get user() { return currentUser; },
    get role() { return currentRole; },
  };
})();
```

### Step 6: UI 헬퍼 (js/ui.js)

```javascript
// js/ui.js — 공통 UI 유틸리티
const UI = (() => {
  function $(id) { return document.getElementById(id); }

  function loading(containerId) {
    $(containerId).innerHTML = '<div class="loading-box"><div class="spinner"></div>불러오는 중...</div>';
  }

  function error(containerId, message) {
    $(containerId).innerHTML = `<div class="alert alert-red"><div class="dot dot-red"></div>${message}</div>`;
  }

  function alert(type, message) {
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

  return { $, loading, error, alert, badge, showModal, hideModal, todayISO, thisMonth, fmtDate };
})();
```

### Step 7: 라우터 (js/router.js)

```javascript
// js/router.js — 탭 기반 SPA 라우터
const Router = (() => {
  const routes = {};
  let currentTab = null;

  function register(name, { render, onEnter, onLeave }) {
    routes[name] = { render, onEnter, onLeave };
  }

  function go(name) {
    if (currentTab && routes[currentTab]?.onLeave) {
      routes[currentTab].onLeave();
    }

    document.querySelectorAll('.sec').forEach(s => s.classList.remove('on'));
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('on'));

    const sec = document.getElementById(`sec-${name}`);
    const tab = document.querySelector(`[data-tab="${name}"]`);
    if (sec) sec.classList.add('on');
    if (tab) tab.classList.add('on');

    currentTab = name;

    if (routes[name]?.render) routes[name].render();
    if (routes[name]?.onEnter) routes[name].onEnter();
  }

  function init(defaultTab) {
    document.querySelectorAll('.tab').forEach(btn => {
      btn.addEventListener('click', () => go(btn.dataset.tab));
    });
    go(defaultTab);
  }

  return { register, go, init, get current() { return currentTab; } };
})();
```

### Step 8: 외부 연동 (Telegram, Google Sheets)

```javascript
// js/notify.js — 외부 알림 연동
const Notify = (() => {
  const cfg = () => window.APP_CONFIG || {};

  async function telegram(text) {
    const token = cfg().TELEGRAM_TOKEN;
    const chatId = cfg().TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
      });
    } catch (e) {
      console.warn('Telegram 전송 실패:', e.message);
    }
  }

  async function googleSheet(payload) {
    const scriptUrl = cfg().SCRIPT_URL;
    if (!scriptUrl) return;

    try {
      await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          spreadsheetId: cfg().SPREADSHEET_ID,
          ...payload
        })
      });
    } catch (e) {
      console.warn('Google Sheet 전송 실패:', e.message);
    }
  }

  return { telegram, googleSheet };
})();
```

### Step 9: index.html 템플릿

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="theme-color" content="#7B4A1E">
  <link rel="manifest" href="manifest.json">
  <link rel="stylesheet" href="css/style.css">
  <title>앱 이름</title>
</head>
<body>
  <!-- 로그인 -->
  <div class="login-screen" id="loginScreen">
    <div class="login-card">
      <div class="login-title">앱 이름</div>
      <div class="login-sub">로그인해 주세요</div>
      <input class="login-input" id="loginEmail" type="email" placeholder="이메일">
      <input class="login-input" id="loginPw" type="password" placeholder="비밀번호">
      <div class="login-err" id="loginErr"></div>
      <button class="btn-main" id="loginBtn" onclick="Auth.login(
        document.getElementById('loginEmail').value,
        document.getElementById('loginPw').value
      ).then(onLoginSuccess).catch(e => document.getElementById('loginErr').textContent = e.message)">로그인</button>
    </div>
  </div>

  <!-- 앱 본문 -->
  <div id="appBody" style="display:none">
    <header class="topbar">
      <span class="topbar-title">앱 이름</span>
      <span class="topbar-date" id="todayStr"></span>
      <div class="sync-dot" id="syncDot"></div>
      <button class="logout-btn" onclick="onLogout()">로그아웃</button>
    </header>

    <div class="sec on" id="sec-main"><div id="mainPage"></div></div>
    <div class="sec" id="sec-dash"><div id="dashPage"></div></div>
    <div class="sec" id="sec-settings"><div id="settingsPage"></div></div>

    <nav class="tabs">
      <button class="tab on" data-tab="main"><span class="tab-icon">📦</span>메인</button>
      <button class="tab" data-tab="dash"><span class="tab-icon">📊</span>대시보드</button>
      <button class="tab" data-tab="settings"><span class="tab-icon">⚙️</span>설정</button>
    </nav>
  </div>

  <script src="config.local.js"></script>
  <script src="js/api.js"></script>
  <script src="js/auth.js"></script>
  <script src="js/ui.js"></script>
  <script src="js/router.js"></script>
  <script src="js/notify.js"></script>
  <script src="js/pages/input.js"></script>
  <script src="js/pages/dashboard.js"></script>
  <script src="js/app.js"></script>
</body>
</html>
```

### Step 10: Service Worker 템플릿

```javascript
const CACHE_NAME = 'app-v1';
const ASSETS = [
  './', './index.html', './css/style.css',
  './js/config.js', './js/api.js', './js/auth.js',
  './js/ui.js', './js/router.js', './js/notify.js',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('supabase.co') ||
      e.request.url.includes('api.telegram.org') ||
      e.request.url.includes('script.google.com')) {
    e.respondWith(fetch(e.request));
    return;
  }
  e.respondWith(caches.match(e.request).then(c => c || fetch(e.request)));
});
```

## 커스터마이징 포인트

| 항목 | 파일 | 설명 |
|------|------|------|
| 색상 테마 | css/style.css | CSS 변수 `:root` 섹션 |
| 데이터 모델 | js/pages/*.js | 각 페이지의 렌더 함수 |
| 역할 구분 | config.local.js | `ROLES` 객체 |
| 외부 알림 | js/notify.js | Telegram/Sheets 연동 |
| 품목 기본값 | js/pages/input.js | `DEFAULT_ITEMS` 배열 |

## 주의사항

- `config.local.js`는 반드시 `.gitignore`에 포함
- Supabase anon key는 RLS가 설정된 경우에만 공개 가능
- 하드코딩된 fallback 키 사용 금지 — config 없으면 에러 표시
- Service Worker 캐시명(`CACHE_NAME`)은 파일 변경 시 반드시 버전 업

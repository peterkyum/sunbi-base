# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

선비칼국수 재고관리 시스템 — 모바일 PWA 웹앱 + 텔레그램 봇 + Google Sheets 백업으로 구성된 재고 관리 앱.

## Architecture

```
유통사 담당자 → index.html (모바일 웹앱) → Supabase DB (주 저장소)
                    ↓                         ↓
              Telegram 알림            Google Sheets (백업)
                    ↑
본사 ← 텔레그램 메시지 → telegram_poller.py (60초 간격 LaunchAgent)
                              ↓
                        Google Apps Script → Google Sheets
```

## File Structure

```
sunbi-base/
├── index.html              # HTML 구조 (JS/CSS 외부 참조)
├── css/style.css           # 전체 스타일시트
├── js/
│   ├── api.js              # Supabase REST API 래퍼 (401 자동 재시도)
│   ├── auth.js             # 로그인/로그아웃/세션 관리
│   ├── ui.js               # 공통 UI 유틸리티 (날짜, 알림, 모달)
│   ├── items.js            # 품목 데이터 관리 (localStorage)
│   ├── notify.js           # 외부 알림 (Telegram + Google Sheets)
│   ├── app.js              # 앱 초기화, 라우팅, 로그인 플로우
│   └── pages/
│       ├── input.js        # 재고 입력 (유통사 전용)
│       ├── dashboard.js    # 대시보드 + 본사 수정/삭제
│       ├── order.js        # 자동 발주 분석
│       └── inbound.js      # 입고 관리 + 품목 추가
├── telegram_poller.py      # 텔레그램 메시지 파서
├── google-apps-script.js   # Google Apps Script (수동 배포)
├── sw.js                   # Service Worker (캐시: sunbi-v4)
├── config.local.js         # 환경 설정 (.gitignore)
├── .env                    # 폴러 환경변수 (.gitignore)
└── manifest.json           # PWA 매니페스트
```

## JS Module Dependencies (로드 순서)

```
config.local.js → api.js → auth.js → ui.js → items.js → notify.js
→ pages/input.js → pages/dashboard.js → pages/order.js → pages/inbound.js → app.js
```

전역 모듈: `Api`, `Auth`, `UI`, `Items`, `Notify`, `InputPage`, `DashPage`, `OrderPage`, `InboundPage`, `App`

## Key Data Flow

- **소진량 계산**: `이전 현재재고 - 이번 현재재고 = 소진량` (Apps Script의 findPrevRemain이 시트 역순 탐색)
- **웹앱 제출**: Supabase INSERT → Telegram 알림 → Google Sheets POST
- **텔레그램 입력**: 메시지 파싱 → Google Sheets POST → 텔레그램 확인 응답

## Configuration

두 개의 설정 파일 (둘 다 .gitignore):
- **config.local.js**: 웹앱용. `window.SUNBI_CONFIG` 객체로 SB_URL, SB_KEY, TELEGRAM_TOKEN, SCRIPT_URL 등 설정
- **.env**: telegram_poller.py용. 동일 키값을 환경변수 형식으로 저장

설정이 없으면 앱이 로그인 화면에서 에러 메시지를 표시함 (하드코딩 fallback 없음).

## Deployment

- **웹앱**: GitHub Pages (peterkyum.github.io/sunbi-base/). git push로 자동 배포. 빌드 과정 없음.
- **폴러**: macOS LaunchAgent (`~/Library/LaunchAgents/com.sunbi.telegram-poller.plist`). 60초 간격 실행. 실제 실행 파일은 `~/.sunbi/telegram_poller.py`. 상태 파일도 `~/.sunbi/last_update_id.txt`에 저장.
- **Apps Script**: Google Apps Script 편집기에서 수동 배포. URL 변경 시 .env와 config.local.js 모두 업데이트 필요.

## Auto-Commit Hook

`.claude/settings.local.json`에 PostToolUse 훅 설정됨. 파일 편집 시 자동으로 git add, commit, push 실행.

## Supabase Tables

- **stocks**: date, item_id, item_name, remain_qty, consumed_qty, submitted_by
- **inbound**: month, item_id, qty (월별 입고 누적)
- **orders**: order_date, item_count (발주 히스토리)

## Important Patterns

- 텔레그램 폴러는 봇 자신의 메시지와 알림 메시지("재고 입력 완료", "재고를 제출했어요")를 무시함 (중복 처리 방지)
- Google Apps Script POST 시 spreadsheetId를 반드시 포함해야 올바른 시트에 기록됨
- SpreadsheetApp.flush() 호출이 있어야 연속 POST 간 데이터 일관성 보장
- Service Worker 캐시명 변경 시 sw.js의 CACHE_NAME 버전 업데이트 필요
- 코드 수정 시 `cp telegram_poller.py ~/.sunbi/` 필요

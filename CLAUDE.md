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

**index.html**: 모놀리식 SPA (HTML+CSS+JS 단일 파일). 로그인, 재고입력, 대시보드, 자동발주, 본사관리 4탭 구성. Supabase PostgREST API 직접 호출.

**telegram_poller.py**: 텔레그램 메시지를 파싱하여 Google Sheets에 기록. 런타임 위치: `~/.sunbi/` (macOS TCC 보안으로 Documents 접근 차단 때문). 코드 수정 시 `cp telegram_poller.py ~/.sunbi/` 필요.

**google-apps-script.js**: Google Apps Script 웹앱으로 배포. `doPost()`가 POST 데이터를 받아 '재고기록' 시트에 기록하고, `findPrevRemain()`으로 소진량 자동 계산. 코드 변경 시 Apps Script 편집기에서 수동 배포 필요.

## Key Data Flow

- **소진량 계산**: `이전 현재재고 - 이번 현재재고 = 소진량` (Apps Script의 findPrevRemain이 시트 역순 탐색)
- **웹앱 제출**: Supabase INSERT → Telegram 알림 → Google Sheets POST
- **텔레그램 입력**: 메시지 파싱 → Google Sheets POST → 텔레그램 확인 응답

## Configuration

두 개의 설정 파일 (둘 다 .gitignore):
- **config.local.js**: 웹앱용. `window.SUNBI_CONFIG` 객체로 SB_URL, SB_KEY, TELEGRAM_TOKEN, SCRIPT_URL 등 설정
- **.env**: telegram_poller.py용. 동일 키값을 환경변수 형식으로 저장

## Deployment

- **웹앱**: GitHub Pages (peterkyum.github.io/sunbi-base/). git push로 자동 배포. 빌드 과정 없음.
- **폴러**: macOS LaunchAgent (`~/Library/LaunchAgents/com.sunbi.telegram-poller.plist`). 60초 간격 실행. 실제 실행 파일은 `~/.sunbi/telegram_poller.py`.
- **Apps Script**: Google Apps Script 편집기에서 수동 배포. URL 변경 시 .env와 config.local.js 모두 업데이트 필요.

## Auto-Commit Hook

`.claude/settings.local.json`에 PostToolUse 훅 설정됨. index.html, google-apps-script.js, telegram_poller.py 편집 시 자동으로 git add, commit, push 실행.

## Supabase Tables

- **stocks**: date, item_id, item_name, remain_qty, consumed_qty, submitted_by
- **inbound**: month, item_id, qty (월별 입고 누적)

## Important Patterns

- 텔레그램 폴러는 봇 자신의 메시지와 알림 메시지("재고 입력 완료", "재고를 제출했어요")를 무시함 (중복 처리 방지)
- Google Apps Script POST 시 spreadsheetId를 반드시 포함해야 올바른 시트에 기록됨
- SpreadsheetApp.flush() 호출이 있어야 연속 POST 간 데이터 일관성 보장
- Service Worker 캐시명 변경 시 sw.js의 CACHE_NAME 버전 업데이트 필요

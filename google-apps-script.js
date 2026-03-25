// ══════════════════════════════════════════════════════════════
// 선비칼국수 재고관리 - Google Apps Script
// 기능: POST 요청을 받아 '재고기록' 시트에 누적 기록
//       이전 현재재고 - 이번 현재재고 = 소진량 자동 계산
// ══════════════════════════════════════════════════════════════

const SHEET_NAME = '재고기록';

/**
 * HTTP POST 엔드포인트
 * index.html 의 sendToGoogleSheet() 또는 telegram_poller.py 에서 호출
 *
 * 예상 payload:
 * {
 *   "spreadsheetId": "...",   // optional, 배포된 스크립트 자신의 시트를 사용
 *   "date": "2026-03-25",
 *   "rows": [
 *     { "item_name": "비빔장소스", "remain_qty": 50, "consumed_qty": 5, "inbound_qty": 0 },
 *     ...
 *   ]
 * }
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const date    = payload.date  || getTodayKST();
    const rows    = payload.rows  || [];
    const action  = payload.action || 'record';

    if (!rows.length) {
      return jsonResponse({ success: false, error: 'rows is empty' });
    }

    const ss    = payload.spreadsheetId
                ? SpreadsheetApp.openById(payload.spreadsheetId)
                : SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateSheet(ss);

    ensureHeader(sheet);
    const timeStr = getTimeKST();

    // ── 삭제 기록 ──
    if (action === 'delete') {
      for (const row of rows) {
        const itemName = String(row.item_name || '').trim();
        const qty = Number(row.remain_qty) || 0;
        if (!itemName) continue;
        sheet.appendRow([date, itemName, '[삭제됨] ' + qty, '', '', timeStr + ' 본사삭제']);
      }
      SpreadsheetApp.flush();
      return jsonResponse({ success: true, action: 'delete' });
    }

    // ── 수정 기록 ──
    if (action === 'edit') {
      for (const row of rows) {
        const itemName = String(row.item_name || '').trim();
        const oldQty = Number(row.old_qty) || 0;
        const newQty = Number(row.new_qty) || 0;
        if (!itemName) continue;
        sheet.appendRow([date, itemName, newQty, '[수정] ' + oldQty + ' → ' + newQty, '', timeStr + ' 본사수정']);
      }
      SpreadsheetApp.flush();
      return jsonResponse({ success: true, action: 'edit' });
    }

    // ── 일반 재고 기록 ──
    const saved = [];
    for (const row of rows) {
      const itemName  = String(row.item_name  || '').trim();
      const remainQty = Number(row.remain_qty) || 0;
      const inboundQty = Number(row.inbound_qty) || 0;

      if (!itemName) continue;

      const prevRemain = findPrevRemain(sheet, itemName);
      const consumedQty = (prevRemain !== null) ? (prevRemain - remainQty) : null;

      sheet.appendRow([
        date,
        itemName,
        remainQty,
        consumedQty !== null ? consumedQty : '',
        inboundQty,
        timeStr
      ]);

      saved.push({
        item_name:    itemName,
        remain_qty:   remainQty,
        consumed_qty: consumedQty,
        inbound_qty:  inboundQty,
      });
    }

    SpreadsheetApp.flush();
    return jsonResponse({ success: true, saved });

  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

// ── GET 핸들러 (배포 테스트용) ──────────────────────────────
function doGet(e) {
  try {
    const action = e && e.parameter && e.parameter.action;
    if (action === 'debug') {
      const sid = e.parameter.sid;
      const ss = sid ? SpreadsheetApp.openById(sid) : SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(SHEET_NAME);
      if (!sheet) return jsonResponse({ error: 'no sheet' });
      const lastRow = sheet.getLastRow();
      const startRow = Math.max(2, lastRow - 9);
      const data = sheet.getRange(startRow, 1, lastRow - startRow + 1, 6).getValues();
      return jsonResponse({ lastRow: lastRow, rows: data });
    }
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
  return jsonResponse({ status: 'ok', message: '선비칼국수 재고관리 API 정상 작동 중' });
}

// ── 헬퍼 함수들 ────────────────────────────────────────────

/**
 * '재고기록' 시트를 가져오거나 없으면 생성
 */
function getOrCreateSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  return sheet;
}

/**
 * 헤더 행이 없으면 첫 행에 추가
 */
function ensureHeader(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['날짜', '품목명', '현재재고', '소진량', '입고량', '기록시각']);

    // 헤더 스타일 꾸미기
    const headerRange = sheet.getRange(1, 1, 1, 6);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#4A7C59');
    headerRange.setFontColor('#ffffff');
    sheet.setFrozenRows(1);

    // 컬럼 너비 조정
    sheet.setColumnWidth(1, 110);  // 날짜
    sheet.setColumnWidth(2, 140);  // 품목명
    sheet.setColumnWidth(3,  90);  // 현재재고
    sheet.setColumnWidth(4,  90);  // 소진량
    sheet.setColumnWidth(5,  80);  // 입고량
    sheet.setColumnWidth(6, 100);  // 기록시각
  }
}

/**
 * 시트를 역순으로 탐색하여 같은 품목의 직전 '현재재고'를 반환
 * 없으면 null 반환
 * 
 * 컬럼 순서: [날짜(1), 품목명(2), 현재재고(3), 소진량(4), 입고량(5), 기록시각(6)]
 */
function findPrevRemain(sheet, itemName) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;  // 헤더만 있거나 비어 있음

  // B열(품목명)과 C열(현재재고)를 한 번에 가져옴 (헤더 제외, 2행부터)
  const dataRange = sheet.getRange(2, 2, lastRow - 1, 2);
  const values    = dataRange.getValues();  // [[품목명, 현재재고], ...]

  // 역순으로 탐색 → 가장 최근 행부터
  for (let i = values.length - 1; i >= 0; i--) {
    const name  = String(values[i][0]).trim();
    const qty   = values[i][1];
    if (name === itemName && qty !== '' && qty !== null) {
      return Number(qty);
    }
  }
  return null;  // 이전 기록 없음
}

/**
 * KST 기준 오늘 날짜 반환 (YYYY-MM-DD)
 */
function getTodayKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return Utilities.formatDate(kst, 'UTC', 'yyyy-MM-dd');
}

/**
 * KST 기준 현재 시각 반환 (HH:mm)
 */
function getTimeKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return Utilities.formatDate(kst, 'UTC', 'HH:mm');
}

/**
 * JSON ContentService 응답 생성
 */
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

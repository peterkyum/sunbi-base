// ══════════════════════════════════════════════════════════════
// 선비칼국수 재고관리 - Google Apps Script
// 기능: POST 요청을 받아 '재고기록' 시트에 누적 기록
//       이전 현재재고 - 이번 현재재고 = 소진량 자동 계산
//       매 기록 후 '월별집계' 시트를 자동 갱신
// ══════════════════════════════════════════════════════════════

const SHEET_NAME = '재고기록';
const SUMMARY_SHEET = '월별집계';

/**
 * HTTP POST 엔드포인트
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const date    = payload.date  || getTodayKST();
    const rows    = payload.rows  || [];
    const action  = payload.action || 'record';

    // ── 월별집계 수동 갱신 ──
    if (action === 'refresh') {
      const ss2 = payload.spreadsheetId
                ? SpreadsheetApp.openById(payload.spreadsheetId)
                : SpreadsheetApp.getActiveSpreadsheet();
      const sheet2 = ss2.getSheetByName(SHEET_NAME);
      if (!sheet2) return jsonResponse({ success: false, error: 'no record sheet' });
      updateSummary(ss2, sheet2);
      return jsonResponse({ success: true, action: 'refresh' });
    }

    if (!rows.length) {
      return jsonResponse({ success: false, error: 'rows is empty' });
    }

    const ss    = payload.spreadsheetId
                ? SpreadsheetApp.openById(payload.spreadsheetId)
                : SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateSheet(ss, SHEET_NAME);

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

    // ── 발주 기록 ──
    if (action === 'order') {
      const orderSheet = getOrCreateSheet(ss, '발주기록');
      if (orderSheet.getLastRow() === 0) {
        orderSheet.appendRow(['발주일', '품목명', '발주수량', '현재재고', '월평균사용량', '기록시각']);
        const hr = orderSheet.getRange(1, 1, 1, 6);
        hr.setFontWeight('bold').setBackground('#2D5A8E').setFontColor('#ffffff');
        orderSheet.setFrozenRows(1);
      }
      for (const row of rows) {
        const itemName = String(row.item_name || '').trim();
        const orderQty = Number(row.order_qty) || 0;
        const currentQty = Number(row.current_qty) || 0;
        const avgUsage = Number(row.avg_usage) || 0;
        if (!itemName) continue;
        orderSheet.appendRow([date, itemName, orderQty, currentQty, avgUsage, timeStr]);
      }
      SpreadsheetApp.flush();
      return jsonResponse({ success: true, action: 'order', count: rows.length });
    }

    // ── 재고 조정 기록 ──
    if (action === 'adjust') {
      for (const row of rows) {
        const itemName = String(row.item_name || '').trim();
        const remainQty = Number(row.remain_qty) || 0;
        const consumedQty = Number(row.consumed_qty) || 0;
        if (!itemName) continue;
        sheet.appendRow([date, itemName, remainQty, '[조정] ' + consumedQty, '', timeStr + ' 본사조정']);
      }
      SpreadsheetApp.flush();
      return jsonResponse({ success: true, action: 'adjust' });
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

    // 월별집계 자동 갱신
    let summaryError = null;
    try {
      updateSummary(ss, sheet);
    } catch (err) {
      summaryError = err.message;
    }

    return jsonResponse({ success: true, saved, summaryError });

  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

// ── GET 핸들러 ──────────────────────────────────────────────
function doGet(e) {
  try {
    const action = e && e.parameter && e.parameter.action;

    // 집계 수동 실행
    if (action === 'refresh') {
      const sid = e.parameter.sid;
      const ss = sid ? SpreadsheetApp.openById(sid) : SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(SHEET_NAME);
      if (!sheet) return jsonResponse({ error: 'no sheet' });
      updateSummary(ss, sheet);
      return jsonResponse({ success: true, message: '월별집계 갱신 완료' });
    }

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

// ══════════════════════════════════════════════════════════════
// 월별집계 자동 생성
// ══════════════════════════════════════════════════════════════

/**
 * '재고기록' 원시 데이터를 분석하여 '월별집계' 시트를 자동 갱신
 *
 * 집계 내용:
 * - 월별 품목별 입고수량
 * - 월별 품목별 소진량(누적 사용량)
 * - 월별 품목별 월말 재고
 */
function updateSummary(ss, recordSheet) {
  const lastRow = recordSheet.getLastRow();
  if (lastRow <= 1) return;

  // 전체 데이터 읽기 (헤더 제외)
  const data = recordSheet.getRange(2, 1, lastRow - 1, 6).getValues();
  // [날짜, 품목명, 현재재고, 소진량, 입고량, 기록시각]

  // 월별 품목별 집계
  const months = {};    // { '2026-03': { '비빔장소스': { inbound, consumed, lastRemain, lastDate } } }
  const itemSet = {};   // 전체 품목 목록

  for (const row of data) {
    const dateStr = String(row[0]).trim();
    const itemName = String(row[1]).trim();
    const remain = row[2];
    const consumed = row[3];
    const inbound = row[4];

    if (!dateStr || !itemName) continue;
    // 삭제/수정 기록은 집계에서 제외
    if (String(remain).includes('삭제') || String(consumed).includes('수정')) continue;

    const month = dateStr.slice(0, 7); // 'YYYY-MM'
    if (!months[month]) months[month] = {};
    if (!months[month][itemName]) {
      months[month][itemName] = { inbound: 0, consumed: 0, lastRemain: 0, lastDate: '' };
    }

    const entry = months[month][itemName];
    const numRemain = Number(remain) || 0;
    const numConsumed = Number(consumed) || 0;
    const numInbound = Number(inbound) || 0;

    entry.inbound += numInbound;
    if (numConsumed > 0) entry.consumed += numConsumed;

    // 가장 최근 날짜의 재고를 월말 재고로 사용
    if (dateStr >= entry.lastDate) {
      entry.lastRemain = numRemain;
      entry.lastDate = dateStr;
    }

    itemSet[itemName] = true;
  }

  // 정렬
  const sortedMonths = Object.keys(months).sort();
  const sortedItems = Object.keys(itemSet).sort();

  if (sortedMonths.length === 0 || sortedItems.length === 0) return;

  // 집계 시트 생성/초기화
  let sumSheet = ss.getSheetByName(SUMMARY_SHEET);
  if (!sumSheet) {
    sumSheet = ss.insertSheet(SUMMARY_SHEET);
  } else {
    sumSheet.clear();
  }

  // ── 섹션 1: 월별 품목별 입고수량 ──
  let row = 1;
  sumSheet.getRange(row, 1).setValue('[ 월별 품목별 입고수량 ]')
    .setFontWeight('bold').setFontSize(12).setFontColor('#0C447C');
  row++;

  // 헤더: 월 | 품목1 | 품목2 | ...
  const header1 = ['월'].concat(sortedItems);
  sumSheet.getRange(row, 1, 1, header1.length).setValues([header1])
    .setFontWeight('bold').setBackground('#E6F1FB');
  row++;

  for (const m of sortedMonths) {
    const vals = [m];
    for (const item of sortedItems) {
      vals.push(months[m][item] ? months[m][item].inbound : 0);
    }
    sumSheet.getRange(row, 1, 1, vals.length).setValues([vals]);
    row++;
  }

  row += 2;

  // ── 섹션 2: 월별 품목별 소진량 (누적 사용량) ──
  sumSheet.getRange(row, 1).setValue('[ 월별 품목별 소진량 (누적 사용량) ]')
    .setFontWeight('bold').setFontSize(12).setFontColor('#A32D2D');
  row++;

  const header2 = ['월'].concat(sortedItems).concat(['합계']);
  sumSheet.getRange(row, 1, 1, header2.length).setValues([header2])
    .setFontWeight('bold').setBackground('#FCEBEB');
  row++;

  // 누적 합계용
  const totalConsumed = {};
  sortedItems.forEach(item => { totalConsumed[item] = 0; });

  for (const m of sortedMonths) {
    const vals = [m];
    let rowTotal = 0;
    for (const item of sortedItems) {
      const c = months[m][item] ? months[m][item].consumed : 0;
      vals.push(c);
      totalConsumed[item] += c;
      rowTotal += c;
    }
    vals.push(rowTotal);
    sumSheet.getRange(row, 1, 1, vals.length).setValues([vals]);
    row++;
  }

  // 월평균 행
  const avgRow = ['월평균'];
  let avgTotal = 0;
  const monthCount = sortedMonths.length || 1;
  for (const item of sortedItems) {
    const avg = Math.round(totalConsumed[item] / monthCount);
    avgRow.push(avg);
    avgTotal += avg;
  }
  avgRow.push(avgTotal);
  sumSheet.getRange(row, 1, 1, avgRow.length).setValues([avgRow])
    .setFontWeight('bold').setBackground('#FAF0E4');
  row += 2;

  // ── 섹션 3: 월별 품목별 월말 재고 ──
  sumSheet.getRange(row, 1).setValue('[ 월별 품목별 월말 재고 ]')
    .setFontWeight('bold').setFontSize(12).setFontColor('#7B4A1E');
  row++;

  const header3 = ['월'].concat(sortedItems);
  sumSheet.getRange(row, 1, 1, header3.length).setValues([header3])
    .setFontWeight('bold').setBackground('#FAF0E4');
  row++;

  for (const m of sortedMonths) {
    const vals = [m];
    for (const item of sortedItems) {
      vals.push(months[m][item] ? months[m][item].lastRemain : '-');
    }
    sumSheet.getRange(row, 1, 1, vals.length).setValues([vals]);
    row++;
  }

  // 스타일 정리
  sumSheet.setColumnWidth(1, 100);
  for (let c = 2; c <= sortedItems.length + 2; c++) {
    sumSheet.setColumnWidth(c, 110);
  }
  sumSheet.setFrozenColumns(1);

  SpreadsheetApp.flush();
}


// ══════════════════════════════════════════════════════════════
// 헬퍼 함수들
// ══════════════════════════════════════════════════════════════

function getOrCreateSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function ensureHeader(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['날짜', '품목명', '현재재고', '소진량', '입고량', '기록시각']);
    const headerRange = sheet.getRange(1, 1, 1, 6);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#4A7C59');
    headerRange.setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 110);
    sheet.setColumnWidth(2, 140);
    sheet.setColumnWidth(3,  90);
    sheet.setColumnWidth(4,  90);
    sheet.setColumnWidth(5,  80);
    sheet.setColumnWidth(6, 100);
  }
}

function findPrevRemain(sheet, itemName) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;
  const dataRange = sheet.getRange(2, 2, lastRow - 1, 2);
  const values    = dataRange.getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    const name  = String(values[i][0]).trim();
    const qty   = values[i][1];
    if (name === itemName && qty !== '' && qty !== null && !String(qty).includes('삭제')) {
      return Number(qty);
    }
  }
  return null;
}

function getTodayKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return Utilities.formatDate(kst, 'UTC', 'yyyy-MM-dd');
}

function getTimeKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return Utilities.formatDate(kst, 'UTC', 'HH:mm');
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

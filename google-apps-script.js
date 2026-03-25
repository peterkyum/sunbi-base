// =============================================
// 설정값
// =============================================
const TELEGRAM_TOKEN = '8624851417:AAFohaEN56XVSJ5y67c94z88gSBcOPtBOoE';
const ALLOWED_CHAT_ID = '8774713020';
const SPREADSHEET_ID = '1ZSz3IAa8B--i4wSixq6gDkEUb4s-OV9j-C2HAl4sKAM';

// =============================================
// 1. 트리거 설정 (최초 1회만 실행)
// Apps Script 편집기에서 setupTrigger() 함수를 직접 실행하세요
// =============================================
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('pollTelegram')
    .timeBased()
    .everyMinutes(1)
    .create();
  Logger.log('✅ 1분 간격 텔레그램 폴링 트리거 설정 완료!');
}

// =============================================
// 2. 텔레그램 메시지 폴링 (매 1분 자동 실행)
// =============================================
function pollTelegram() {
  const props = PropertiesService.getScriptProperties();
  const lastUpdateId = parseInt(props.getProperty('lastUpdateId') || '0');

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&limit=10`;
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const data = JSON.parse(res.getContentText());

    if (!data.ok || !data.result.length) return;

    for (const update of data.result) {
      const msg = update.message;
      if (msg && msg.chat.id.toString() === ALLOWED_CHAT_ID && msg.text) {
        processInventoryMessage(msg.text);
      }
      props.setProperty('lastUpdateId', update.update_id.toString());
    }
  } catch (e) {
    Logger.log('폴링 오류: ' + e.message);
  }
}

// =============================================
// 3. 재고 메시지 파싱 및 처리
// =============================================
function processInventoryMessage(text) {
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const lines = text.trim().split('\n');

  const stocks = [];
  const inbounds = [];

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;

    // 입고 패턴: "금일 면대 120박스" 또는 "금일 면대 120박스 +8박스(샘플)"
    const inboundMatch = t.match(/금일\s+(.+?)\s+(\d+)\s*박스/);
    if (inboundMatch) {
      inbounds.push({ item_name: inboundMatch[1].trim(), qty: parseInt(inboundMatch[2]) });
      continue;
    }

    // 재고 패턴: "비빔장소스 34 박스" 또는 "비빔장소스 34박스"
    const stockMatch = t.match(/^(.+?)\s+(\d+)\s*박스/);
    if (stockMatch) {
      stocks.push({ item_name: stockMatch[1].trim(), remain_qty: parseInt(stockMatch[2]) });
    }
  }

  if (stocks.length === 0) return; // 재고 형식 메시지가 아닌 경우 무시

  saveStocksToSheet(today, stocks, inbounds);

  // 확인 메시지 답장
  const confirmLines = [`✅ <b>${today} 재고 입력 완료!</b>\n`];
  stocks.forEach(s => confirmLines.push(`• ${s.item_name}: ${s.remain_qty}박스`));
  if (inbounds.length > 0) {
    confirmLines.push('\n📦 <b>입고 기록:</b>');
    inbounds.forEach(i => confirmLines.push(`• ${i.item_name}: ${i.qty}박스`));
  }
  sendTelegramMessage(confirmLines.join('\n'));
}

// =============================================
// 4. 구글 시트 저장
// =============================================
function saveStocksToSheet(date, stocks, inbounds) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const ts = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');

  // 재고기록 시트
  let sheet = ss.getSheetByName('재고기록');
  if (!sheet) {
    sheet = ss.insertSheet('재고기록');
    sheet.appendRow(['날짜', '제품명', '현재재고(박스)', '소진량(박스)', '당일입고(박스)', '기록시간']);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#f3f3f3');
    sheet.setFrozenRows(1);
  }

  // 해당 날짜 기존 행 삭제
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const dates = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = dates.length - 1; i >= 0; i--) {
      if (dates[i][0] === date) sheet.deleteRow(i + 2);
    }
  }

  // 입고 매핑
  const inboundMap = {};
  inbounds.forEach(i => { inboundMap[i.item_name] = i.qty; });

  // 재고 행 추가
  stocks.forEach(s => {
    const inboundQty = inboundMap[s.item_name] || 0;
    sheet.appendRow([date, s.item_name, s.remain_qty, 0, inboundQty, ts]);
  });

  // 입고기록 시트 (입고가 있을 때만)
  if (inbounds.length > 0) {
    let ibSheet = ss.getSheetByName('입고기록');
    if (!ibSheet) {
      ibSheet = ss.insertSheet('입고기록');
      ibSheet.appendRow(['날짜', '제품명', '입고수량(박스)', '기록시간']);
      ibSheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#f3f3f3');
      ibSheet.setFrozenRows(1);
    }
    inbounds.forEach(i => ibSheet.appendRow([date, i.item_name, i.qty, ts]));
  }
}

// =============================================
// 5. 텔레그램 메시지 전송
// =============================================
function sendTelegramMessage(text) {
  UrlFetchApp.fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: ALLOWED_CHAT_ID, text: text, parse_mode: 'HTML' }),
    muteHttpExceptions: true
  });
}

// =============================================
// 6. 웹앱 POST 처리 (텔레그램 webhook + index.html 연동)
// =============================================
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // 텔레그램 webhook 메시지 처리
    if (data.update_id) {
      const msg = data.message;
      if (msg && msg.chat.id.toString() === ALLOWED_CHAT_ID && msg.text) {
        processInventoryMessage(msg.text);
      }
      return ContentService.createTextOutput('OK');
    }

    // index.html submitStocks() 처리 (기존 기능)
    const ss = SpreadsheetApp.openById(data.spreadsheetId);
    let sheet = ss.getSheetByName('재고기록');
    if (!sheet) {
      sheet = ss.insertSheet('재고기록');
      sheet.appendRow(['날짜', '제품명', '현재재고(박스)', '소진량(박스)', '당일입고(박스)', '기록시간']);
      sheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#f3f3f3');
      sheet.setFrozenRows(1);
    }
    const ts = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const dates = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = dates.length - 1; i >= 0; i--) {
        if (dates[i][0] === data.date) sheet.deleteRow(i + 2);
      }
    }
    data.rows.forEach(r => sheet.appendRow([data.date, r.item_name, r.remain_qty, r.consumed_qty, r.inbound_qty || 0, ts]));
    return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

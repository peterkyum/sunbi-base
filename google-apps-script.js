// ──────────────────────────────────────────────
// 선비칼국수 재고 구글 시트 자동 기록
// ──────────────────────────────────────────────
// [설치 방법]
// 1. 스프레드시트 → 확장 프로그램 → Apps Script 에서 이 코드 붙여넣기
// 2. 상단에서 실행할 함수를 [setup] 으로 선택 후 ▶ 실행 (최초 1회)
// 3. 배포 → 새 배포 → 웹 앱 → 액세스: 모든 사용자 → 배포
// ──────────────────────────────────────────────

const SHEET_NAME = '재고기록';

// ★ 최초 1회 실행 필요 (스프레드시트 ID 저장)
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  Logger.log('✅ 연결 완료: ' + ss.getName() + ' (' + ss.getId() + ')');
}

function getSpreadsheet() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('setup() 함수를 먼저 실행해 주세요.');
  return SpreadsheetApp.openById(id);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = getSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      const header = ['날짜', '제품명', '현재재고(박스)', '소진량(박스)', '당일입고(박스)', '기록시간'];
      sheet.appendRow(header);
      sheet.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#f3f3f3');
      sheet.setFrozenRows(1);
    }

    const timestamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');

    // 같은 날짜 기존 행 삭제 (재제출 시 덮어쓰기)
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const dateCol = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = dateCol.length - 1; i >= 0; i--) {
        if (dateCol[i][0] === data.date) {
          sheet.deleteRow(i + 2);
        }
      }
    }

    data.rows.forEach(row => {
      sheet.appendRow([
        data.date,
        row.item_name,
        row.remain_qty,
        row.consumed_qty,
        row.inbound_qty || 0,
        timestamp
      ]);
    });

    return ContentService
      .createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

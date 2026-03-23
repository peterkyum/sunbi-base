// ──────────────────────────────────────────────
// 선비칼국수 재고 구글 시트 자동 기록
// ──────────────────────────────────────────────
// [설치 방법]
// 1. https://script.google.com 접속 → 새 프로젝트
// 2. 이 코드 전체 붙여넣기
// 3. 상단 메뉴 → 배포 → 새 배포
//    - 유형: 웹 앱
//    - 액세스: 모든 사용자
// 4. 배포 URL 복사 → index.html의 GOOGLE_SCRIPT_URL에 붙여넣기
// ──────────────────────────────────────────────

const SHEET_NAME = '재고기록';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);

    // 시트가 없으면 새로 생성 + 헤더 추가
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      const header = ['날짜', '제품명', '현재재고(박스)', '소진량(박스)', '당일입고(박스)', '기록시간'];
      sheet.appendRow(header);
      sheet.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#f3f3f3');
      sheet.setFrozenRows(1);
    }

    const timestamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');

    // 같은 날짜 기존 행 삭제 (중복 방지 - 재제출 시 덮어쓰기)
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const dateCol = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = dateCol.length - 1; i >= 0; i--) {
        if (dateCol[i][0] === data.date) {
          sheet.deleteRow(i + 2);
        }
      }
    }

    // 새 행 추가
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

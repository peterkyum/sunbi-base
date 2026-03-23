// ──────────────────────────────────────────────
// 선비칼국수 재고 구글 시트 자동 기록
// ──────────────────────────────────────────────
// [설치 방법 - 반드시 이 순서로!]
// 1. Google Drive에서 새 스프레드시트 생성
// 2. 스프레드시트 열고 → 상단 메뉴 [확장 프로그램] → [Apps Script]
// 3. 이 코드 전체 붙여넣기 (기존 코드 삭제 후)
// 4. 저장 (Ctrl+S)
// 5. 상단 [배포] → [새 배포]
//    - 유형: 웹 앱
//    - 실행 계정: 나 (본인 계정)
//    - 액세스: 모든 사용자
// 6. 배포 클릭 → URL 복사 → index.html의 GOOGLE_SCRIPT_URL에 붙여넣기
// ──────────────────────────────────────────────

const SHEET_NAME = '재고기록';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
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

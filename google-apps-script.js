function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.openById(data.spreadsheetId);
    let sheet = ss.getSheetByName('재고기록');
    if (!sheet) {
      sheet = ss.insertSheet('재고기록');
      sheet.appendRow(['날짜','제품명','현재재고(박스)','소진량(박스)','당일입고(박스)','기록시간']);
      sheet.getRange(1,1,1,6).setFontWeight('bold').setBackground('#f3f3f3');
      sheet.setFrozenRows(1);
    }
    const ts = Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm:ss');
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const dates = sheet.getRange(2,1,lastRow-1,1).getValues();
      for (let i = dates.length-1; i >= 0; i--) {
        if (dates[i][0] === data.date) sheet.deleteRow(i+2);
      }
    }
    data.rows.forEach(r => sheet.appendRow([data.date, r.item_name, r.remain_qty, r.consumed_qty, r.inbound_qty||0, ts]));
    return ContentService.createTextOutput(JSON.stringify({success:true})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({success:false,error:err.message})).setMimeType(ContentService.MimeType.JSON);
  }
}

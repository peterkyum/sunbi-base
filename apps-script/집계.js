/**
 * 본사 물품 재고기록 - 집계 시트 자동 생성
 *
 * 생성되는 탭:
 *   1) 월별누적     - 제품별 월간 소진량 (2026.03, 2026.04 ...)
 *   2) 주별누적     - 제품별 주간 소진량 (ISO 주번호)
 *   3) 일별누적     - 제품별 일간 소진량
 *   4) 월Top10      - 월별 소진량 순위 Top 10
 *   5) 월별입고소진 - 제품별 월간 입고 vs 소진 비교 (차이=재고변동)
 *
 * 사용법:
 *   1. 시트 열기 → 확장 프로그램 → Apps Script
 *   2. 이 파일 내용 전체를 붙여넣고 저장 (Cmd+S)
 *   3. 상단 함수 목록에서 generateAggregations 선택 후 실행
 *   4. 최초 1회 권한 승인 필요
 *   5. 데이터가 추가되면 다시 실행하면 갱신됨
 */

const SOURCE_SHEET = '재고기록';

/**
 * 시트 열 때마다 자동 호출 - 상단에 "📊 집계" 메뉴 생성
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 집계')
    .addItem('집계 새로고침 (월별/주별/일별/Top10/입고소진)', 'generateAggregations')
    .addToUi();
}

/**
 * 집계 핵심 로직 (UI 없음 — 트리거/메뉴 양쪽에서 재사용).
 * @return {number} 집계에 사용된 유효 행 수 (0이면 데이터 없음)
 */
function refreshAllAggregations(ss) {
  const source = ss.getSheetByName(SOURCE_SHEET);
  if (!source) throw new Error(`"${SOURCE_SHEET}" 탭을 찾을 수 없습니다.`);

  const lastRow = source.getLastRow();
  if (lastRow < 2) return 0;

  const raw = source.getRange(2, 1, lastRow - 1, 5).getValues();
  const rows = [];
  raw.forEach(([date, product, _stock, consumption, inflow]) => {
    if (!date || !product) return;
    const d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return;
    rows.push({
      date: d,
      product: String(product).trim(),
      consumption: (typeof consumption === 'number' && isFinite(consumption) && consumption > 0) ? consumption : 0,
      inflow: (typeof inflow === 'number' && isFinite(inflow)) ? inflow : 0,
    });
  });

  if (rows.length === 0) return 0;

  const tz = ss.getSpreadsheetTimeZone();
  const products = [...new Set(rows.map(r => r.product))].sort((a, b) => a.localeCompare(b, 'ko'));

  const monthKey = d => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  const weekKey  = d => isoWeekKey(d);
  const dayKey   = d => Utilities.formatDate(d, tz, 'yyyy-MM-dd');

  buildPivot(ss, '월별누적', products, rows, monthKey, 'consumption');
  buildPivot(ss, '주별누적', products, rows, weekKey,  'consumption');
  buildPivot(ss, '일별누적', products, rows, dayKey,   'consumption');
  buildMonthlyTop10(ss, '월Top10', rows, monthKey);
  buildInOutCompare(ss, '월별입고소진', products, rows, monthKey);

  return rows.length;
}

/** 메뉴(📊 집계)용 — 결과를 alert로 안내 */
function generateAggregations() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    const n = refreshAllAggregations(ss);
    SpreadsheetApp.getUi().alert(
      n === 0 ? '유효한 데이터가 없습니다.'
              : '집계 완료: 월별누적 / 주별누적 / 일별누적 / 월Top10 / 월별입고소진');
  } catch (err) {
    SpreadsheetApp.getUi().alert(err.message);
  }
}

/** 매일 자동 실행되는 트리거 진입점 (UI 없음) */
function dailyAggregationJob() {
  refreshAllAggregations(SpreadsheetApp.getActiveSpreadsheet());
}

/**
 * 1회만 실행하면 됨: ① 지금 즉시 집계 갱신 + ② 매일 05시 자동 갱신 트리거 설치.
 * (이미 설치돼 있으면 중복 트리거를 제거 후 재설치)
 */
function setupDailyAggregation() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyAggregationJob')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyAggregationJob').timeBased().everyDays(1).atHour(5).create();
  refreshAllAggregations(SpreadsheetApp.getActiveSpreadsheet());
}

function isoWeekKey(d) {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  const jan1 = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  let firstThursdayJan = jan1;
  if (jan1.getUTCDay() !== 4) {
    firstThursdayJan = new Date(Date.UTC(target.getUTCFullYear(), 0, 1 + ((4 - jan1.getUTCDay()) + 7) % 7));
  }
  const weekNo = 1 + Math.round((firstThursday - firstThursdayJan.valueOf()) / 604800000);
  return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function buildPivot(ss, sheetName, products, rows, keyFn, field) {
  let sheet = ss.getSheetByName(sheetName);
  if (sheet) sheet.clear(); else sheet = ss.insertSheet(sheetName);

  const periods = [...new Set(rows.map(r => keyFn(r.date)))].sort();
  const header = ['제품명', '합계', ...periods];

  const matrix = products.map(product => {
    const productRows = rows.filter(r => r.product === product);
    const cells = periods.map(p =>
      productRows.filter(r => keyFn(r.date) === p)
                 .reduce((sum, r) => sum + r[field], 0)
    );
    const total = cells.reduce((s, v) => s + v, 0);
    return [product, total, ...cells];
  });

  const totalRow = ['합계',
    matrix.reduce((s, r) => s + r[1], 0),
    ...periods.map((_, i) => matrix.reduce((s, r) => s + r[i + 2], 0)),
  ];

  const values = [header, ...matrix, totalRow];
  sheet.getRange(1, 1, values.length, values[0].length).setValues(values);

  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);
  sheet.getRange(1, 1, 1, values[0].length).setFontWeight('bold').setBackground('#e8e8e8').setHorizontalAlignment('center');
  sheet.getRange(values.length, 1, 1, values[0].length).setFontWeight('bold').setBackground('#f3f3f3');
  sheet.getRange(1, 2).setBackground('#fff2cc');
  sheet.getRange(2, 2, matrix.length, 1).setBackground('#fff9e6').setFontWeight('bold');
  sheet.getRange(2, 1, matrix.length, 1).setFontWeight('bold');

  sheet.autoResizeColumns(1, values[0].length);
}

function buildMonthlyTop10(ss, sheetName, rows, monthKeyFn) {
  let sheet = ss.getSheetByName(sheetName);
  if (sheet) sheet.clear(); else sheet = ss.insertSheet(sheetName);

  const months = [...new Set(rows.map(r => monthKeyFn(r.date)))].sort();

  const header = ['순위'];
  months.forEach(m => header.push(`${m} 제품`, `${m} 사용량`));

  const top10ByMonth = months.map(m => {
    const byProduct = {};
    rows.filter(r => monthKeyFn(r.date) === m)
        .forEach(r => { byProduct[r.product] = (byProduct[r.product] || 0) + r.consumption; });
    return Object.entries(byProduct).sort((a, b) => b[1] - a[1]).slice(0, 10);
  });

  const values = [header];
  for (let rank = 1; rank <= 10; rank++) {
    const row = [rank];
    top10ByMonth.forEach(top10 => {
      const entry = top10[rank - 1];
      row.push(entry ? entry[0] : '', entry ? entry[1] : '');
    });
    values.push(row);
  }

  sheet.getRange(1, 1, values.length, values[0].length).setValues(values);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(1);
  sheet.getRange(1, 1, 1, values[0].length).setFontWeight('bold').setBackground('#e8e8e8').setHorizontalAlignment('center');

  const rankColors = ['#fff2cc', '#efefef', '#fce5cd'];
  for (let i = 0; i < 3; i++) {
    sheet.getRange(i + 2, 1, 1, values[0].length).setBackground(rankColors[i]);
  }
  sheet.getRange(2, 1, 10, 1).setFontWeight('bold').setHorizontalAlignment('center');

  sheet.autoResizeColumns(1, values[0].length);
}

/**
 * 월별 입고 vs 소진 비교
 * 구조: 제품명 | 입고합계 | 소진합계 | 차이합계 | [월1 입고/소진/차이] | [월2 입고/소진/차이] ...
 * 차이 = 입고 - 소진 (양수: 재고 증가, 음수: 재고 감소)
 */
function buildInOutCompare(ss, sheetName, products, rows, monthKeyFn) {
  let sheet = ss.getSheetByName(sheetName);
  if (sheet) { sheet.clear(); sheet.unfreezeRows && sheet.unfreezeRows(); } else { sheet = ss.insertSheet(sheetName); }

  const months = [...new Set(rows.map(r => monthKeyFn(r.date)))].sort();

  // 헤더 2행 (월 라벨은 1행에 병합)
  const header1 = ['제품명', '입고 합계', '소진 합계', '차이 합계'];
  const header2 = ['', '', '', ''];
  months.forEach(m => {
    header1.push(m, '', '');
    header2.push('입고', '소진', '차이');
  });

  const matrix = products.map(product => {
    const productRows = rows.filter(r => r.product === product);
    const cells = [];
    let totalIn = 0, totalOut = 0;
    months.forEach(m => {
      const monthRows = productRows.filter(r => monthKeyFn(r.date) === m);
      const inflow  = monthRows.reduce((s, r) => s + r.inflow, 0);
      const outflow = monthRows.reduce((s, r) => s + r.consumption, 0);
      cells.push(inflow, outflow, inflow - outflow);
      totalIn += inflow;
      totalOut += outflow;
    });
    return [product, totalIn, totalOut, totalIn - totalOut, ...cells];
  });

  // 합계 행
  const totalRow = ['합계',
    matrix.reduce((s, r) => s + r[1], 0),
    matrix.reduce((s, r) => s + r[2], 0),
    matrix.reduce((s, r) => s + r[3], 0),
  ];
  months.forEach((_, i) => {
    const baseCol = 4 + i * 3;
    const sIn  = matrix.reduce((s, r) => s + r[baseCol], 0);
    const sOut = matrix.reduce((s, r) => s + r[baseCol + 1], 0);
    totalRow.push(sIn, sOut, sIn - sOut);
  });

  const values = [header1, header2, ...matrix, totalRow];
  const numCols = values[0].length;
  sheet.getRange(1, 1, values.length, numCols).setValues(values);

  // 좌측 4개 컬럼 헤더 셀 병합 (2행짜리)
  for (let c = 1; c <= 4; c++) {
    sheet.getRange(1, c, 2, 1).merge().setVerticalAlignment('middle');
  }
  // 월별 헤더 (3컬럼씩) 병합
  months.forEach((_, i) => {
    sheet.getRange(1, 5 + i * 3, 1, 3).merge().setHorizontalAlignment('center');
  });

  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(4);

  // 헤더 서식
  sheet.getRange(1, 1, 2, numCols).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange(1, 1, 1, numCols).setBackground('#e8e8e8');
  sheet.getRange(1, 2).setBackground('#cfe2f3'); // 입고 합계
  sheet.getRange(1, 3).setBackground('#f4cccc'); // 소진 합계
  sheet.getRange(1, 4).setBackground('#d9ead3'); // 차이 합계

  // 2행 (입고/소진/차이 라벨)
  for (let i = 0; i < months.length; i++) {
    const col = 5 + i * 3;
    sheet.getRange(2, col    ).setBackground('#cfe2f3');
    sheet.getRange(2, col + 1).setBackground('#f4cccc');
    sheet.getRange(2, col + 2).setBackground('#d9ead3');
  }

  // 합계 행
  sheet.getRange(values.length, 1, 1, numCols).setFontWeight('bold').setBackground('#f3f3f3');
  // 제품명 컬럼 굵게
  sheet.getRange(3, 1, products.length, 1).setFontWeight('bold');

  // 차이 컬럼 조건부 서식 (양수=파랑, 음수=빨강 텍스트)
  const diffCols = [4]; // 차이 합계
  months.forEach((_, i) => diffCols.push(7 + i * 3));
  diffCols.forEach(c => {
    const range = sheet.getRange(3, c, products.length + 1, 1);
    const rules = sheet.getConditionalFormatRules();
    const ruleNeg = SpreadsheetApp.newConditionalFormatRule()
      .whenNumberLessThan(0)
      .setFontColor('#cc0000')
      .setRanges([range])
      .build();
    const rulePos = SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(0)
      .setFontColor('#1155cc')
      .setRanges([range])
      .build();
    rules.push(ruleNeg, rulePos);
    sheet.setConditionalFormatRules(rules);
  });

  sheet.autoResizeColumns(1, numCols);
}

// ══════════════════════════════════════
// 5. 월별 히스토리 페이지
// ══════════════════════════════════════
const HistoryPage = (() => {
  let selectedMonth = null;

  function getRecentMonths(count) {
    const months = [];
    for (let i = 0; i < count; i++) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return months;
  }

  async function render() {
    UI.loading('historyMain');
    const months = getRecentMonths(6);
    if (!selectedMonth) selectedMonth = months[0];

    try {
      await loadMonth(selectedMonth, months);
    } catch (e) {
      UI.errorMsg('historyMain', e.message);
    }
  }

  async function loadMonth(month, months) {
    selectedMonth = month;
    const ITEMS = Items.load();
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const monthStart = `${month}-01`;
    const monthEnd = `${month}-${lastDay}`;

    const [stockRows, ibRows] = await Promise.all([
      Api.get('stocks', `date=gte.${monthStart}&date=lte.${monthEnd}&select=date,item_id,item_name,remain_qty,consumed_qty&order=date.asc`),
      Api.get('inbound', `month=eq.${month}&select=item_id,qty`)
    ]);

    const ibMap = {};
    ibRows.forEach(r => { ibMap[r.item_id] = r.qty; });

    // 월 선택 탭
    let html = `<div class="month-tabs">`;
    (months || getRecentMonths(6)).forEach(mo => {
      const label = UI.fmtMonth(mo);
      const cls = mo === month ? 'month-tab on' : 'month-tab';
      html += `<button class="${cls}" onclick="HistoryPage.selectMonth('${mo}')">${label}</button>`;
    });
    html += `</div>`;

    // 월간 요약
    const consumedMap = {};
    const dates = [...new Set(stockRows.map(r => r.date))].sort();
    stockRows.forEach(r => {
      const qty = Math.max(0, Number(r.consumed_qty) || 0);
      consumedMap[r.item_id] = (consumedMap[r.item_id] || 0) + qty;
    });

    const totalConsumed = Object.values(consumedMap).reduce((a, v) => a + v, 0);
    const totalInbound = Object.values(ibMap).reduce((a, v) => a + v, 0);

    html += `<div class="metric-grid">
      <div class="metric"><div class="metric-label">입력 일수</div><div class="metric-val">${dates.length}</div><div class="metric-unit">일</div></div>
      <div class="metric"><div class="metric-label">월 총 소진</div><div class="metric-val">${totalConsumed}</div><div class="metric-unit">합산</div></div>
      <div class="metric"><div class="metric-label">월 총 입고</div><div class="metric-val">${totalInbound}</div><div class="metric-unit">합산</div></div>
    </div>`;

    // 품목별 월간 소진 테이블
    html += `<div class="card"><div class="card-title">품목별 월간 소진</div><div style="overflow-x:auto"><table class="tbl">
      <thead><tr><th>품목</th><th>월소진</th><th>입고</th><th>월초</th><th>월말</th></tr></thead><tbody>`;

    ITEMS.forEach(it => {
      const consumed = consumedMap[it.id] || 0;
      const inbound = ibMap[it.id] || 0;
      const firstRow = stockRows.find(r => r.item_id === it.id && r.date === dates[0]);
      const lastRow = [...stockRows].reverse().find(r => r.item_id === it.id && r.date === dates[dates.length - 1]);
      const firstQty = firstRow ? firstRow.remain_qty : '\u2014';
      const lastQty = lastRow ? lastRow.remain_qty : '\u2014';
      html += `<tr><td style="font-weight:700">${it.name}</td><td>${consumed > 0 ? consumed + it.unit : '\u2014'}</td><td>${inbound > 0 ? inbound + it.unit : '\u2014'}</td><td>${firstQty !== '\u2014' ? firstQty + it.unit : '\u2014'}</td><td>${lastQty !== '\u2014' ? lastQty + it.unit : '\u2014'}</td></tr>`;
    });
    html += `</tbody></table></div></div>`;

    // 일별 상세 기록
    if (dates.length > 0) {
      html += `<div class="card"><div class="card-title">일별 재고 기록</div><div style="overflow-x:auto"><table class="tbl">
        <thead><tr><th>날짜</th>${ITEMS.map(it => `<th>${it.name.slice(0, 3)}</th>`).join('')}</tr></thead><tbody>`;

      const dayMap = {};
      stockRows.forEach(r => {
        if (!dayMap[r.date]) dayMap[r.date] = {};
        dayMap[r.date][r.item_id] = r.remain_qty;
      });

      dates.forEach(d => {
        html += `<tr><td style="font-weight:700;white-space:nowrap">${UI.fmtDate(d)}</td>`;
        ITEMS.forEach(it => {
          html += `<td>${dayMap[d]?.[it.id] !== undefined ? dayMap[d][it.id] : '\u2014'}</td>`;
        });
        html += `</tr>`;
      });
      html += `</tbody></table></div></div>`;
    } else {
      html += UI.alertHtml('blue', `${UI.fmtMonth(month)}에 입력된 재고 데이터가 없습니다.`);
    }

    UI.$('historyMain').innerHTML = html;
  }

  function selectMonth(month) {
    loadMonth(month, getRecentMonths(6));
  }

  return { render, selectMonth };
})();

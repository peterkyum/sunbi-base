// ══════════════════════════════════════
// 2. 대시보드 페이지
// ══════════════════════════════════════
const DashPage = (() => {

  async function render() {
    UI.loading('dashMain');
    const ITEMS = Items.load();
    const today = UI.todayISO();
    const month = UI.thisMonth();
    const isHQ = Auth.role === 'hq';

    try {
      const [todayRows, ibRows] = await Promise.all([
        Api.get('stocks', `date=eq.${today}&select=item_id,remain_qty,consumed_qty`),
        Api.get('inbound', `month=eq.${month}&select=item_id,qty`)
      ]);
      const todayMap = {};
      todayRows.forEach(r => { todayMap[r.item_id] = r; });
      const ibMap = {};
      ibRows.forEach(r => { ibMap[r.item_id] = r.qty; });

      const statuses = ITEMS.map(it => {
        const row = todayMap[it.id];
        const current = row ? Math.max(0, row.remain_qty) : null;
        const consumed = row ? Math.max(0, row.consumed_qty) : null;
        const ratio = current !== null ? Math.round(current / 100 * 100) : null;
        return { ...it, current, consumed, ratio, danger: ratio !== null && ratio < 15, warning: ratio !== null && ratio < 25 && !(ratio < 15) };
      });

      const totalConsumed = statuses.reduce((a, s) => a + (s.consumed || 0), 0);
      const dangerCount = statuses.filter(s => s.danger).length;
      const warningCount = statuses.filter(s => s.warning).length;

      let html = '';
      statuses.filter(s => s.danger).forEach(s => {
        html += UI.alertHtml('red', `${s.name} 재고 ${s.current}${s.unit} — 평균 대비 ${s.ratio}% 남음. 즉시 확인!`);
      });
      statuses.filter(s => s.warning).forEach(s => {
        html += UI.alertHtml('amber', `${s.name} 재고 ${s.current}${s.unit} — 평균 대비 ${s.ratio}% 남음.`);
      });
      if (!dangerCount && !warningCount) {
        html += UI.alertHtml('green', '모든 품목 재고 정상입니다');
      }

      html += `<div class="metric-grid">
        <div class="metric"><div class="metric-label">오늘 총 소진</div><div class="metric-val">${totalConsumed}</div><div class="metric-unit">합산 수량</div></div>
        <div class="metric"><div class="metric-label">위험 품목</div><div class="metric-val" style="color:${dangerCount > 0 ? 'var(--red)' : 'inherit'}">${dangerCount}</div><div class="metric-unit">즉시 확인</div></div>
      </div>`;

      // 품목별 잔여율 바 차트
      html += `<div class="card"><div class="card-title">품목별 잔여율</div>`;
      statuses.forEach(s => {
        const pct = Math.min(100, s.ratio ?? 0);
        const color = pct < 15 ? '#E24B4A' : pct < 25 ? '#EF9F27' : '#639922';
        html += `<div class="bar-row"><span class="bar-name">${s.name}</span><div class="bar-bg"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div><span class="bar-pct">${s.current !== null ? pct + '%' : '\u2014'}</span></div>`;
      });
      html += `</div>`;

      // 전체 현황 테이블
      html += `<div class="card"><div class="card-title">전체 현황</div><div style="overflow-x:auto"><table class="tbl">
        <thead><tr><th>품목</th><th>현재</th><th>소진</th><th>잔여율</th><th>상태</th>${isHQ ? '<th>관리</th>' : ''}</tr></thead><tbody>`;
      statuses.forEach(s => {
        const pct = Math.min(100, s.ratio ?? 0);
        const badge = s.danger ? UI.badge('red', '위험') : s.warning ? UI.badge('amber', '주의') : UI.badge('green', '정상');
        const actions = isHQ ? `<td><div class="hq-actions"><button class="btn-edit" onclick="DashPage.hqEdit('${s.id}','${s.name}',${s.current ?? 0})">수정</button>${s.current !== null ? `<button class="btn-del" onclick="DashPage.hqDelete('${s.id}','${s.name}')">삭제</button>` : ''}</div></td>` : '';
        html += `<tr><td style="font-weight:700">${s.name}</td><td id="td-cur-${s.id}">${s.current !== null ? s.current + s.unit : '미입력'}</td><td>${s.consumed !== null ? s.consumed + s.unit : '\u2014'}</td><td>${s.current !== null ? pct + '%' : '\u2014'}</td><td>${badge}</td>${actions}</tr>`;
      });
      html += `</tbody></table></div>`;
      if (isHQ) {
        html += `<div style="text-align:right;margin-top:10px"><button class="btn-del" style="padding:6px 14px;font-size:12px" onclick="DashPage.hqDeleteAll()">오늘 전체 삭제</button></div>`;
      }
      html += `</div>`;

      // 최근 5일 기록
      const history = await Api.get('stocks', `select=date,item_id,remain_qty&order=date.desc&limit=${ITEMS.length * 5}`);
      const days = [...new Set(history.map(r => r.date))].slice(0, 5);
      if (days.length > 0) {
        const histMap = {};
        history.forEach(r => { if (!histMap[r.date]) histMap[r.date] = {}; histMap[r.date][r.item_id] = r.remain_qty; });
        html += `<div class="card"><div class="card-title">최근 입력 기록</div><div style="overflow-x:auto"><table class="tbl">
          <thead><tr><th>날짜</th>${ITEMS.map(it => `<th>${it.name.slice(0, 3)}</th>`).join('')}${isHQ ? '<th>관리</th>' : ''}</tr></thead><tbody>`;
        days.forEach(d => {
          html += `<tr><td style="font-weight:700;white-space:nowrap">${UI.fmtDate(d)}</td>`;
          ITEMS.forEach(it => { html += `<td>${histMap[d]?.[it.id] !== undefined ? histMap[d][it.id] : '\u2014'}</td>`; });
          if (isHQ) html += `<td><button class="btn-del" style="font-size:10px;padding:2px 8px" onclick="DashPage.hqDeleteDate('${d}')">삭제</button></td>`;
          html += `</tr>`;
        });
        html += `</tbody></table></div></div>`;
      }

      // 본사 재고 조정 버튼
      if (isHQ) {
        html += `<button class="btn-sub" onclick="DashPage.openAdj()" style="margin-top:4px">전일 재고 조정하기</button>`;
      }

      UI.$('dashMain').innerHTML = html;
    } catch (e) {
      UI.errorMsg('dashMain', e.message);
    }
  }

  // ── 본사 수정/삭제 기능 ──

  function hqEdit(itemId, itemName, currentQty) {
    const td = UI.$('td-cur-' + itemId);
    if (!td) return;
    td.innerHTML = `<input class="edit-input" id="edit-val-${itemId}" type="number" inputmode="numeric" value="${currentQty}">`;
    const tr = td.parentElement;
    const actionTd = tr.querySelector('td:last-child');
    actionTd.innerHTML = `<div class="hq-actions"><button class="btn-save" onclick="DashPage.hqSave('${itemId}','${itemName}',${currentQty})">저장</button><button class="btn-cancel" onclick="DashPage.render()">취소</button></div>`;
    UI.$('edit-val-' + itemId).focus();
  }

  async function hqSave(itemId, itemName, oldQty) {
    const inp = UI.$('edit-val-' + itemId);
    if (!inp) return;
    const newQty = parseInt(inp.value);
    if (isNaN(newQty) || newQty < 0) { alert('올바른 수량을 입력해 주세요.'); return; }
    if (newQty === oldQty) { render(); return; }
    const today = UI.todayISO();
    try {
      const existing = await Api.get('stocks', `date=eq.${today}&item_id=eq.${itemId}&select=item_id`);
      if (existing.length > 0) {
        await Api.patch('stocks', `date=eq.${today}&item_id=eq.${itemId}`, { remain_qty: newQty, submitted_by: '본사수정' });
      } else {
        await Api.insert('stocks', [{ date: today, item_id: itemId, item_name: itemName, remain_qty: newQty, consumed_qty: 0, submitted_by: '본사입력' }]);
      }
      Notify.sendEditLog(itemName, oldQty, newQty, today);
      alert(`${itemName} 재고: ${oldQty} \u2192 ${newQty} ${existing.length > 0 ? '수정' : '입력'} 완료`);
      render();
    } catch (e) { alert('수정 오류: ' + e.message); }
  }

  async function hqDelete(itemId, itemName) {
    if (!confirm(`[${itemName}] 오늘 재고 데이터를 삭제할까요?\n삭제하면 스프레드시트에 기록이 남습니다.`)) return;
    const today = UI.todayISO();
    try {
      const rows = await Api.get('stocks', `date=eq.${today}&item_id=eq.${itemId}&select=remain_qty`);
      const qty = rows.length > 0 ? rows[0].remain_qty : 0;
      await Api.delete('stocks', `date=eq.${today}&item_id=eq.${itemId}`);
      Notify.sendDeleteLog(itemName, qty, today);
      alert(`${itemName} 재고 삭제 완료`);
      render();
    } catch (e) { alert('삭제 오류: ' + e.message); }
  }

  async function hqDeleteDate(date) {
    const label = UI.fmtDate(date);
    if (!confirm(`${label} 재고 데이터를 전체 삭제할까요?`)) return;
    try {
      const rows = await Api.get('stocks', `date=eq.${date}&select=item_name,remain_qty`);
      if (!rows.length) { alert('삭제할 데이터가 없어요.'); return; }
      await Api.delete('stocks', `date=eq.${date}`);
      for (const r of rows) { Notify.sendDeleteLog(r.item_name, r.remain_qty, date); }
      alert(`${label} 전체 재고 삭제 완료`);
      render();
    } catch (e) { alert('삭제 오류: ' + e.message); }
  }

  async function hqDeleteAll() {
    if (!confirm('오늘 입력된 모든 품목의 재고 데이터를 삭제할까요?\n삭제하면 스프레드시트에 기록이 남습니다.')) return;
    const today = UI.todayISO();
    try {
      const rows = await Api.get('stocks', `date=eq.${today}&select=item_id,item_name,remain_qty`);
      if (!rows.length) { alert('삭제할 데이터가 없어요.'); return; }
      await Api.delete('stocks', `date=eq.${today}`);
      for (const r of rows) { Notify.sendDeleteLog(r.item_name, r.remain_qty, today); }
      alert(`오늘 전체 재고 (${rows.length}개 품목) 삭제 완료`);
      render();
    } catch (e) { alert('전체 삭제 오류: ' + e.message); }
  }

  async function openAdj() {
    const yISO = UI.yesterdayISO();
    if (!confirm(`${yISO} 전일 재고를 반영할까요?`)) return;
    try {
      const ITEMS = Items.load();
      const month = yISO.slice(0, 7);
      const d2 = new Date(yISO + 'T00:00:00');
      d2.setDate(d2.getDate() - 1);
      const prevISO = `${d2.getFullYear()}-${String(d2.getMonth() + 1).padStart(2, '0')}-${String(d2.getDate()).padStart(2, '0')}`;
      const [stockRows, prevRows, ibRows] = await Promise.all([
        Api.get('stocks', `date=eq.${yISO}&select=item_id,remain_qty`),
        Api.get('stocks', `date=eq.${prevISO}&select=item_id,remain_qty`),
        Api.get('inbound', `month=eq.${month}&select=item_id,qty`)
      ]);
      if (!stockRows.length) { alert('어제 입력된 재고 데이터가 없어요.'); return; }
      const stockMap = {}, prevMap = {}, ibMapAdj = {};
      stockRows.forEach(r => stockMap[r.item_id] = r.remain_qty);
      prevRows.forEach(r => prevMap[r.item_id] = r.remain_qty);
      ibRows.forEach(r => ibMapAdj[r.item_id] = r.qty);
      const adjustedRows = [];
      for (const it of ITEMS) {
        const remain = stockMap[it.id];
        if (remain === undefined) continue;
        const prev = prevMap[it.id] ?? 0;
        const ib = ibMapAdj[it.id] || 0;
        const consumed = (prev + ib) - remain;
        await Api.patch('stocks', `date=eq.${yISO}&item_id=eq.${it.id}`, { remain_qty: remain, consumed_qty: consumed, submitted_by: '본사조정' });
        adjustedRows.push({ item_name: it.name, remain_qty: remain, consumed_qty: consumed });
      }
      Notify.sendAdjustLog(adjustedRows, yISO);
      alert(`${yISO} 재고 반영 완료`);
      render();
    } catch (e) { alert('오류: ' + e.message); }
  }

  return { render, hqEdit, hqSave, hqDelete, hqDeleteDate, hqDeleteAll, openAdj };
})();

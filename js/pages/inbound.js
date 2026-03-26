// ══════════════════════════════════════
// 4. 입고 관리 페이지
// ══════════════════════════════════════
const InboundPage = (() => {
  let selectedMonth = UI.thisMonth();

  async function render() {
    UI.loading('inboundMain');
    const ITEMS = Items.load();

    const months = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    try {
      const ibRows = await Api.get('inbound', `month=eq.${selectedMonth}&select=item_id,qty`);
      const ibMap = {};
      ibRows.forEach(r => { ibMap[r.item_id] = r.qty; });

      let html = `<div class="card-title" style="padding:2px 0 0">월별 입고량 관리</div>
      <select class="month-select" onchange="InboundPage.changeMonth(this.value)">
        ${months.map(m => `<option value="${m}" ${m === selectedMonth ? 'selected' : ''}>${UI.fmtMonth(m)}</option>`).join('')}
      </select>`;

      ITEMS.forEach(it => {
        const val = ibMap[it.id] !== undefined ? ibMap[it.id] : '';
        html += `<div class="inbound-item">
          <div class="inbound-top">
            <span class="item-name" style="font-size:14px;font-weight:700">${it.name}</span>
            ${UI.badge('blue', val !== '' ? val + it.unit : '미입력')}
          </div>
          <div class="input-row">
            <div><div class="input-label">월 평균 사용량</div><div class="input-val">${it.monthAvg}${it.unit}</div></div>
            <div><div class="input-label">${UI.fmtMonth(selectedMonth)} 입고량</div>
              <input class="qty-input" type="number" inputmode="numeric" placeholder="0" id="ib-${it.id}" value="${val}">
            </div>
          </div>
        </div>`;
      });

      html += `<button class="btn-main" onclick="InboundPage.save()">입고량 저장하기</button>`;
      html += `<button class="btn-sub" onclick="InboundPage.openAddModal()">+ 새 품목 추가하기</button>`;

      html += `<div class="section-label">등록된 품목 목록 (${ITEMS.length}개)</div>
      <div class="card"><table class="tbl">
        <thead><tr><th>품목명</th><th>단위</th><th>월평균</th><th></th></tr></thead><tbody>`;
      ITEMS.forEach((it, idx) => {
        html += `<tr>
          <td style="font-weight:700">${it.name}</td><td>${it.unit}</td>
          <td id="avg-td-${idx}">${it.monthAvg}</td>
          <td style="white-space:nowrap">
            <button onclick="InboundPage.editAvg(${idx})" style="border:none;background:var(--blue-light);color:var(--blue);border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer;font-family:'Noto Sans KR',sans-serif">수정</button>
            <button onclick="InboundPage.resetAvg(${idx})" style="border:none;background:var(--amber-light);color:var(--amber);border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer;font-family:'Noto Sans KR',sans-serif">초기화</button>
            <button onclick="InboundPage.deleteItem(${idx})" style="border:none;background:var(--red-light);color:var(--red);border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer;font-family:'Noto Sans KR',sans-serif">삭제</button>
          </td>
        </tr>`;
      });
      html += `</tbody></table></div>`;

      UI.$('inboundMain').innerHTML = html;
    } catch (e) {
      UI.errorMsg('inboundMain', e.message);
    }
  }

  function changeMonth(m) {
    selectedMonth = m;
    render();
  }

  async function save() {
    const ITEMS = Items.load();
    const btn = document.querySelector('#inboundMain .btn-main');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }
    try {
      const rows = [];
      ITEMS.forEach(it => {
        const el = UI.$('ib-' + it.id);
        if (el && el.value !== '') rows.push({ month: selectedMonth, item_id: it.id, qty: parseInt(el.value) || 0 });
      });
      await Api.delete('inbound', `month=eq.${selectedMonth}`);
      if (rows.length > 0) await Api.insert('inbound', rows);
      alert(`${UI.fmtMonth(selectedMonth)} 입고량이 저장됐어요!`);
      render();
    } catch (e) {
      alert('저장 오류: ' + e.message);
      if (btn) { btn.disabled = false; btn.textContent = '입고량 저장하기'; }
    }
  }

  function resetAvg(idx) {
    if (!confirm('월 평균 사용량을 0으로 초기화할까요?')) return;
    const items = Items.load();
    items[idx] = { ...items[idx], monthAvg: 0 };
    Items.save(items);
    render();
  }

  function editAvg(idx) {
    const td = UI.$('avg-td-' + idx);
    if (!td) return;
    const items = Items.load();
    const current = items[idx].monthAvg;
    td.innerHTML = `<input type="number" inputmode="numeric" value="${current}" id="avg-inp-${idx}" style="width:50px;border:1.5px solid var(--blue);border-radius:6px;padding:3px 5px;font-size:12px;text-align:center">
      <button onclick="InboundPage.saveAvg(${idx})" style="border:none;background:var(--blue);color:#fff;border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer;font-family:'Noto Sans KR',sans-serif;margin-left:4px">저장</button>`;
    UI.$('avg-inp-' + idx).focus();
  }

  function saveAvg(idx) {
    const inp = UI.$('avg-inp-' + idx);
    if (!inp) return;
    const val = Math.max(0, parseInt(inp.value) || 0);
    const items = Items.load();
    items[idx] = { ...items[idx], monthAvg: val };
    Items.save(items);
    render();
  }

  function deleteItem(idx) {
    if (!confirm('이 품목을 삭제할까요?')) return;
    Items.remove(idx);
    render();
  }

  function openAddModal() {
    UI.showModal('modalBg');
    UI.$('newName').focus();
  }

  function addItem() {
    const name = UI.$('newName').value.trim();
    const unit = UI.$('newUnit').value.trim() || '개';
    const avg = parseInt(UI.$('newAvg').value) || 0;
    const ib = parseInt(UI.$('newInbound').value) || 0;
    if (!name) { alert('품목명을 입력해 주세요!'); return; }
    const id = Items.add(name, unit, avg);
    closeAddModal();
    if (ib > 0) {
      Api.insert('inbound', [{ month: selectedMonth, item_id: id, qty: ib }]).catch(() => {});
    }
    render();
  }

  function closeAddModal() {
    UI.hideModal('modalBg');
    ['newName', 'newUnit', 'newAvg', 'newInbound'].forEach(id => { UI.$(id).value = ''; });
  }

  return { render, changeMonth, save, deleteItem, resetAvg, editAvg, saveAvg, openAddModal, addItem, closeAddModal };
})();

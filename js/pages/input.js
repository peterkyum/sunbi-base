// ══════════════════════════════════════
// 1. 재고 입력 페이지
// ══════════════════════════════════════
const InputPage = (() => {
  let submitted = false;
  let resetMode = false;

  function previewConsumed3(id, prevStock, unit) {
    const elIb = UI.$('inp-ib-' + id);
    const elRemain = UI.$('inp-' + id);
    const prevEl = UI.$('prev-' + id);
    const ib = elIb && elIb.value !== '' ? parseInt(elIb.value) || 0 : 0;
    if (!elRemain || elRemain.value === '') { if (prevEl) prevEl.style.display = 'none'; return; }
    const val = parseInt(elRemain.value || 0);
    const finalRemain = val + ib;
    const consumed = prevStock - val;
    prevEl.style.display = 'block';
    prevEl.textContent = `최종재고: ${finalRemain}${unit}  소진량: ${consumed}${unit}  (전날${prevStock}-입력${val}+입고${ib})`;
    prevEl.style.color = consumed < 0 ? '#A32D2D' : '#2D6A1F';
    prevEl.style.background = consumed < 0 ? '#FCEBEB' : '#EAF3DE';
  }

  // 전역에 노출 (인라인 이벤트에서 사용)
  window.previewConsumed3 = previewConsumed3;

  async function render() {
    const ITEMS = Items.load();
    const today = UI.todayISO();
    const month = UI.thisMonth();
    const yISO = UI.yesterdayISO();

    let todayData = {}, inboundData = {}, prevData = {};
    try {
      const [todayRows, ibRows, prevRows] = await Promise.all([
        Api.get('stocks', `date=eq.${today}&select=item_id,remain_qty`),
        Api.get('inbound', `month=eq.${month}&select=item_id,qty`),
        Api.get('stocks', `date=eq.${yISO}&select=item_id,remain_qty`)
      ]);
      todayRows.forEach(r => { todayData[r.item_id] = r.remain_qty; });
      ibRows.forEach(r => { inboundData[r.item_id] = r.qty; });
      prevRows.forEach(r => { prevData[r.item_id] = r.remain_qty; });
    } catch (e) {
      UI.errorMsg('inputMain', e.message);
      return;
    }

    // ── 본사: 읽기 전용 뷰 ──
    if (Auth.role === 'hq') {
      renderHQView(ITEMS, todayData, prevData, inboundData);
      return;
    }

    // 오늘 이미 모든 품목 제출됐으면 성공 화면
    if (!resetMode) {
      const allSubmitted = ITEMS.length > 0 && ITEMS.every(it => todayData[it.id] !== undefined);
      if (allSubmitted) submitted = true;
    }

    if (submitted) {
      UI.$('inputMain').innerHTML = `
      <div class="success-screen">
        <div class="success-circle">\u2713</div>
        <div class="success-title">오늘 재고 제출 완료!</div>
        <div class="success-sub">서버에 저장됐어요.<br>본사에서 실시간으로 확인할 수 있어요</div>
        <button class="btn-ghost" onclick="InputPage.reset()">다시 입력하기</button>
      </div>`;
      return;
    }

    let html = UI.alertHtml('amber', '오늘 남은 재고와 당일 입고 수량을 품목별로 입력해 주세요.');

    ITEMS.forEach(it => {
      const rawPrevBase = resetMode && todayData[it.id] !== undefined
        ? todayData[it.id]
        : (prevData[it.id] !== undefined ? prevData[it.id] : null);
      const prevBase = rawPrevBase !== null ? Math.max(0, rawPrevBase) : null;
      const prevStock = prevBase !== null ? prevBase : null;

      const prevLabel = resetMode && todayData[it.id] !== undefined
        ? `오늘 제출 ${Math.max(0, todayData[it.id])}${it.unit}`
        : (prevData[it.id] !== undefined ? `전일 ${Math.max(0, prevData[it.id])}${it.unit}` : '전일 미입력');

      html += `<div class="input-item">
        <div class="input-item-top">
          <span class="item-name">${it.name}</span>
          <span class="item-info">${prevLabel}</span>
        </div>
        <div class="input-row-3">
          <div>
            <div class="input-label">전날 최종재고</div>
            <div class="input-val">${prevStock !== null ? prevStock + '개' : '미입력'}</div>
          </div>
          <div>
            <div class="input-label">당일 입고 수량</div>
            <input class="qty-input qty-inbound" type="number" inputmode="numeric" placeholder="0"
              id="inp-ib-${it.id}" value="0"
              oninput="previewConsumed3('${it.id}',${prevStock ?? 0},'${it.unit}')">
          </div>
          <div>
            <div class="input-label">현재 재고 입력</div>
            <input class="qty-input" type="number" inputmode="numeric" placeholder="${prevStock ?? 0}" min="0"
              id="inp-${it.id}" value=""
              oninput="previewConsumed3('${it.id}',${prevStock ?? 0},'${it.unit}')">
            ${prevStock !== null ? `<div style="font-size:10px;color:var(--gray-600);text-align:center;margin-top:2px">비우면 전일값 유지</div>` : ''}
          </div>
        </div>
        <div class="consumed-preview" id="prev-${it.id}" style="display:none">
          오늘 소진량: 0${it.unit}
        </div>
      </div>`;
    });

    html += `<button class="btn-main" id="submitBtn" onclick="InputPage.submit()">오늘 재고 제출하기</button>`;
    UI.$('inputMain').innerHTML = html;
    resetMode = false;
  }

  function renderHQView(ITEMS, todayData, prevData, inboundData) {
    const hasToday = ITEMS.length > 0 && ITEMS.some(it => todayData[it.id] !== undefined);
    let html = hasToday
      ? UI.alertHtml('green', '유통사가 오늘 재고를 입력했어요. 대시보드에서 전체 현황을 확인하세요.')
      : UI.alertHtml('amber', '아직 오늘 재고가 입력되지 않았어요.');

    ITEMS.forEach(it => {
      const current = todayData[it.id] !== undefined ? Math.max(0, todayData[it.id]) : null;
      const prev = prevData[it.id] !== undefined ? Math.max(0, prevData[it.id]) : null;
      const ib = inboundData[it.id] || 0;
      html += `<div class="input-item">
        <div class="input-item-top">
          <span class="item-name">${it.name}</span>
          <span class="item-info">${prev !== null ? `전일 ${prev}${it.unit}` : '전일 미입력'}<br>입고 +${ib}${it.unit}</span>
        </div>
        <div class="input-row">
          <div>
            <div class="input-label">전날 최종재고</div>
            <div class="input-val">${prev !== null ? prev + ib : ib}${it.unit}</div>
          </div>
          <div>
            <div class="input-label">현재 재고</div>
            <div class="input-val" style="color:${current !== null ? 'var(--green)' : 'var(--gray-600)'}">
              ${current !== null ? current + it.unit : '미입력'}
            </div>
          </div>
        </div>
      </div>`;
    });
    UI.$('inputMain').innerHTML = html;
  }

  async function submit() {
    const ITEMS = Items.load();
    const today = UI.todayISO();
    const yISO = UI.yesterdayISO();
    const month = UI.thisMonth();
    const btn = UI.$('submitBtn');

    let allFilled = true;
    ITEMS.forEach(it => {
      const el = UI.$('inp-' + it.id);
      if (!el || el.value === '') allFilled = false;
    });
    if (!allFilled) { alert('모든 품목의 현재 재고를 입력해 주세요!'); return; }

    btn.disabled = true;
    btn.textContent = '저장 중...';

    try {
      const prevRows = await Api.get('stocks', `date=eq.${yISO}&select=item_id,remain_qty`);
      const prevMap = {};
      prevRows.forEach(r => { prevMap[r.item_id] = r.remain_qty; });

      // 당일 입고 수량 수집
      const ibEntries = [];
      ITEMS.forEach(it => {
        const ibEl = UI.$('inp-ib-' + it.id);
        const ibVal = ibEl && ibEl.value !== '' ? parseInt(ibEl.value) || 0 : 0;
        if (ibVal > 0) ibEntries.push({ month, item_id: it.id, qty: ibVal });
      });

      // 당일 입고 누적 저장
      if (ibEntries.length > 0) {
        const existIbRows = await Api.get('inbound', `month=eq.${month}&select=item_id,qty`);
        const existIbMap = {};
        existIbRows.forEach(r => { existIbMap[r.item_id] = r.qty; });
        const upsertIb = ibEntries.map(e => ({
          month,
          item_id: e.item_id,
          qty: (existIbMap[e.item_id] || 0) + e.qty
        }));
        const affectedIds = upsertIb.map(e => e.item_id);
        for (const id of affectedIds) {
          await Api.delete('inbound', `month=eq.${month}&item_id=eq.${id}`);
        }
        await Api.insert('inbound', upsertIb);
      }

      // 오늘 기존 데이터 삭제 후 재삽입
      await Api.delete('stocks', `date=eq.${today}`);

      const rows = ITEMS.map(it => {
        const val = Math.max(0, parseInt(UI.$('inp-' + it.id).value) || 0);
        const ibEl = UI.$('inp-ib-' + it.id);
        const todayIb = Math.max(0, ibEl && ibEl.value !== '' ? parseInt(ibEl.value) || 0 : 0);
        const prev = prevMap[it.id] !== undefined ? Math.max(0, prevMap[it.id]) : 0;
        return {
          date: today,
          item_id: it.id,
          item_name: it.name,
          remain_qty: Math.max(0, val + todayIb),
          consumed_qty: Math.max(0, prev - val),
          submitted_by: '유통사담당자'
        };
      });

      await Api.insert('stocks', rows);

      const dailyIbMap = {};
      ibEntries.forEach(e => { dailyIbMap[e.item_id] = e.qty; });
      await Notify.telegram(rows, today, dailyIbMap);
      await Notify.sendStockToSheet(rows, today, dailyIbMap);

      submitted = true;
      UI.$('syncDot').className = 'sync-dot ok';
      render();
    } catch (e) {
      alert('저장 오류: ' + e.message);
      btn.disabled = false;
      btn.textContent = '오늘 재고 제출하기';
      UI.$('syncDot').className = 'sync-dot err';
    }
  }

  function reset() {
    submitted = false;
    resetMode = true;
    render();
  }

  function clearState() {
    submitted = false;
    resetMode = false;
  }

  return { render, submit, reset, clearState };
})();

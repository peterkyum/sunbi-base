// ══════════════════════════════════════
// 3. 자동 발주 페이지
// ══════════════════════════════════════
const OrderPage = (() => {
  let lastOrderData = []; // 분석 결과 저장 (확정 시 사용)

  async function render() {
    lastOrderData = [];
    UI.loading('orderMain');
    const ITEMS = Items.load();
    const today = UI.todayISO();

    try {
      // 분석 대상: 최근 4개월
      const months = [];
      for (let i = 0; i < 4; i++) {
        const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      }
      const currentMonth = months[0];
      const analyzeMonths = months.slice(1);

      // 오늘 재고 (없으면 최근 재고)
      const [todayRows, latestRows] = await Promise.all([
        Api.get('stocks', `date=eq.${today}&select=item_id,remain_qty`),
        Api.get('stocks', `select=item_id,remain_qty&order=date.desc&limit=${ITEMS.length}`)
      ]);
      const todayMap = {};
      todayRows.forEach(r => { todayMap[r.item_id] = Math.max(0, r.remain_qty); });
      const latestMap = {};
      latestRows.forEach(r => { if (!latestMap[r.item_id]) latestMap[r.item_id] = Math.max(0, Number(r.remain_qty)); });

      // 입고 데이터
      const allIbRows = await Api.get('inbound', `select=month,item_id,qty`);
      const ibMap = {};
      allIbRows.forEach(r => {
        if (!ibMap[r.month]) ibMap[r.month] = {};
        ibMap[r.month][r.item_id] = r.qty;
      });

      // 월별 사용량 계산
      const monthlyUsage = {};
      ITEMS.forEach(it => { monthlyUsage[it.id] = []; });

      for (const m of analyzeMonths) {
        const [y, mo] = m.split('-').map(Number);
        const startDate = `${y}-${String(mo).padStart(2, '0')}-01`;
        const nextMo = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
        const mRows = await Api.get('stocks', `date=gte.${startDate}&date=lt.${nextMo}-01&select=date,item_id,remain_qty&order=date.asc`);

        if (mRows.length === 0) continue;
        const dateSet = [...new Set(mRows.map(r => r.date))].sort();
        if (dateSet.length < 2) continue;

        const firstDate = dateSet[0];
        const lastDate = dateSet[dateSet.length - 1];
        const firstMap = {}, lastMap = {};
        mRows.filter(r => r.date === firstDate).forEach(r => { firstMap[r.item_id] = r.remain_qty; });
        mRows.filter(r => r.date === lastDate).forEach(r => { lastMap[r.item_id] = r.remain_qty; });

        ITEMS.forEach(it => {
          const s = firstMap[it.id];
          const e = lastMap[it.id];
          const ib = (ibMap[m] || {})[it.id] || 0;
          if (s !== undefined && e !== undefined) {
            const usage = s + ib - e;
            if (usage >= 0) monthlyUsage[it.id].push({ month: m, start: s, end: e, ib, usage });
          }
        });
      }

      // 이번달 소진량
      const curMonthStart = `${currentMonth}-01`;
      const curRows = await Api.get('stocks', `date=gte.${curMonthStart}&select=date,item_id,remain_qty,consumed_qty&order=date.asc`);
      const curDateSet = [...new Set(curRows.map(r => r.date))].sort();
      const curFirstMap = {};
      if (curDateSet.length > 0) {
        curRows.filter(r => r.date === curDateSet[0]).forEach(r => { curFirstMap[r.item_id] = r.remain_qty; });
      }
      const curConsumedMap = {};
      curRows.forEach(r => {
        const qty = Math.max(0, Number(r.consumed_qty) || 0);
        if (qty > 0) {
          curConsumedMap[r.item_id] = (curConsumedMap[r.item_id] || 0) + qty;
        }
      });
      const curDays = curDateSet.length || 1;

      // HTML 생성
      let html = `<div class="adj-banner"><strong>실사용량 기반 발주 분석</strong><br>최근 완료된 달의 <strong>월초 재고 + 입고 - 월말 재고</strong> = 월 사용량을 계산해 발주 수량을 제안합니다. (안전재고 +15% 포함)</div>`;

      ITEMS.forEach(it => {
        const usages = monthlyUsage[it.id];
        const current = todayMap[it.id] !== undefined ? todayMap[it.id] : (latestMap[it.id] !== undefined ? latestMap[it.id] : null);

        let avgUsage = null, recLabel = '', isFallback = false;
        if (usages.length > 0) {
          avgUsage = Math.round(usages.reduce((a, u) => a + u.usage, 0) / usages.length);
          recLabel = '평균 사용량 x 1.15 - 현재 재고';
        } else if (curConsumedMap[it.id] > 0) {
          const dailyAvg = curConsumedMap[it.id] / curDays;
          avgUsage = Math.round(dailyAvg * 30);
          recLabel = `이번달 ${curDays}일 소진 기반 추정 (일평균 ${Math.round(dailyAvg * 10) / 10}${it.unit}/일 x 30)`;
          isFallback = true;
        }

        const rec = avgUsage !== null ? Math.max(0, Math.ceil(avgUsage * (1 + Items.SAFETY) - (current ?? 0))) : null;

        if (rec !== null && rec > 0) {
          lastOrderData.push({ item_name: it.name, order_qty: rec, current_qty: current ?? 0, avg_usage: avgUsage, unit: it.unit });
        }

        const curStart = curFirstMap[it.id];
        const curIb = (ibMap[currentMonth] || {})[it.id] || 0;
        const curUsedSoFar = (curStart !== undefined && current !== null) ? curStart + curIb - current : null;
        const noData = usages.length === 0 && !curConsumedMap[it.id];

        html += `<div class="order-item">
          <div class="order-top">
            <span class="order-name">${it.name}</span>
            <span class="order-qty" style="color:${rec === null ? 'var(--gray-600)' : rec > 0 ? 'var(--green)' : 'var(--blue)'}">
              ${rec !== null ? rec + it.unit : (noData ? '데이터 부족' : '\u2014')}
            </span>
          </div>
          <div style="font-size:11px;color:var(--gray-600);margin-bottom:8px">
            ${recLabel || '이번 달 추천 발주량'}
            ${isFallback ? '<span style="color:#b45309;font-weight:700"> 추정값 (1개월 완료 데이터 누적 후 정확도 향상)</span>' : ''}
          </div>
          <div class="order-detail">
            <div><div class="od-label">${isFallback ? '추정 월 사용량' : '평균 월 사용량'}</div><div class="od-val">${avgUsage !== null ? avgUsage + it.unit : '미산출'}</div></div>
            <div><div class="od-label">현재 재고</div><div class="od-val">${current !== null ? current + it.unit : '미입력'}</div></div>
            <div><div class="od-label">이번달 현재까지 소진</div><div class="od-val">${curUsedSoFar !== null ? curUsedSoFar + it.unit : '\u2014'}</div></div>
          </div>
          ${usages.length > 0 ? `
          <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
            <div style="font-size:10px;font-weight:700;color:var(--gray-600);margin-bottom:6px">월별 사용량 내역</div>
            <div style="overflow-x:auto"><table class="tbl">
              <thead><tr><th>월</th><th>월초</th><th>입고</th><th>월말</th><th>사용량</th></tr></thead>
              <tbody>
                ${usages.map(u => `<tr>
                  <td style="white-space:nowrap">${UI.fmtMonth(u.month)}</td>
                  <td>${u.start}${it.unit}</td>
                  <td>+${u.ib}${it.unit}</td>
                  <td>${u.end}${it.unit}</td>
                  <td style="font-weight:700;color:var(--green)">${u.usage}${it.unit}</td>
                </tr>`).join('')}
                ${usages.length > 1 ? `<tr style="background:var(--gray-100)">
                  <td style="font-weight:700">평균</td>
                  <td colspan="3"></td>
                  <td style="font-weight:700;color:var(--green-mid)">${avgUsage}${it.unit}</td>
                </tr>` : ''}
              </tbody>
            </table></div>
          </div>` : ''}
        </div>`;
      });

      const hasAnyRec = ITEMS.some(it => monthlyUsage[it.id].length > 0 || curConsumedMap[it.id] > 0);
      if (hasAnyRec) {
        html += `<button class="btn-main" id="orderBtn" onclick="OrderPage.confirm()">발주 확정하기</button>`;
      } else {
        html += UI.alertHtml('blue', '재고 입력이 쌓이면 자동으로 발주 분석이 시작돼요. 며칠치 데이터만 있어도 추정값을 제공합니다.');
      }

      // 발주 히스토리
      const orderRows = await Api.get('orders', `select=order_date,item_count&order=order_date.desc&limit=5`);
      if (orderRows.length > 0) {
        html += `<div class="card" style="margin-top:12px"><div class="card-title">발주 히스토리</div><table class="tbl">
          <thead><tr><th>발주일</th><th>품목 수</th><th>상태</th></tr></thead><tbody>`;
        orderRows.forEach(o => {
          html += `<tr><td>${UI.fmtDate(o.order_date)}</td><td>${o.item_count}개</td><td>${UI.badge('green', '완료')}</td></tr>`;
        });
        html += `</tbody></table></div>`;
      }

      UI.$('orderMain').innerHTML = html;
    } catch (e) {
      UI.errorMsg('orderMain', e.message);
    }
  }

  async function confirm() {
    if (!lastOrderData.length) { alert('발주할 품목이 없어요.'); return; }
    const btn = UI.$('orderBtn');
    btn.disabled = true;
    btn.textContent = '저장 중...';
    const today = UI.todayISO();
    try {
      await Api.insert('orders', { order_date: today, item_count: lastOrderData.length });
      await Notify.sendOrderToSheet(lastOrderData, today);
      await Notify.sendOrderTelegram(lastOrderData, today);
      alert('발주가 확정됐어요! 시트 기록 + 텔레그램 알림 완료');
      render();
    } catch (e) {
      alert('저장 오류: ' + e.message);
      btn.disabled = false;
      btn.textContent = '발주 확정하기';
    }
  }

  return { render, confirm };
})();

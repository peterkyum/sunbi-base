// ══════════════════════════════════════
// 외부 알림 — Telegram + Google Sheets
// ══════════════════════════════════════
const Notify = (() => {
  const cfg = () => window.SUNBI_CONFIG || {};

  async function telegram(rows, today, dailyInbound) {
    const token = cfg().TELEGRAM_TOKEN;
    const chatId = cfg().TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    try {
      const d = new Date(today + 'T00:00:00');
      const dateStr = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
      const lines = rows.map(r => {
        const ib = (dailyInbound && dailyInbound[r.item_id]) || 0;
        return `• <b>${r.item_name}</b>\n  현재재고: ${r.remain_qty}박스 | 소진: ${r.consumed_qty}박스${ib > 0 ? ` | 입고: +${ib}박스` : ''}`;
      }).join('\n');
      const text = `📦 <b>[선비칼국수] ${dateStr} 재고 입력 완료</b>\n\n${lines}\n\n✅ 유통사 담당자가 오늘 재고를 제출했어요.`;

      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
      });
    } catch (e) {
      // 알림 실패는 주요 기능에 영향 없음
    }
  }

  async function googleSheet(payload) {
    const scriptUrl = cfg().SCRIPT_URL;
    const spreadsheetId = cfg().SPREADSHEET_ID;
    if (!scriptUrl) return;

    try {
      await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ spreadsheetId, ...payload })
      });
    } catch (e) {
      // 백업 실패는 주요 기능에 영향 없음
    }
  }

  async function sendStockToSheet(rows, today, dailyInbound) {
    await googleSheet({
      date: today,
      rows: rows.map(r => ({
        item_name: r.item_name,
        remain_qty: r.remain_qty,
        consumed_qty: r.consumed_qty,
        inbound_qty: (dailyInbound && dailyInbound[r.item_id]) || 0
      }))
    });
  }

  async function sendDeleteLog(itemName, qty, date) {
    await googleSheet({
      action: 'delete',
      date,
      rows: [{ item_name: itemName, remain_qty: qty, consumed_qty: 0, inbound_qty: 0 }]
    });
  }

  async function sendEditLog(itemName, oldQty, newQty, date) {
    await googleSheet({
      action: 'edit',
      date,
      rows: [{ item_name: itemName, old_qty: oldQty, new_qty: newQty }]
    });
  }

  return { telegram, sendStockToSheet, sendDeleteLog, sendEditLog };
})();

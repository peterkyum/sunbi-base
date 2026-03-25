#!/usr/bin/env python3
import json, urllib.request, re, os, sys
from datetime import datetime, timezone, timedelta

LOG_FILE = '/tmp/sunbi_poller_debug.log'

def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    line = f'[{ts}] {msg}'
    print(line)
    with open(LOG_FILE, 'a') as f:
        f.write(line + '\n')

def _load_env():
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if not os.path.exists(env_path):
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

_load_env()

TELEGRAM_TOKEN = os.environ['TELEGRAM_TOKEN']
CHAT_ID        = os.environ['CHAT_ID']
SCRIPT_URL     = os.environ['SCRIPT_URL']
SPREADSHEET_ID = os.environ['SPREADSHEET_ID']
STATE_FILE = '/tmp/sunbi_last_update_id.txt'

def get_last_update_id():
    try:
        with open(STATE_FILE) as f:
            return int(f.read().strip())
    except:
        return 0

def save_last_update_id(uid):
    with open(STATE_FILE, 'w') as f:
        f.write(str(uid))

def telegram_get(method, params=''):
    url = f'https://api.telegram.org/bot{TELEGRAM_TOKEN}/{method}{params}'
    res = urllib.request.urlopen(url, timeout=10)
    return json.loads(res.read().decode())

def telegram_send(text):
    url = f'https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage'
    payload = json.dumps({'chat_id': CHAT_ID, 'text': text, 'parse_mode': 'HTML'}).encode()
    req = urllib.request.Request(url, data=payload, headers={'Content-Type': 'application/json'})
    urllib.request.urlopen(req, timeout=10)

def parse_message(text):
    lines = text.strip().split('\n')
    stocks, inbounds = [], []
    for line in lines:
        t = line.strip()
        if not t:
            continue
        m = re.search(r'금일\s+(.+?)\s+(\d+)\s*박스', t)
        if m:
            inbounds.append({'item_name': m.group(1).strip(), 'qty': int(m.group(2))})
            continue
        m = re.match(r'^(.+?)\s+(\d+)\s*박스', t)
        if m:
            stocks.append({'item_name': m.group(1).strip(), 'remain_qty': int(m.group(2))})
    return stocks, inbounds

def save_to_sheet(date, stocks, inbounds):
    inbound_map = {i['item_name']: i['qty'] for i in inbounds}
    rows = []
    for s in stocks:
        rows.append({
            'item_name': s['item_name'],
            'remain_qty': s['remain_qty'],
            'consumed_qty': 0,
            'inbound_qty': inbound_map.get(s['item_name'], 0)
        })
    payload = json.dumps({
        'spreadsheetId': SPREADSHEET_ID,
        'date': date,
        'rows': rows
    }).encode()
    log(f'POST payload: {payload.decode()[:300]}')
    req = urllib.request.Request(SCRIPT_URL, data=payload, headers={'Content-Type': 'text/plain'}, method='POST')
    res = urllib.request.urlopen(req, timeout=15)
    body = res.read().decode()
    log(f'POST response: {body[:300]}')
    return json.loads(body)

def main():
    last_id = get_last_update_id()
    data = telegram_get('getUpdates', f'?offset={last_id + 1}&limit=10')
    updates = data.get('result', [])
    if not data.get('ok') or not updates:
        return

    log(f'=== {len(updates)}개 메시지 처리 시작 ===')

    kst = timezone(timedelta(hours=9))
    now = datetime.now(kst)
    today = now.strftime('%Y-%m-%d')

    for update in updates:
        msg = update.get('message', {})
        chat_id = msg.get('chat', {}).get('id')
        text = msg.get('text', '')
        log(f'update={update["update_id"]} chat={chat_id} text="{text[:50]}"')

        if chat_id == int(CHAT_ID) and text:
            stocks, inbounds = parse_message(text)
            log(f'  parsed: {len(stocks)} stocks, {len(inbounds)} inbounds')
            if stocks:
                try:
                    result = save_to_sheet(today, stocks, inbounds)
                    log(f'  result success={result.get("success")}')
                    if result.get('success'):
                        saved = result.get('saved', [])
                        lines = [f'✅ <b>{today} 재고 입력 완료!</b>\n']
                        for r in saved:
                            consumed = r.get('consumed_qty')
                            ib = r.get('inbound_qty', 0)
                            consumed_str = f' | 소진 {consumed}박스' if consumed is not None and consumed > 0 else ''
                            ib_str = f' | 입고 +{ib}박스' if ib and ib > 0 else ''
                            lines.append(f'• {r["item_name"]}: {r["remain_qty"]}박스{consumed_str}{ib_str}')
                            log(f'  → {r["item_name"]}: remain={r["remain_qty"]} consumed={consumed}')
                        telegram_send('\n'.join(lines))
                        log('  → 텔레그램 확인 전송 완료')
                    else:
                        log(f'  ❌ 실패: {result.get("error")}')
                except Exception as e:
                    log(f'  ❌ 예외: {e}')
        save_last_update_id(update['update_id'])

if __name__ == '__main__':
    main()

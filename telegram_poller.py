#!/usr/bin/env python3
import json, urllib.request, re, os
from datetime import datetime, timezone, timedelta

TELEGRAM_TOKEN = '8624851417:AAFohaEN56XVSJ5y67c94z88gSBcOPtBOoE'
CHAT_ID = '8774713020'
SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbykYXbEUSU-aGjYMYXDHv9I_nJgcMwOslKEKH0kNaXu5OuTO_wnO1jTwK9tSgJPabJoqA/exec'
SPREADSHEET_ID = '1ZSz3IAa8B--i4wSixq6gDkEUb4s-OV9j-C2HAl4sKAM'
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
    rows = [{'item_name': s['item_name'], 'remain_qty': s['remain_qty'],
             'consumed_qty': 0, 'inbound_qty': inbound_map.get(s['item_name'], 0)} for s in stocks]
    payload = json.dumps({'spreadsheetId': SPREADSHEET_ID, 'date': date, 'rows': rows}).encode()
    req = urllib.request.Request(SCRIPT_URL, data=payload, headers={'Content-Type': 'text/plain'}, method='POST')
    res = urllib.request.urlopen(req, timeout=15)
    return json.loads(res.read().decode())

def main():
    last_id = get_last_update_id()
    data = telegram_get('getUpdates', f'?offset={last_id + 1}&limit=10')
    if not data.get('ok') or not data.get('result'):
        return

    kst = timezone(timedelta(hours=9))
    today = datetime.now(kst).strftime('%Y-%m-%d')

    for update in data['result']:
        msg = update.get('message', {})
        if msg.get('chat', {}).get('id') == int(CHAT_ID) and msg.get('text'):
            stocks, inbounds = parse_message(msg['text'])
            if stocks:
                result = save_to_sheet(today, stocks, inbounds)
                if result.get('success'):
                    lines = [f'✅ <b>{today} 재고 입력 완료!</b>\n']
                    lines += [f'• {s["item_name"]}: {s["remain_qty"]}박스' for s in stocks]
                    if inbounds:
                        lines.append('\n📦 <b>입고:</b>')
                        lines += [f'• {i["item_name"]}: {i["qty"]}박스' for i in inbounds]
                    telegram_send('\n'.join(lines))
        save_last_update_id(update['update_id'])

if __name__ == '__main__':
    main()

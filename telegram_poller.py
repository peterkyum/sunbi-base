#!/usr/bin/env python3
import json, urllib.request, re
from datetime import datetime, timezone, timedelta

TELEGRAM_TOKEN = '8624851417:AAFohaEN56XVSJ5y67c94z88gSBcOPtBOoE'
CHAT_ID = '8774713020'
SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbztdLxZ9rjDMxnHCN00a2xlM9xoaZuzJJpdw4zZZM6lRQ44YeMt64qVFTjub5pzUywM/exec'
SPREADSHEET_ID = '1ZSz3IAa8B--i4wSixq6gDkEUb4s-OV9j-C2HAl4sKAM'
SB_URL = 'https://nhgkzquqbxbzwejzcdft.supabase.co'
SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oZ2t6cXVxYnhiendlanpjZGZ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMjc5NzgsImV4cCI6MjA4OTgwMzk3OH0.K8CIaX3nPQ9EzBvhjpMol8Ng9i-7iM71HxboAXhx0QM'
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

def sb_get(table, query=''):
    headers = {'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY}
    req = urllib.request.Request(f'{SB_URL}/rest/v1/{table}?{query}', headers=headers)
    return json.loads(urllib.request.urlopen(req, timeout=10).read())

def get_prev_stocks(today):
    """오늘 이전 가장 최근 재고를 item_name 기준으로 반환"""
    try:
        rows = sb_get('stocks', f'date=lt.{today}&select=item_name,remain_qty&order=date.desc&limit=100')
        prev_map = {}
        for r in rows:
            if r['item_name'] not in prev_map:
                prev_map[r['item_name']] = r['remain_qty']
        return prev_map
    except:
        return {}

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

def save_to_sheet(date, stocks, inbounds, prev_map):
    inbound_map = {i['item_name']: i['qty'] for i in inbounds}
    rows = []
    for s in stocks:
        val = s['remain_qty']
        ib = inbound_map.get(s['item_name'], 0)
        prev = prev_map.get(s['item_name'])
        consumed = (prev - val) if prev is not None else 0
        rows.append({
            'item_name': s['item_name'],
            'remain_qty': val,
            'consumed_qty': consumed,
            'inbound_qty': ib
        })
    payload = json.dumps({'spreadsheetId': SPREADSHEET_ID, 'date': date, 'rows': rows}).encode()
    req = urllib.request.Request(SCRIPT_URL, data=payload, headers={'Content-Type': 'text/plain'}, method='POST')
    res = urllib.request.urlopen(req, timeout=15)
    return json.loads(res.read().decode()), rows

def main():
    last_id = get_last_update_id()
    data = telegram_get('getUpdates', f'?offset={last_id + 1}&limit=10')
    if not data.get('ok') or not data.get('result'):
        return

    kst = timezone(timedelta(hours=9))
    now = datetime.now(kst)
    today = now.strftime('%Y-%m-%d')
    yesterday = (now - timedelta(days=1)).strftime('%Y-%m-%d')

    prev_map = get_prev_stocks(today)

    for update in data['result']:
        msg = update.get('message', {})
        if msg.get('chat', {}).get('id') == int(CHAT_ID) and msg.get('text'):
            stocks, inbounds = parse_message(msg['text'])
            if stocks:
                result, saved_rows = save_to_sheet(today, stocks, inbounds, prev_map)
                if result.get('success'):
                    lines = [f'✅ <b>{today} 재고 입력 완료!</b>\n']
                    for r in saved_rows:
                        consumed_str = f' | 소진 {r["consumed_qty"]}박스' if r['consumed_qty'] != 0 else ''
                        ib_str = f' | 입고 +{r["inbound_qty"]}박스' if r['inbound_qty'] > 0 else ''
                        lines.append(f'• {r["item_name"]}: {r["remain_qty"]}박스{consumed_str}{ib_str}')
                    telegram_send('\n'.join(lines))
        save_last_update_id(update['update_id'])

if __name__ == '__main__':
    main()

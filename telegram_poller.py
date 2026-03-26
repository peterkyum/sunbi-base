#!/usr/bin/env python3
"""선비칼국수 텔레그램 폴러 — 메시지를 파싱하여 Google Sheets에 기록."""

import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Optional

LOG_FILE = '/tmp/sunbi_poller_debug.log'
STATE_DIR = os.path.join(os.path.expanduser('~'), '.sunbi')
STATE_FILE = os.path.join(STATE_DIR, 'last_update_id.txt')


def log(msg: str) -> None:
    ts = datetime.now().strftime('%H:%M:%S')
    line = f'[{ts}] {msg}'
    print(line)
    try:
        with open(LOG_FILE, 'a') as f:
            f.write(line + '\n')
    except OSError:
        pass


def _load_env() -> None:
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

TELEGRAM_TOKEN: str = os.environ['TELEGRAM_TOKEN']
CHAT_ID: str = os.environ['CHAT_ID']
SCRIPT_URL: str = os.environ['SCRIPT_URL']
SPREADSHEET_ID: str = os.environ['SPREADSHEET_ID']
BOT_ID: int = int(TELEGRAM_TOKEN.split(':')[0])


def get_last_update_id() -> int:
    try:
        with open(STATE_FILE) as f:
            return int(f.read().strip())
    except (FileNotFoundError, ValueError):
        return 0


def save_last_update_id(uid: int) -> None:
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(STATE_FILE, 'w') as f:
        f.write(str(uid))


def telegram_get(method: str, params: str = '') -> dict:
    url = f'https://api.telegram.org/bot{TELEGRAM_TOKEN}/{method}{params}'
    res = urllib.request.urlopen(url, timeout=10)
    return json.loads(res.read().decode())


def telegram_send(text: str) -> None:
    url = f'https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage'
    payload = json.dumps({'chat_id': CHAT_ID, 'text': text, 'parse_mode': 'HTML'}).encode()
    req = urllib.request.Request(url, data=payload, headers={'Content-Type': 'application/json'})
    urllib.request.urlopen(req, timeout=10)


def parse_message(text: str) -> tuple[list[dict], list[dict]]:
    """텍스트에서 재고/입고 정보를 파싱.

    Returns:
        (stocks, inbounds) 튜플
    """
    lines = text.strip().split('\n')
    stocks: list[dict] = []
    inbounds: list[dict] = []
    for line in lines:
        t = line.strip()
        if not t:
            continue
        m = re.search(r'금일\s+(.+?)\s+(\d+)\s*박스', t)
        if m:
            name = m.group(1).strip()
            qty = int(m.group(2))
            if name and qty > 0:
                inbounds.append({'item_name': name, 'qty': qty})
            continue
        m = re.match(r'^(.+?)\s+(\d+)\s*박스', t)
        if m:
            name = m.group(1).strip()
            qty = int(m.group(2))
            if name and qty >= 0:
                stocks.append({'item_name': name, 'remain_qty': qty})
    return stocks, inbounds


def save_to_sheet(date: str, stocks: list[dict], inbounds: list[dict]) -> dict:
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
    req = urllib.request.Request(
        SCRIPT_URL, data=payload,
        headers={'Content-Type': 'text/plain'}, method='POST'
    )
    res = urllib.request.urlopen(req, timeout=15)
    body = res.read().decode()
    log(f'POST response: {body[:300]}')
    return json.loads(body)


# 봇 자신/알림 메시지 스킵 패턴
SKIP_PATTERNS = ('재고 입력 완료', '재고를 제출했어요')


def main() -> None:
    last_id = get_last_update_id()
    data = telegram_get('getUpdates', f'?offset={last_id + 1}&limit=10')
    updates = data.get('result', [])
    if not data.get('ok') or not updates:
        return

    log(f'=== {len(updates)}개 메시지 처리 시작 ===')

    kst = timezone(timedelta(hours=9))
    today = datetime.now(kst).strftime('%Y-%m-%d')

    for update in updates:
        msg = update.get('message', {})
        chat_id = msg.get('chat', {}).get('id')
        text = msg.get('text', '')
        log(f'update={update["update_id"]} chat={chat_id} text="{text[:50]}"')

        from_id = msg.get('from', {}).get('id')
        if from_id == BOT_ID:
            log('  skip: 봇 자신의 메시지')
            save_last_update_id(update['update_id'])
            continue
        if any(p in text for p in SKIP_PATTERNS):
            log('  skip: 알림 메시지')
            save_last_update_id(update['update_id'])
            continue
        if chat_id == int(CHAT_ID) and text:
            stocks, inbounds = parse_message(text)
            log(f'  parsed: {len(stocks)} stocks, {len(inbounds)} inbounds')
            if stocks:
                try:
                    result = save_to_sheet(today, stocks, inbounds)
                    log(f'  result success={result.get("success")}')
                    if result.get('success'):
                        saved = result.get('saved', [])
                        lines = [f'\u2705 <b>{today} 재고 입력 완료!</b>\n']
                        for r in saved:
                            consumed = r.get('consumed_qty')
                            ib = r.get('inbound_qty', 0)
                            consumed_str = f' | 소진 {consumed}박스' if consumed is not None and consumed > 0 else ''
                            ib_str = f' | 입고 +{ib}박스' if ib and ib > 0 else ''
                            lines.append(f'• {r["item_name"]}: {r["remain_qty"]}박스{consumed_str}{ib_str}')
                            log(f'  -> {r["item_name"]}: remain={r["remain_qty"]} consumed={consumed}')
                        telegram_send('\n'.join(lines))
                        log('  -> 텔레그램 확인 전송 완료')
                    else:
                        log(f'  FAIL: {result.get("error")}')
                except Exception as e:
                    log(f'  ERROR: {type(e).__name__}: {e}')
        save_last_update_id(update['update_id'])


if __name__ == '__main__':
    main()

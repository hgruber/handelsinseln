#!/usr/bin/env python3
"""Sonderbauphase (Mock): Vor dem Bau wird nicht automatisch mit der Bank getauscht.
Prüft, dass ein Bau, für den Rohstoffe fehlen, gesperrt ist und keinen Tausch auslöst,
und dass ein sofort bezahlbarer Bau weiterhin geht. Aufruf: python3 tests/browser_sbp.py"""
import json, subprocess
from playwright.sync_api import sync_playwright
from lib import ROOT, check, finish, free_port, problems, shots, wait_port

SHOTS = shots('sbp')
PORT = free_port()
SRV = subprocess.Popen(['node', 'tests/mock/serve.js', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
BASE = f'http://localhost:{PORT}/'


def open_sbp(b, hand, width=1200):
    base = json.load(open(f'{ROOT}/tests/mock/sbp.json'))
    base['me']['hand'] = hand
    ctx = b.new_context(viewport={'width': width, 'height': 800})
    pg = ctx.new_page()
    logs = []
    pg.on('pageerror', lambda e: problems.append(f'pageerror: {e}'))
    pg.on('console', lambda m: logs.append(m.text))
    pg.route('**/tests/mock/sbp.json', lambda r: r.fulfill(content_type='application/json', body=json.dumps(base)))
    pg.goto(BASE + '?mock=sbp')
    pg.wait_for_selector('#build [data-a="build"][data-k="road"]', timeout=6000)
    return pg, logs


try:
    wait_port(PORT)
    with sync_playwright() as p:
        b = p.chromium.launch()

        print('Fehlende Rohstoffe: kein automatischer Banktausch')
        pg, logs = open_sbp(b, {'holz': 5, 'lehm': 0, 'wolle': 0, 'getreide': 0, 'erz': 0})
        road = pg.locator('#build [data-a="build"][data-k="road"]')
        check(road.get_attribute('aria-disabled') == 'true', 'Straße ohne Lehm ist in der Sonderbauphase gesperrt')
        check('Dir fehlen' in (road.get_attribute('title') or ''), 'Titel nennt die fehlenden Rohstoffe')
        road.click(force=True)
        pg.wait_for_timeout(400)
        check(not any('bank_trade' in x for x in logs), 'kein Banktausch beim Bauversuch')
        check(not any('act' in x and 'build_' in x for x in logs), 'auch kein Bauversuch')
        trade = pg.locator('#build [data-a="trade"]')
        check(trade.get_attribute('aria-disabled') == 'true', 'Handeln ist in der Sonderbauphase gesperrt')
        check('Sonderbauphase' in (trade.get_attribute('title') or ''), 'Handelknopf nennt den Grund')
        trade.click(force=True)
        pg.wait_for_timeout(300)
        check(pg.locator('#tradeDock .tpanel').count() == 0, 'kein Handelsfenster in der Sonderbauphase')
        check(not any('trade_' in x for x in logs), 'auch kein Handelsversuch')
        pg.screenshot(path=f'{SHOTS}/sbp-gesperrt.png')

        print('Sofort bezahlbar: Bau bleibt möglich')
        pg2, _ = open_sbp(b, {'holz': 1, 'lehm': 1, 'wolle': 0, 'getreide': 0, 'erz': 0})
        road2 = pg2.locator('#build [data-a="build"][data-k="road"]')
        check(road2.get_attribute('aria-disabled') is None, 'Straße mit Holz und Lehm ist frei')
        pg2.screenshot(path=f'{SHOTS}/sbp-frei.png')
        b.close()
finally:
    SRV.terminate()
    SRV.wait()
finish(SHOTS, 'Sonderbauphase bestanden')

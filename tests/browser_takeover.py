#!/usr/bin/env python3
"""Übernahme der Infrastruktur eines Verlassenen in der echten Oberfläche (vorbereitetes Spiel, tests/takeover_server.js)."""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8195
BASE = f'http://127.0.0.1:{PORT}'
SHOTS = os.environ.get('SHOTS', '/tmp')
problems = []
srv = subprocess.Popen(['node', os.path.join(ROOT, 'tests/takeover_server.js'), str(PORT)], stdout=subprocess.PIPE, text=True)
info = json.loads(srv.stdout.readline())
def check(c, m):
    print('  ✓' if c else '  ✗', m)
    if not c: problems.append(m)
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_context(viewport={'width': 1500, 'height': 900}).new_page()
        page.on('pageerror', lambda e: problems.append(f'pageerror: {e}'))
        page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and problems.append(f'console: {m.text}'))
        page.goto(BASE)
        page.evaluate("t => localStorage.setItem('handelsinseln.token', t)", info['token'])
        page.reload()
        page.wait_for_selector('#hud:not([hidden])', timeout=8000)
        page.wait_for_selector('[data-a=takeover]', timeout=5000)
        check(True, 'Button „Übernehmen“ erscheint')
        check('Weggegangen' in page.locator('#players').inner_text() and ('verlassen' in page.locator('#players').inner_text().lower()), 'Spielerleiste markiert den Verlassenen')
        page.click('[data-a=takeover]')
        page.wait_for_selector('[data-t][data-kinds*=takeover]', timeout=3000)
        n = page.locator('[data-t][data-kinds*=takeover]').count()
        check(n == 1, f'{n} übernehmbares Teil hervorgehoben (nur die angrenzende Straße, die entfernte Siedlung noch nicht)')
        page.screenshot(path=f'{SHOTS}/takeover-modus.png')
        page.locator('[data-t=e][data-kinds*=takeover]').first.click()
        time.sleep(0.8)
        check(page.locator('[data-a=takeover]').count() == 0 or page.locator('[data-t][data-kinds*=takeover]').count() == 0, 'nach der Übernahme ist der Zug dafür verbraucht')
        page.screenshot(path=f'{SHOTS}/takeover-danach.png')
        log = page.locator('#logList').inner_text()
        check('übernimmt' in log, 'Protokoll meldet die Übernahme')
        b.close()
finally:
    srv.terminate()
print('Probleme:', problems if problems else 'keine')
sys.exit(1 if problems else 0)

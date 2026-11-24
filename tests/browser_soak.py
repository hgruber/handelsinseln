#!/usr/bin/env python3
"""Browser-Dauertest: ein echter Browser meldet sich über die Oberfläche an, weitere Spieler per API.
Testspieler steuern alle (auch den Browserspieler) – der Browser muss jeden Zustand fehlerfrei darstellen.
Aufruf: python3 tests/browser_soak.py [Spielerzahl] [Sekunden]"""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
from lib import ROOT, finish, poster, problems, shots, start_server

N = int(sys.argv[1]) if len(sys.argv) > 1 else 4
SECS = int(sys.argv[2]) if len(sys.argv) > 2 else 90
SHOTS = shots('shots')
COLORS = ['rot', 'blau', 'orange', 'weiss', 'gruen', 'violett']

server, BASE = start_server()
post = poster(BASE)
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_context(viewport={'width': 1500, 'height': 900}).new_page()
        page.on('pageerror', lambda e: problems.append('pageerror: %s' % e))
        page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and problems.append('console: %s' % m.text))
        page.on('response', lambda r: r.status >= 400 and r.status != 400 and '/img/' not in r.url and problems.append('HTTP %d %s' % (r.status, r.url)))
        page.goto(BASE)
        page.screenshot(path=f'{SHOTS}/01-anmeldung.png')
        page.fill('#nameIn', 'Browser-Bernd')
        page.locator('#swatches .sw').first.click()
        page.screenshot(path=f'{SHOTS}/02-farbe.png')
        page.click('#createBtn')
        page.wait_for_function("localStorage.getItem('handelsinseln.token')", timeout=5000)
        tok = page.evaluate("localStorage.getItem('handelsinseln.token')")
        assert tok, 'Token nicht gefunden'
        tokens = [tok]
        for i in range(2, N):
            c = [x for x in COLORS if x != 'rot'][i - 1]
            for x in COLORS:  # freie Farbe nehmen
                r = post('/api/join', {'name': f'Bot{i}', 'color': x})
                if 'token' in r:
                    tokens.append(r['token']); break
        time.sleep(1)
        page.screenshot(path=f'{SHOTS}/03-lobby.png')
        # zweiter Browser (eigener Kontext) tritt über die Spieleliste bei
        page2 = b.new_context(viewport={'width': 1300, 'height': 800}).new_page()
        page2.on('pageerror', lambda e: problems.append('pageerror(2): %s' % e))
        page2.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and problems.append('console(2): %s' % m.text))
        page2.goto(BASE)
        page2.fill('#nameIn', 'Browser-Berta')
        page2.wait_for_selector('#gameList [data-g]', timeout=6000)
        page2.locator('#gameList [data-g]').first.click()
        page2.locator('#swatches .sw:not([disabled])').last.click()
        page2.click('#joinBtn')
        page2.wait_for_function("localStorage.getItem('handelsinseln.token')", timeout=5000)
        tokens.append(page2.evaluate("localStorage.getItem('handelsinseln.token')"))
        time.sleep(0.8)
        page.screenshot(path=f'{SHOTS}/03b-lobby-voll.png')
        page2.screenshot(path=f'{SHOTS}/03c-lobby-gast.png')
        page.click('#startBtn')
        drv = subprocess.Popen(['node', os.path.join(ROOT, 'tests/drive.js'), BASE, '120'] + tokens)
        t0 = time.time(); n = 0
        while time.time() - t0 < SECS:
            time.sleep(SECS / 8)
            n += 1
            page.screenshot(path=f'{SHOTS}/10-spiel-{n}.png')
        drv.terminate()
        # Ende-Zustand notieren
        state = json.load(urllib.request.urlopen(BASE + '/api/games'))
        print('Spiele:', [(g['phase'], len(g['players'])) for g in state['games']])
        b.close()
finally:
    server.terminate()
finish(SHOTS)

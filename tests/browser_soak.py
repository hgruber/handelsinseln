#!/usr/bin/env python3
"""Browser-Dauertest: ein echter Browser meldet sich über die Oberfläche an, weitere Spieler per API.
Testspieler steuern alle (auch den Browserspieler) – der Browser muss jeden Zustand fehlerfrei darstellen.
Aufruf: python3 tests/browser_soak.py [Spielerzahl] [Sekunden]"""
import json, os, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

N = int(sys.argv[1]) if len(sys.argv) > 1 else 4
SECS = int(sys.argv[2]) if len(sys.argv) > 2 else 90
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8197
BASE = f'http://127.0.0.1:{PORT}'
SHOTS = os.environ.get('SHOTS', tempfile.mkdtemp(prefix='handelsinseln-shots-'))
os.makedirs(SHOTS, exist_ok=True)
COLORS = ['rot', 'blau', 'orange', 'weiss', 'gruen', 'violett']

def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), method='POST')
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        return json.load(e)

env = dict(os.environ, PORT=str(PORT), DATA_DIR=tempfile.mkdtemp())
server = subprocess.Popen(['node', os.path.join(ROOT, 'server/server.js')], env=env)
time.sleep(1)
problems = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_context(viewport={'width': 1500, 'height': 900}).new_page()
        page.on('pageerror', lambda e: problems.append('pageerror: %s' % e))
        page.on('console', lambda m: m.type == 'error' and 'status of 400' not in m.text and problems.append('console: %s' % m.text))
        page.goto(BASE)
        page.screenshot(path=f'{SHOTS}/01-anmeldung.png')
        page.fill('#nameIn', 'Browser-Bernd')
        page.locator('#swatches .sw').first.click()
        page.screenshot(path=f'{SHOTS}/02-farbe.png')
        page.click('#joinBtn')
        page.wait_for_function("localStorage.getItem('handelsinseln.token')", timeout=5000)
        tok = page.evaluate("localStorage.getItem('handelsinseln.token')")
        assert tok, 'Token nicht gefunden'
        tokens = [tok]
        for i in range(1, N):
            c = [x for x in COLORS if x != 'rot'][i - 1]
            for x in COLORS:  # freie Farbe nehmen
                r = post('/api/join', {'name': f'Bot{i}', 'color': x})
                if 'token' in r:
                    tokens.append(r['token']); break
        time.sleep(1)
        page.screenshot(path=f'{SHOTS}/03-lobby.png')
        page.get_by_role('button', name='Spiel starten').click()
        drv = subprocess.Popen(['node', os.path.join(ROOT, 'tests/drive.js'), BASE, '120'] + tokens)
        t0 = time.time(); n = 0
        while time.time() - t0 < SECS:
            time.sleep(SECS / 8)
            n += 1
            page.screenshot(path=f'{SHOTS}/10-spiel-{n}.png')
        drv.terminate()
        # Ende-Zustand notieren
        state = json.load(urllib.request.urlopen(BASE + '/api/lobby'))
        print('Phase:', state['phase'])
        b.close()
finally:
    server.terminate()
print('Screenshots:', SHOTS)
print('Probleme:', problems if problems else 'keine')
sys.exit(1 if problems else 0)

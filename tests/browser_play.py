#!/usr/bin/env python3
"""Echte Bedienung: Ein Browser-Spieler klickt sich durch Aufbau, Würfeln, Bauen, Handeln (Bank und Angebot),
Räuber, Abwerfen, Gold – gegen Testspieler. Prüft, dass die Oberfläche nie festhängt und keine Fehler wirft.
Aufruf: python3 tests/browser_play.py [Spielerzahl] [Sekunden]"""
import json, os, random, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

N = int(sys.argv[1]) if len(sys.argv) > 1 else 3
SECS = int(sys.argv[2]) if len(sys.argv) > 2 else 120
AUTO = len(sys.argv) > 3 and sys.argv[3] == 'auto'  # Würfeln und Räuber automatisch
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8198
BASE = f'http://127.0.0.1:{PORT}'
SHOTS = os.environ.get('SHOTS', tempfile.mkdtemp(prefix='handelsinseln-play-'))
os.makedirs(SHOTS, exist_ok=True)
COLORS = ['rot', 'blau', 'orange', 'weiss', 'gruen', 'violett']
stats = {}

def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), method='POST')
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        return json.load(e)

env = dict(os.environ, PORT=str(PORT), DATA_DIR=tempfile.mkdtemp())
server = subprocess.Popen(['node', os.path.join(ROOT, 'server/server.js')], env=env)
time.sleep(1)
problems, toasts = [], []
drv = None
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_context(viewport={'width': 1500, 'height': 900}).new_page()
        page.on('pageerror', lambda e: problems.append('pageerror: %s' % e))
        page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and problems.append('console: %s' % m.text))
        page.on('response', lambda r: r.status >= 400 and r.status != 400 and '/img/' not in r.url and problems.append('HTTP %d %s' % (r.status, r.url)))
        page.goto(BASE)
        page.fill('#nameIn', 'Mensch')
        page.locator('#swatches .sw').first.click()
        page.click('#createBtn')
        page.wait_for_function("localStorage.getItem('handelsinseln.token')", timeout=5000)
        tokens = []
        for i in range(1, N):
            for x in COLORS:
                r = post('/api/join', {'name': f'Bot{i}', 'color': x})
                if 'token' in r:
                    tokens.append(r['token']); break
        time.sleep(0.7)
        if AUTO:
            post('/api/act', {'token': page.evaluate("localStorage.getItem('handelsinseln.token')"), 'type': 'set_settings', 'settings': {'dice': 'auto', 'robber': 'auto', 'variant': 'nebel'}})
            time.sleep(0.5)
        page.click('#startBtn')
        drv = subprocess.Popen(['node', os.path.join(ROOT, 'tests/drive.js'), BASE, '150'] + tokens)

        def n(sel): return page.locator(sel).count()
        def enabled(sel):
            l = page.locator(sel)
            return l.count() > 0 and l.first.get_attribute('aria-disabled') != 'true' and 'dis' not in (l.first.get_attribute('class') or '').split()
        def click(sel, **kw):
            try:
                page.locator(sel).first.click(timeout=1500, **kw); return True
            except Exception as e:
                return False
        def note(k): stats[k] = stats.get(k, 0) + 1

        turn_done = set()
        t0 = time.time(); last_change = time.time(); last_sig = ''; shot = 0
        while time.time() - t0 < SECS:
            time.sleep(0.25)
            # Modale (Abwerfen, Gold, Stehlen, Sieger)
            if n('[data-m=discard]'):
                if not enabled('[data-m=discard]'): click('[data-m=refill]')
                if click('[data-m=discard]'): note('abgeworfen')
                continue
            if n('[data-m=gold]'):
                for _ in range(3):
                    if enabled('[data-m=gold]'): break
                    click('.tc[data-ms]')
                if click('[data-m=gold]'): note('gold')
                continue
            if n('[data-m=steal]'):
                if click('[data-m=steal]'): note('gestohlen')
                continue
            if n('[data-m=newgame]'):
                note('spielende'); page.screenshot(path=f'{SHOTS}/sieger.png'); break
            if n('.chooser [data-kind]'):
                click('.chooser [data-kind]'); continue
            if n('[data-a=roll]'):
                turn_done.clear()
                if click('[data-a=roll]'): note('gewuerfelt'); time.sleep(0.9)
                continue
            # Räuber / Aufbau: Klickziele
            if n('[data-t]') and not n('[data-a=end]'):
                if click('[data-t=h]') or click('[data-t=v]') or click('[data-t=e]'): note('ziel')
                continue
            if n('[data-a=skip_rb]') and n('[data-t]'):
                click('[data-t]'); continue
            if n('[data-a=sbp_done]'):
                for k in ('settlement', 'city'):
                    if k not in turn_done and enabled(f'[data-a=build][data-k={k}]'): turn_done.add(k); click(f'[data-a=build][data-k={k}]'); click('[data-t]'); note('sbp-bau')
                click('[data-a=sbp_done]'); continue
            if n('[data-a=end]'):
                plan = None
                for k in ('city', 'settlement', 'ship', 'road'):
                    if k not in turn_done and enabled(f'[data-a=build][data-k={k}]'):
                        plan = k; break
                if plan:
                    turn_done.add(plan)
                    click(f'[data-a=build][data-k={plan}]')
                    time.sleep(0.2)
                    if n('[data-t]'):
                        click('[data-t]'); time.sleep(0.2)
                        if n('.chooser [data-kind]'): click('.chooser [data-kind]')
                        note('gebaut-' + plan)
                    else:
                        note('kein-ziel-' + plan); click('[data-a=cancel]'); page.keyboard.press('Escape')
                    continue
                if 'dev' not in turn_done and enabled('[data-a=build][data-k=dev]'):
                    turn_done.add('dev'); click('[data-a=build][data-k=dev]'); note('devkarte'); continue
                if 'trade' not in turn_done and enabled('[data-a=trade]'):
                    turn_done.add('trade')
                    click('[data-a=trade]'); time.sleep(0.3)
                    if click('.rate:not(.off)'):
                        # passende Menge ist gefüllt; gewünschte Sorte wählen
                        want = random.choice(['holz', 'lehm', 'wolle', 'getreide', 'erz'])
                        if click(f'.tc[data-side=want][data-res={want}]'):
                            time.sleep(0.2)
                            if enabled('[data-do=bank]'): click('[data-do=bank]'); note('banktausch')
                            else:
                                # Gleichsorte? dann anderes wählen
                                pass
                    # Angebot an alle
                    click('[data-do=clear]')
                    mine = page.locator('.tc[data-side=give]:not(.dim)')
                    if mine.count():
                        mine.first.click(); page.locator('.tc[data-side=want]').nth(random.randrange(5)).click(); time.sleep(0.2)
                        if enabled('[data-do=offer]'):
                            click('[data-do=offer]'); note('angebot'); time.sleep(1.5)
                            if click('[data-do=cancel]'): note('zurueckgezogen')
                        else: click('[data-do=clear]')
                    click('[data-do=close]')
                    continue
                if click('[data-a=end]'): note('zugende'); turn_done.clear(); time.sleep(0.3)
                continue
            # Angebote anderer beantworten
            if n('[data-do=accept]') and enabled('[data-do=accept]'):
                click('[data-do=accept]'); note('angenommen'); continue
            if n('[data-do=decline]'):
                click('[data-do=decline]'); note('abgelehnt'); continue
            sig = page.evaluate("document.body.innerText.slice(0, 400)")
            if time.time() - last_change > 45 and sig == last_sig:
                problems.append('Oberfläche hängt: %s' % sig.replace('\n', ' | ')[:200]); page.screenshot(path=f'{SHOTS}/haengt.png'); break
            if sig != last_sig: last_sig = sig; last_change = time.time()
            if int(time.time() - t0) // 15 > shot:
                shot += 1; page.screenshot(path=f'{SHOTS}/spiel-{shot}.png')
        page.screenshot(path=f'{SHOTS}/ende.png')
        b.close()
finally:
    if drv: drv.terminate()
    server.terminate()
print('Aktionen des Browserspielers:', stats)
print('Screenshots:', SHOTS)
print('Probleme:', problems if problems else 'keine')
sys.exit(1 if problems else 0)

#!/usr/bin/env python3
"""Digitaler Spieltisch am echten Server: Spielleiter + 3 weitere Spieler (per API, ohne Browser), Tischmodus per Menü einschalten,
Sitzplätze/Drehung/Fokus prüfen, Handelsangebot (eigenes Menü je Mitspieler), Zoom springt zurück, Ausschalten stellt die normale Ansicht her.
Aufruf: python3 tests/browser_table.py"""
import json, os, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8196
BASE = f'http://127.0.0.1:{PORT}'
SHOTS = os.environ.get('SHOTS', tempfile.mkdtemp(prefix='handelsinseln-table-'))
os.makedirs(SHOTS, exist_ok=True)
problems = []

def check(cond, msg):
    if not cond: problems.append('FEHLER: ' + msg)
    print('  ' + ('✓' if cond else '✗'), msg)

def post(path, body):
    req = urllib.request.Request(BASE + path, json.dumps(body).encode(), {'Content-Type': 'application/json'})
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        return json.load(e)

env = dict(os.environ, PORT=str(PORT), DATA_DIR=tempfile.mkdtemp(), HTTPS_PORT='0', TICK_MS='300')
server = subprocess.Popen(['node', os.path.join(ROOT, 'server/server.js')], env=env)
time.sleep(1)
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_context(viewport={'width': 1600, 'height': 900}).new_page()
        pg.on('pageerror', lambda e: problems.append(f'pageerror: {e}'))
        pg.goto(BASE); pg.fill('#nameIn', 'Hanna'); pg.locator('#swatches .sw').first.click(); pg.click('#createBtn')
        pg.wait_for_selector('#lobby:not([hidden])', timeout=6000)
        tok = pg.evaluate("localStorage.getItem('handelsinseln.token')")
        games = json.load(urllib.request.urlopen(BASE + '/api/games'))['games']
        gid = games[0]['id']
        others = []
        for nm, col in (('Bernd', 'blau'), ('Carla', 'gruen'), ('Dora', 'orange')):
            r = post('/api/join', {'name': nm, 'color': col, 'game': gid}); others.append(r)
        check(all('token' in r for r in others), 'drei weitere Spieler beigetreten')
        post('/api/act', {'token': tok, 'type': 'set_settings', 'settings': {'dice': 'auto'}})
        pg.click('#startBtn'); pg.wait_for_selector('#btnMenu', state='visible', timeout=8000); time.sleep(1.2)

        # Nur der Spielleiter darf den Tisch schalten, Mitspieler dürfen nicht „im Namen von“ handeln
        r = post('/api/act', {'token': others[0]['token'], 'type': 'set_settings', 'settings': {'table': True}})
        check('error' in r, 'Mitspieler kann den Spieltisch nicht einschalten')
        r = post('/api/act', {'token': tok, 'type': 'end_turn', 'as': 1})
        check('error' in r and 'Spieltisch' in r['error'], 'ohne Spieltisch kein Handeln im Namen anderer')

        # Menü: Spieltisch einschalten
        pg.click('#btnMenu'); pg.locator('[data-mi="table"]').click()
        pg.wait_for_selector('body.table', timeout=6000); time.sleep(1.5)
        check(pg.locator('.seat').count() == 4, 'vier Sitzplätze')
        slots = pg.eval_on_selector_all('.seat', 'els => els.map(e => e.className.split(" ").find(c => c.startsWith("s-")))')
        check(sorted(slots) == ['s-b', 's-l', 's-r', 's-t'], f'Plätze verteilt unten/links/oben/rechts ({slots})')
        check(pg.locator('.seat.active').count() == 1, 'genau ein aktiver Platz (Fokus)')
        check(pg.locator('.seat.active #bottom').count() == 1, 'Menü des Spielers am Zug sitzt in seinem Platz')
        rot = pg.eval_on_selector_all('.seat', 'els => els.map(e => [e.className.split(" ").find(c => c.startsWith("s-")), getComputedStyle(e).transform])')
        check(all(t != 'none' for s, t in rot if s != 's-b'), 'Plätze außer unten sind gedreht')
        r = pg.evaluate("[...document.querySelectorAll('.seat')].map(e => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom, innerWidth, innerHeight]; })")
        check(all(x[0] >= -2 and x[1] >= -2 and x[2] <= x[4] + 2 and x[3] <= x[5] + 2 for x in r), 'alle Plätze liegen im Bild')
        check(pg.locator('#tableCenter #dice').count() == 1 and pg.locator('#tableCenter #banner').count() == 1, 'Würfel und Meldung bleiben in der Bildschirmmitte')
        pg.screenshot(path=f'{SHOTS}/tisch-4.png')

        # Der Spielleiter handelt im Namen des Fokus-Spielers
        view = lambda t: json.loads(urllib.request.urlopen(BASE + '/api/state?token=' + t).read()) if False else None
        # Aufbau durchspielen: Fokus muss mitwandern; Tisch setzt für den Fokus-Spieler
        t0 = time.time(); seen = set()
        while time.time() - t0 < 120:
            ph = pg.evaluate("document.body.dataset.screen")
            if ph == 'main': break
            seen.add(pg.evaluate("document.querySelector('.seat.active') && document.querySelector('.seat.active').dataset.pid"))
            # klickt die erste markierte Stelle des Fokus-Spielers (Siedlung/Straße), der Tisch sendet mit as
            idx = pg.evaluate("(() => { const W = innerWidth, H = innerHeight; const els = [...document.querySelectorAll('#board [data-t]')]; for (let i = 0; i < els.length; i++) { const b = els[i].getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2; if (x > W * .3 && x < W * .7 && y > H * .3 && y < H * .6) return i; } return -1; })()")
            tg = pg.locator('#board [data-t]').nth(max(idx, 0))
            if tg.count() and tg.is_visible():
                try: tg.click(timeout=1500, force=True)
                except Exception: pass
                ch = pg.locator('#chooser button').first
                if ch.count():
                    try: ch.click(timeout=1000)
                    except Exception: pass
            pg.wait_for_timeout(350)
            if os.environ.get('TABLE_DEBUG') and time.time() - t0 < 12: print('  dbg', pg.locator('#board [data-t]').count(), pg.locator('#toasts .toast').all_inner_texts(), pg.locator('#banner').inner_text()[:60])
            if os.environ.get('TABLE_DEBUG') and time.time() - t0 > 12: break
        check(pg.evaluate("document.body.dataset.screen") == 'main', 'Aufbau über den Tisch abgeschlossen (Hauptspiel läuft)')
        check(len([s for s in seen if s]) >= 3, f'Fokus wandert zwischen den Spielern ({sorted(s for s in seen if s)})')
        pg.screenshot(path=f'{SHOTS}/tisch-hauptspiel.png')

        # Zoom springt zurück
        k0 = pg.evaluate("document.getElementById('world').getAttribute('transform')")
        pg.mouse.move(800, 450)
        for _ in range(6): pg.mouse.wheel(0, -400)
        pg.wait_for_timeout(500)
        k1 = pg.evaluate("document.getElementById('world').getAttribute('transform')")
        check(k1 != k0, 'Zoomen ist möglich')
        pg.wait_for_timeout(3200)
        k2 = pg.evaluate("document.getElementById('world').getAttribute('transform')")
        check(k2 == k0, 'Ansicht springt zurück: ganzes Spielfeld wieder sichtbar')

        # Handelsangebot: jeder Mitspieler bekommt sein eigenes Menü
        v = None
        for _ in range(40):
            if pg.locator('.seat.active [data-a="trade"]:not([aria-disabled="true"])').count(): break
            if pg.locator('.seat.active [data-a="end"]').count() == 0 and pg.locator('.seat.active [data-a="roll"]').count(): pg.locator('.seat.active [data-a="roll"]').click()
            pg.wait_for_timeout(400)
        if pg.locator('.seat.active [data-a="trade"]:not([aria-disabled="true"])').count():
            pg.locator('.seat.active [data-a="trade"]').click(); pg.wait_for_timeout(400)
            hand = pg.evaluate("(() => { const o = {}; document.querySelectorAll('.seat.active #hand .rcard').forEach(c => { o[c.dataset.res] = Number((c.getAttribute('title') || '').split(': ')[1]) || 0; }); return o; })()")
            give = max(hand, key=lambda k: hand[k])
            want = [r for r in hand if r != give][0]
            pg.locator(f'#tradeDock .tc[data-side="give"][data-res="{give}"]').first.click()
            pg.locator(f'#tradeDock .tc[data-side="want"][data-res="{want}"]').first.click()
            pg.wait_for_timeout(300)
            if pg.locator('#tradeDock [data-do="offer"]:not([aria-disabled="true"])').count():
                pg.locator('#tradeDock [data-do="offer"]').click(); pg.wait_for_timeout(1000)
                check(pg.locator('.seat:not(.active) .tmenu').count() == 3, 'jeder der drei Mitspieler hat ein eigenes Handelsmenü')
                pg.screenshot(path=f'{SHOTS}/tisch-handel.png')
                other = pg.locator('.seat:not(.active) .tmenu [data-tr="decline"]').first
                other.click(); pg.wait_for_timeout(600)
                check(pg.locator('.seat:not(.active) .tmenu .st.no').count() >= 1, 'Ablehnen im Menü des Mitspielers wirkt')
            else:
                print('  (Handel übersprungen: Angebot nicht möglich)')

        # Ausschalten: normale Ansicht des Spielleiters
        pg.click('#btnMenu'); pg.locator('[data-mi="table"]').click()
        pg.wait_for_function("!document.body.classList.contains('table')", timeout=6000); time.sleep(1)
        check(pg.locator('.seat').count() == 0 and pg.locator('#bottom').is_visible(), 'Ausschalten: normale Ansicht ist zurück')
        check(pg.evaluate("document.querySelector('#hud > #bottom') !== null && document.querySelector('#hud > #banner') !== null"), 'Menüleiste und Meldung sind wieder am alten Platz')
    print('Screenshots:', SHOTS)
finally:
    server.terminate()
if problems:
    print('\n'.join(problems)); sys.exit(1)
print('Spieltisch-Test bestanden')

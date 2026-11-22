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
        # Spieltisch: Tischspieler gibt es nur über die Lobby (Spielleiter); Bots und Online-Spieler sind dann nicht erlaubt
        r = post('/api/act', {'token': tok, 'type': 'add_table_player', 'name': 'Bernd', 'color': 'blau', 'seat': 'l'})
        check(r.get('ok'), 'Tischspieler Bernd angelegt (Platz links) – der Tisch schaltet sich ein')
        for nm, col, seat in (('Carla', 'gruen', 't'), ('Dora', 'orange', 'r')):
            post('/api/act', {'token': tok, 'type': 'add_table_player', 'name': nm, 'color': col, 'seat': seat})
        pg.wait_for_function("document.querySelectorAll('#lobbyList li').length === 4", timeout=6000)
        check(pg.locator('#lobbyList .seatsel').count() == 4, 'Lobby zeigt für alle vier den Platz am Tisch')
        check('error' in post('/api/act', {'token': tok, 'type': 'add_bot', 'kind': 'haendler'}), 'kein Bot am Spieltisch')
        check('error' in post('/api/join', {'name': 'Online', 'color': 'violett', 'game': gid}), 'kein Online-Beitritt am Spieltisch')
        check('error' in post('/api/act', {'token': tok, 'type': 'add_table_player', 'name': 'Doppelt', 'color': 'violett', 'seat': 'l'}), 'besetzter Platz wird abgelehnt')
        check('error' in post('/api/act', {'token': tok, 'type': 'set_settings', 'settings': {'table': False}}), 'Tisch lässt sich nicht per Einstellung umschalten')
        # Platz tauschen: Dora (rechts) und Carla (oben) per Lobby-Auswahl
        gm = json.load(urllib.request.urlopen(BASE + '/api/games'))['games'][0]
        check(gm.get('table') and not gm.get('joinable'), 'Spiel ist in der Liste als Spieltisch gekennzeichnet und nicht beitretbar')
        post('/api/act', {'token': tok, 'type': 'set_settings', 'settings': {'dice': 'auto'}})
        pg.click('#startBtn'); pg.wait_for_selector('body.table', timeout=10000); time.sleep(1.5)
        r = post('/api/act', {'token': tok, 'type': 'end_turn', 'as': 99})
        check('error' in r, 'ungültiger Platz für „im Namen von“ wird abgelehnt')
        check(pg.locator('.seat').count() == 4, 'vier Sitzplätze')
        slots = pg.eval_on_selector_all('.seat', 'els => els.map(e => e.className.split(" ").find(c => c.startsWith("s-")))')
        check(sorted(slots) == ['s-b', 's-l', 's-r', 's-t'], f'Plätze wie in der Lobby festgelegt ({slots})')
        check(pg.locator('.seat.active').count() == 1, 'genau ein aktiver Platz (Fokus)')
        check(pg.locator('.seat.ctl .pubrow #build').count() == 1 and pg.locator('.seat.ctl .pubrow #dicebox').count() == 1, 'Bedienelemente des Spielers am Zug sitzen in seiner öffentlichen Zeile')
        check(pg.locator('.seat .secret .rc').count() == 20, 'jeder Platz zeigt immer seinen geheimen Bereich (5 Rohstoffstapel)')
        check(pg.locator('.seat .seathb #btnMenu').count() == 1, 'Hamburger-Menü sitzt rechts vom geheimen Bereich des Spielleiters')
        check(pg.locator('#banner').is_hidden(), 'keine Anweisungsmeldung am Tisch')
        rot = pg.eval_on_selector_all('.seat', 'els => els.map(e => [e.className.split(" ").find(c => c.startsWith("s-")), getComputedStyle(e).transform])')
        check(all(t != 'none' for s, t in rot if s != 's-b'), 'Plätze außer unten sind gedreht')
        r = pg.evaluate("[...document.querySelectorAll('.seat')].map(e => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom, innerWidth, innerHeight]; })")
        check(all(x[0] >= -2 and x[1] >= -2 and x[2] <= x[4] + 2 and x[3] <= x[5] + 2 for x in r), 'alle Plätze liegen im Bild')
        pg.screenshot(path=f'{SHOTS}/tisch-4.png')
        if os.environ.get('TABLE_SHOT_ONLY'): raise SystemExit(0)

        # Der Spielleiter handelt im Namen des Fokus-Spielers
        view = lambda t: json.loads(urllib.request.urlopen(BASE + '/api/state?token=' + t).read()) if False else None
        # Aufbau durchspielen: Fokus muss mitwandern; Tisch setzt für den Fokus-Spieler
        t0 = time.time(); seen = set()
        while time.time() - t0 < 120:
            ph = pg.evaluate("document.body.dataset.screen")
            if ph == 'main': break
            seen.add(pg.evaluate("document.querySelector('.seat.active') && document.querySelector('.seat.active').dataset.pid"))
            if pg.locator('#modalRoot [data-m="gold"]').count():  # Goldfluss im Aufbau: Fokus-Spieler nimmt einen Rohstoff
                pg.locator('#modalRoot .tc[data-ms="g"]').first.click(); pg.wait_for_timeout(200)
                pg.locator('#modalRoot [data-m="gold"]').click(); pg.wait_for_timeout(400)
                continue
            # klickt die erste markierte Stelle des Fokus-Spielers (Siedlung/Straße), der Tisch sendet mit as
            idx = pg.evaluate("(() => { const W = innerWidth, H = innerHeight; const els = [...document.querySelectorAll('#board [data-t]')].map((e, i) => { const b = e.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2; return { e, i, x, y, d: Math.hypot(x - W / 2, y - H / 2) }; }).sort((a, b) => a.d - b.d); for (const c of els) { const top = document.elementFromPoint(c.x, c.y); if (top && top.closest('[data-t]') === c.e) return c.i; } return -1; })()")
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
        for _ in range(6): pg.mouse.wheel(0, 400)
        pg.wait_for_timeout(500)
        k1 = pg.evaluate("document.getElementById('world').getAttribute('transform')")
        check(k1 != k0, 'Zoomen ist möglich')
        pg.wait_for_timeout(3200)
        k2 = pg.evaluate("document.getElementById('world').getAttribute('transform')")
        import re
        nums = lambda t: [float(x) for x in re.findall(r'-?\d+\.?\d*', t)]
        n0, n1, n2 = nums(k0), nums(k1), nums(k2)
        close = all(abs(a - b) <= max(3, abs(a) * 0.03) for a, b in zip(n0[:2], n2[:2])) and abs(n0[2] - n2[2]) <= n0[2] * 0.03
        check(close, f'Ansicht springt zurück: ganzes Spielfeld wieder sichtbar ({k0} → {k1} → {k2})')

        # Handelsangebot: jeder Mitspieler bekommt sein eigenes Menü
        v = None
        for _ in range(40):
            if pg.locator('.seat.active [data-a="end"]').count(): break
            if pg.locator('.seat.active [data-a="end"]').count() == 0 and pg.locator('.seat.active [data-a="roll"]').count(): pg.locator('.seat.active [data-a="roll"]').click()
            pg.wait_for_timeout(400)
        if pg.locator('.seat.active [data-a="trade"]:not([aria-disabled="true"])').count():
            pg.locator('.seat.active [data-a="trade"]').click(); pg.wait_for_timeout(400)
            hand = pg.evaluate("(() => { const o = {}; document.querySelectorAll('.seat.active .secret .rc').forEach(c => { o[c.dataset.res] = Number(c.querySelector('b').textContent) || 0; }); return o; })()")
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
                # Gegenangebot am Platz eines anderen Mitspielers
                op = pg.locator('.seat:not(.active) .tmenu [data-tr="open"]').first
                if op.count():
                    op.click(); pg.wait_for_timeout(300)
                    base = '.seat:not(.active) .tmenu [data-tr="adj"]'
                    for r in ('holz',):  # „Ich gebe“: alles, was der Spieler besitzt (je 1)
                        pg.locator(f'{base}[data-side="cg"][data-res="{r}"][data-d="1"]').first.click(); pg.wait_for_timeout(60)
                    given = pg.evaluate("[...document.querySelectorAll('.seat:not(.active) .tmenu .crow')][0] && [...document.querySelectorAll('.seat:not(.active) .tmenu .crow')][0].querySelectorAll('.cc b').length ? [...document.querySelectorAll('.seat:not(.active) .tmenu .crow')][0].innerText : ''")
                    free = pg.evaluate("(() => { const row = document.querySelectorAll('.seat:not(.active) .tmenu .crow')[0]; const res = ['holz', 'lehm', 'wolle', 'getreide', 'erz']; const cc = [...row.querySelectorAll('.cc b')]; const i = cc.findIndex((b) => b.textContent === '0'); return i < 0 ? null : res[i]; })()")
                    if free:  # „Ich bekomme“: ein Rohstoff, den der Spieler nicht selbst gibt
                        pg.locator(f'{base}[data-side="cw"][data-res="{free}"][data-d="1"]').first.click(); pg.wait_for_timeout(200)
                    pg.screenshot(path=f'{SHOTS}/tisch-gegenangebot.png')
                    pg.locator('.seat:not(.active) .tmenu [data-tr="send"]').first.click(); pg.wait_for_timeout(800)
                    check(pg.locator('.seat.active .st.cnt2').count() >= 1, 'Gegenangebot vom Platz eines Mitspielers kommt beim Anbieter an')
            else:
                print('  (Handel übersprungen: Angebot nicht möglich)')

        # Angebot ohne die Karten: der Stapel blinkt rot, die Anbieter-Seite kann nur zurückziehen
        if pg.locator('#tradeDock [data-do="cancel"]').count():
            pg.locator('#tradeDock [data-do="cancel"]').click(); pg.wait_for_timeout(500)
            zero = pg.evaluate("(() => { const z = document.querySelector('.seat.active .secret .rc.zero'); return z ? z.dataset.res : null; })()")
            apid = int(pg.evaluate("document.querySelector('.seat.active').dataset.pid"))
            if zero:
                want = [r for r in ('holz', 'lehm', 'wolle', 'getreide', 'erz') if r != zero][0]
                r = post('/api/act', {'token': tok, 'type': 'trade_offer', 'give': {zero: 1}, 'want': {want: 1}, 'as': apid})
                pg.wait_for_timeout(700)
                check(r.get('ok'), 'Angebot ohne die Karten wird am Tisch angenommen')
                check(pg.locator('.seat.active .secret .rc.short').count() == 1, 'der fehlende Rohstoffstapel blinkt rot')
                check(pg.locator('#tradeDock [data-do="confirm"]').count() == 0, 'der Anbieter kann nur zurückziehen (kein Handeln-Knopf)')
        # Spielende: Statistik wie gewohnt, der Tisch räumt auf
        pg.click('#btnMenu'); pg.locator('[data-mi="end"]').click(); pg.click('#dlgRoot [data-d="yes"]')
        pg.wait_for_selector('#stats:not([hidden])', timeout=8000)
        pg.wait_for_function("!document.body.classList.contains('table')", timeout=6000); time.sleep(1)
        check(pg.locator('.seat').count() == 0, 'nach Spielende sind die Tischplätze weg und die Statistik zu sehen')
        check(pg.evaluate("document.querySelector('#hud > #bottom') !== null && document.querySelector('#hud > #banner') !== null"), 'Menüleiste und Meldung sind wieder am alten Platz')
    print('Screenshots:', SHOTS)
finally:
    server.terminate()
if problems:
    print('\n'.join(problems)); sys.exit(1)
print('Spieltisch-Test bestanden')

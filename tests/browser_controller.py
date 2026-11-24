#!/usr/bin/env python3
"""Controller-Ansicht (Phase 2): Ein Handy (Spieler) schaltet in die Controller-Ansicht, sobald eine Tisch-Anzeige (Zuschauer) verbunden ist.
Aufbau am Tisch: Handy gibt „Siedlung“ frei → die Tisch-Anzeige zeigt die Ziele → jemand tippt eines an → das Handy fragt nach →
die Freigabe am Handy gilt als Bestätigung, der Tipp am Tisch baut sofort. Prüft auch: ohne Freigabe nichts wählbar, Fremde (Spieler-Token) dürfen nicht wählen, Straße/Schiff,
Verschwinden der Tisch-Anzeige schaltet die Controller-Ansicht aus. Aufruf: python3 tests/browser_controller.py"""
import json, os, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8198
BASE = f'http://127.0.0.1:{PORT}'
SHOTS = os.environ.get('SHOTS', tempfile.mkdtemp(prefix='handelsinseln-controller-'))
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
        j = json.load(e); j['_status'] = e.code; return j

def first_event(token):
    r = urllib.request.urlopen(BASE + '/api/events?token=' + token, timeout=5)
    ev = None; data = None
    while True:
        line = r.readline().decode()
        if line.startswith('event:'): ev = line[6:].strip()
        elif line.startswith('data:') and ev == 'state': data = json.loads(line[5:]); break
    r.close()
    return data

def pick_on_tv(T, sel, done, start=3):
    """Tippt am Tisch Ziele an, bis `done()` wahr ist (ein Ziel kann unter einer Leiste liegen); die Aktion läuft sofort."""
    n = T.locator(sel).count()
    for i in list(range(start, n)) + list(range(0, start)):
        T.locator(sel).nth(i).click(force=True)
        if T.locator('#chooser').count(): T.locator('#chooser [data-kind="road"]').click()
        for _ in range(8):
            time.sleep(0.2)
            if done(): return True
    return False

def clear(pg):  # „Spielreihenfolge“ u. Ä. schließen sich nur per Klick: für den Test entfernen
    pg.evaluate("document.querySelectorAll('.devshow').forEach(e => e.remove())")

env = dict(os.environ, PORT=str(PORT), DATA_DIR=tempfile.mkdtemp(), HTTPS_PORT='0', TICK_MS='300', BOT_MS='150')
server = subprocess.Popen(['node', os.path.join(ROOT, 'server/server.js')], env=env)
time.sleep(1)
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        P = b.new_context(**p.devices['iPhone 13']).new_page()
        P.on('pageerror', lambda e: problems.append(f'pageerror Handy: {e}'))
        P.goto(BASE); P.fill('#nameIn', 'Anna'); P.locator('#swatches .sw').first.click(); P.click('#createBtn')
        P.wait_for_selector('#lobby:not([hidden])', timeout=6000)
        tok = P.evaluate("localStorage.getItem('handelsinseln.token')")
        for k in ('baumeister', 'haendler'): post('/api/act', {'token': tok, 'type': 'add_bot', 'kind': k})
        time.sleep(1.2)  # Lobby-Einstellungen (Seitenverhältnis) vor dem Start abschicken lassen
        check(post('/api/act', {'token': tok, 'type': 'start'}).get('ok'), 'Spiel gestartet')
        P.wait_for_selector('#hud:not([hidden])', timeout=6000)

        print('Ohne Tisch-Anzeige gibt es keine Controller-Ansicht')
        P.click('#btnMenu')
        check(P.locator('.menu-pop [data-mi="ctl"]').count() == 0, 'Menü ohne Eintrag „Controller-Ansicht“')
        P.keyboard.press('Escape'); P.mouse.click(5, 5)
        check(post('/api/act', {'token': tok, 'type': 'arm', 'mode': 'road'}).get('error') is not None, 'Freigeben ohne Zug wird abgelehnt')

        print('Tisch-Anzeige verbindet')
        T = b.new_context(viewport={'width': 1280, 'height': 720}).new_page()
        T.on('pageerror', lambda e: problems.append(f'pageerror Tisch: {e}'))
        T.goto(BASE); T.wait_for_selector('#gameList .gcard.run', timeout=6000); T.click('#gameList .gcard.run'); T.click('#joinBtn')
        T.wait_for_selector('body.watch #seats .seat', timeout=8000)
        wtok = T.evaluate("localStorage.getItem('handelsinseln.token')")
        time.sleep(0.8)
        check(P.evaluate("document.body.classList.contains('ctl')"), 'Controller-Ansicht ist mit Tisch-Anzeige von selbst an')
        check(P.locator('#board').is_hidden(), 'Spielfeld am Handy ausgeblendet')
        check(P.locator('#bottom').is_visible(), 'Bedienung bleibt sichtbar')
        check(P.locator('#players').is_hidden() and P.locator('#logPanel').is_hidden(), 'nur Karten und Aktionen (keine Spielerliste, kein Protokoll)')
        P.screenshot(path=f'{SHOTS}/controller-start.png')
        P.click('#btnMenu')
        check('Karte anzeigen' in P.inner_text('.menu-pop [data-mi="ctl"]'), 'Menüeintrag: „Karte anzeigen“')
        P.click('.menu-pop [data-mi="ctl"]'); time.sleep(0.6)
        check(not P.evaluate("document.body.classList.contains('ctl')") and P.locator('#board').is_visible(), 'Karte angezeigt')
        P.click('#btnMenu')
        check('Nur Karten' in P.inner_text('.menu-pop [data-mi="ctl"]'), 'Menüeintrag wechselt zurück zu „Nur Karten & Aktionen“')
        P.click('.menu-pop [data-mi="ctl"]'); time.sleep(0.6)
        check(P.evaluate("document.body.classList.contains('ctl')"), 'zurück in der Controller-Ansicht')

        print('Reihenfolge auswürfeln, dann freigeben')
        for _ in range(80):
            clear(P)
            if P.locator('[data-a="roll"]').count(): P.locator('[data-a="roll"]').first.click(); time.sleep(0.4)
            if P.locator('#armPanel [data-arm="start"]').count(): break
            time.sleep(0.4)
        check(P.locator('#armPanel [data-arm="start"]').count() == 1, 'Handy: Freigabe-Fenster „Am Spieltisch wählen“')
        check(T.locator('#world .L-target [data-t]').count() == 0, 'Tisch: ohne Freigabe keine Ziele')
        r = post('/api/pick', {'token': wtok, 't': 'v', 'k': 'a|b|c', 'kind': 'settlement'})
        check('error' in r, 'Tisch: Wählen ohne Freigabe wird abgelehnt')
        check(post('/api/pick', {'token': tok, 't': 'v', 'k': 'x', 'kind': 'settlement'}).get('_status') == 403, 'Spieler-Token darf am Tisch nichts wählen (403)')

        print('Freigeben → Tisch zeigt Ziele → antippen → gebaut')
        clear(P); P.click('#armPanel [data-arm="start"]'); time.sleep(0.8)
        n = T.locator('#world .L-target [data-t]').count()
        check(n > 0, f'Tisch zeigt {n} Ziele')
        check('Tippe auf den Tisch' in T.inner_text('#seats'), 'Tisch: Hinweis am Platz des Spielers')
        check(P.locator('#armPanel .arm.wait').count() == 1, 'Handy: „Schau auf den Spieltisch“')
        T.screenshot(path=f'{SHOTS}/tisch-ziele.png'); P.screenshot(path=f'{SHOTS}/controller-wartet.png')
        me = first_event(tok)['you']
        mine = lambda: [k for k, x in first_event(tok)['verts'].items() if x['p'] == me]
        P.screenshot(path=f'{SHOTS}/controller-wartet2.png')
        check(pick_on_tv(T, '#world .L-target [data-t]', lambda: len(mine()) == 1), 'Tipp am Tisch führt sofort aus: die Siedlung steht (ohne Bestätigung am Handy)')
        time.sleep(0.6)
        check(T.locator('#world .L-target [data-t]').count() == 0, 'Tisch: Ziele sind weg')

        print('Straße oder Schiff')
        for _ in range(40):
            clear(P)
            if P.locator('#armPanel [data-arm="start"]').count(): break
            time.sleep(0.4)
        clear(P); P.click('#armPanel [data-arm="start"]'); time.sleep(0.8)
        check(T.locator('#world .L-target [data-t="e"]').count() > 0, 'Tisch zeigt Kanten für Straße/Schiff')
        mine_e = lambda: [k for k, x in first_event(tok)['edges'].items() if x['p'] == me]
        check(pick_on_tv(T, '#world .L-target [data-t="e"]', lambda: len(mine_e()) == 1, 0), 'Tipp am Tisch legt Straße/Schiff sofort')

        print('Tisch-Anzeige verschwindet / kommt zurück')
        T.close(); time.sleep(1.5)
        check(not P.evaluate("document.body.classList.contains('ctl')"), 'ohne Tisch-Anzeige: normale Ansicht mit Spielfeld')
        check(P.locator('#board').is_visible(), 'Spielfeld wieder da')
        T2 = b.new_context(viewport={'width': 1280, 'height': 720}).new_page()
        T2.goto(BASE); T2.wait_for_selector('#gameList .gcard.run', timeout=6000); T2.click('#gameList .gcard.run'); T2.click('#joinBtn')
        T2.wait_for_selector('body.watch #seats .seat', timeout=8000); time.sleep(1.0)
        check(P.evaluate("document.body.classList.contains('ctl')"), 'Tisch-Anzeige wieder da: Controller-Ansicht kehrt zurück (gemerkte Wahl)')
        b.close()
finally:
    server.terminate()
print('Screenshots:', SHOTS)
print('Probleme:', 'keine' if not problems else '\n' + '\n'.join(problems))
sys.exit(1 if problems else 0)

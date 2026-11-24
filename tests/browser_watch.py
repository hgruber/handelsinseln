#!/usr/bin/env python3
"""Zuschauer (Phase 1): Ein Browser wählt auf der Startseite ein laufendes Spiel (farblich abgesetzt, Knopf „Spiel ansehen“) und sieht die
öffentliche Tisch-Anzeige – ohne Hand, Entwicklungskarten, Chat, ohne Aktionen. Prüft Server (Sicht, 403, Limit) und Oberfläche.
Aufruf: python3 tests/browser_watch.py"""
import json, os, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8197
BASE = f'http://127.0.0.1:{PORT}'
SHOTS = os.environ.get('SHOTS', tempfile.mkdtemp(prefix='handelsinseln-watch-'))
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
    """Liest das erste Ereignis des Streams (state) und gibt die JSON-Daten zurück."""
    r = urllib.request.urlopen(BASE + '/api/events?token=' + token, timeout=5)
    ev = None; data = None
    while True:
        line = r.readline().decode()
        if line.startswith('event:'): ev = line[6:].strip()
        elif line.startswith('data:') and ev == 'state': data = json.loads(line[5:]); break
    r.close()
    return data

env = dict(os.environ, PORT=str(PORT), DATA_DIR=tempfile.mkdtemp(), HTTPS_PORT='0', TICK_MS='300', ABSENT_MS='800', BOT_MS='120')
server = subprocess.Popen(['node', os.path.join(ROOT, 'server/server.js')], env=env)
time.sleep(1)
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        A = b.new_context(viewport={'width': 1280, 'height': 800}).new_page()
        A.on('pageerror', lambda e: problems.append(f'pageerror Spieler: {e}'))
        A.goto(BASE); A.fill('#nameIn', 'Hanna'); A.locator('#swatches .sw').first.click(); A.click('#createBtn')
        A.wait_for_selector('#lobby:not([hidden])', timeout=6000)
        tok = A.evaluate("localStorage.getItem('handelsinseln.token')")
        gid = json.load(urllib.request.urlopen(BASE + '/api/games'))['games'][0]['id']

        print('Zuschauen ist nur bei laufenden Spielen möglich')
        r = post('/api/watch', {'game': gid})
        check('error' in r, 'Lobby-Spiel: kein Zuschauen')
        check(not json.load(urllib.request.urlopen(BASE + '/api/games'))['games'][0]['watchable'], 'Liste: Lobby-Spiel nicht „watchable“')

        for k in ('baumeister', 'haendler'): post('/api/act', {'token': tok, 'type': 'add_bot', 'kind': k})
        post('/api/act', {'token': tok, 'type': 'chat', 'text': 'geheimer Chat'})
        check(post('/api/act', {'token': tok, 'type': 'start'}).get('ok'), 'Spiel gestartet')
        A.close()  # Spielleiter weg: Auto-Modus spielt weiter, damit das Spiel von allein läuft
        time.sleep(1.5)
        g = json.load(urllib.request.urlopen(BASE + '/api/games'))['games'][0]
        check(g['watchable'] and g['joinable'] is False, 'Liste: laufendes Spiel ist „watchable“, nicht beitretbar')

        print('Startseite: laufendes Spiel farblich abgesetzt, Knopf „Spiel ansehen“')
        W = b.new_context(viewport={'width': 1600, 'height': 900}).new_page()
        W.on('pageerror', lambda e: problems.append(f'pageerror Zuschauer: {e}'))
        W.on('console', lambda m: m.type == 'error' and problems.append(f'console.error Zuschauer: {m.text}'))
        W.goto(BASE); W.wait_for_selector('#gameList .gcard.run', timeout=6000)
        check(W.locator('#gameList .gcard.run').count() == 1, 'Karte des laufenden Spiels (gcard.run)')
        check(W.locator('#joinBtn').is_hidden(), 'ohne Auswahl: kein „Beitreten“-Knopf (nichts beitretbar)')
        W.click('#gameList .gcard.run')
        check(W.locator('#joinBtn').is_visible() and W.inner_text('#joinBtn').strip() == 'Spiel ansehen', 'Knopf heißt „Spiel ansehen“')
        W.screenshot(path=f'{SHOTS}/watch-login.png')
        W.click('#joinBtn')
        W.wait_for_selector('body.watch #seats .seat', timeout=8000)
        time.sleep(1.5)
        wtok = W.evaluate("localStorage.getItem('handelsinseln.token')")
        check(bool(wtok) and wtok != tok, 'Zuschauer hat eigenen Token')

        print('Oberfläche: öffentliche Tisch-Anzeige')
        check(W.locator('#seats .seat').count() == 3, 'drei Plätze am Tisch')
        check(W.locator('#seats .seat .badge:visible').count() == 3, 'je Platz ein sichtbares Namensfeld')
        check(W.locator('.secretrow').first.is_hidden(), 'geheimer Bereich ausgeblendet')
        check(W.locator('#build').is_hidden() and W.locator('#primary').is_hidden(), 'keine Bau-/Würfelknöpfe')
        check(W.locator('#side').is_hidden() and W.locator('#players').is_hidden(), 'kein Protokoll/Chat-Panel')
        check(W.locator('#board').is_visible(), 'Spielbrett sichtbar')
        check(W.locator('#seatAsk').count() == 0, 'keine Platzabfrage')
        W.screenshot(path=f'{SHOTS}/watch-table.png')
        print('Ansicht ohne Tischspieler: Leisten oben links am Rand, Meldungen in der Mitte')
        bb = W.locator('#seats .seat .badge.top').first.bounding_box()
        check(bb['x'] <= 1 and bb['y'] <= 1, f'erste Spielerleiste liegt ohne Abstand in der Ecke ({bb["x"]:.0f},{bb["y"]:.0f})')
        xs = W.eval_on_selector_all('#seats .seat .badge.top', 'els => els.map(e => Math.round(e.getBoundingClientRect().left))')
        check(len(set(xs)) == 1, f'alle Leisten untereinander am linken Rand: {xs}')
        print('Karte drehen: Chips bleiben aufrecht')
        ang0 = W.evaluate("document.getElementById('world').getAttribute('transform')")
        W.click('#btnRotR'); time.sleep(1.5)
        ang1 = W.evaluate("document.getElementById('world').getAttribute('transform')")
        check(ang0 != ang1 and 'rotate(60.00)' in ang1, f'Karte ist um 60° gedreht ({ang1[:60]})')
        chip = W.evaluate("(() => { const c = document.querySelector('#world .hex .chip'); const m = new DOMMatrix(getComputedStyle(c).transform); const w = c.getScreenCTM(); return Math.round(Math.atan2(w.b, w.a) * 180 / Math.PI); })()")
        check(chip == 0, f'Zahlenchip steht auf dem Bildschirm aufrecht (Winkel {chip}°)')
        W.screenshot(path=f'{SHOTS}/watch-rotated.png')
        W.click('#btnRotL'); time.sleep(1.2)
        W.click('#btnMenu')
        items = W.eval_on_selector_all('.menu-pop [data-mi]', 'els => els.map(e => e.dataset.mi)')
        check(items == ['settings', 'sound', 'fit', 'help', 'leave'], f'Zuschauer-Menü ohne Sprachchat/Spielleiter-Funktionen: {items}')
        W.keyboard.press('Escape'); W.mouse.click(5, 5)

        print('Server: Sicht, Rechte, Limit')
        v = first_event(wtok)
        check(v.get('watch') is True and v['you'] == -1 and v['host'] == -1, 'Sicht: watch, you=-1, host=-1')
        check(v['me']['hand'] == {} and v['me']['dev'] == [] and v['me']['hiddenVp'] == 0, 'Sicht: keine Hand, keine Entwicklungskarten')
        check(v['chat'] == [], 'Sicht: kein Chat')
        check(all(not (e.get('c') and not e.get('pub')) for e in v['fx']), 'Sicht: keine verdeckten Kartenbewegungen')
        check(v['legal']['settlement'] == [] and v['legal']['road'] == [], 'Sicht: keine Aktionen möglich')
        txt = json.dumps(v)
        check(tok not in txt, 'Sicht enthält keinen Spieler-Token')
        r = post('/api/act', {'token': wtok, 'type': 'chat', 'text': 'ich darf nicht'})
        check(r.get('_status') == 403, 'Zuschauer-Aktion wird abgelehnt (403)')
        check(post('/api/signal', {'token': wtok, 'to': 'all', 'data': {}}).get('_status') == 403, 'Zuschauer-Signal (Sprachchat) wird abgelehnt')
        toks = []
        for i in range(8):
            r = post('/api/watch', {'game': gid})
            if 'token' in r: toks.append(r['token'])
        check(len(toks) == 7 and 'error' in post('/api/watch', {'game': gid}), 'Limit: höchstens 8 Zuschauer je Spiel')
        for t in toks: post('/api/leave', {'token': t})
        check('token' in post('/api/watch', {'game': gid}), 'nach dem Verlassen wird wieder ein Platz frei')

        print('Zuschauen beenden')
        W.click('#btnMenu'); W.click('.menu-pop [data-mi="leave"]')
        W.wait_for_selector('#login:not([hidden])', timeout=4000)
        check(W.evaluate("localStorage.getItem('handelsinseln.token')") is None, 'Token entfernt')
        check(post('/api/act', {'token': wtok, 'type': 'chat', 'text': 'x'}).get('_status') == 401, 'Token ist danach ungültig')

        print('Neuladen: Zuschauer bleibt dabei')
        W.wait_for_selector('#gameList .gcard.run')
        if W.locator('#joinBtn').is_hidden(): W.click('#gameList .gcard.run')  # Auswahl bleibt nach dem Verlassen erhalten
        W.click('#joinBtn')
        W.wait_for_selector('body.watch #seats .seat', timeout=8000)
        W.reload(); W.wait_for_selector('body.watch #seats .seat', timeout=8000)
        check(W.locator('#seats .seat').count() == 3, 'nach Neuladen wieder die Tisch-Anzeige')
        b.close()
finally:
    server.terminate()
print('Screenshots:', SHOTS)
print('Probleme:', 'keine' if not problems else '\n' + '\n'.join(problems))
sys.exit(1 if problems else 0)

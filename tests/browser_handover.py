#!/usr/bin/env python3
"""Kontrollübergabe (Phase 4): Ein Handy sieht als Zuschauer zu, drückt lange auf die Leiste eines Tischspielers → „Kontrolle übernehmen?“ →
vierstellige Nummer. Am Spieltisch erscheint ein Hamburger in der Leiste, die Rückfrage nennt dieselbe Nummer; erst die Bestätigung übergibt.
Danach steuert das Handy den Platz (Bot: wird ein Mensch), „Kontrolle an den Spieltisch“ beendet die Sitzung am Handy sofort.
Prüft auch Ablehnen, Verfall, falsche Nummer, Spielleiter-Platz (Spielleiter-Rechte bleiben am Tisch). Aufruf: python3 tests/browser_handover.py"""
import json, os, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8201
BASE = f'http://127.0.0.1:{PORT}'
SHOTS = os.environ.get('SHOTS', tempfile.mkdtemp(prefix='handelsinseln-handover-'))
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

def event(token, want, query=''):
    r = urllib.request.urlopen(BASE + '/api/events?token=' + token + query, timeout=6)
    ev = None
    while True:
        line = r.readline().decode()
        if line.startswith('event:'): ev = line[6:].strip()
        elif line.startswith('data:') and ev == want:
            d = json.loads(line[5:]); r.close(); return d

def clear(pg):
    pg.evaluate("document.querySelectorAll('.devshow').forEach(e => e.remove())")

def vis_hreq(pg, pid, attr='data-hreq'):
    return f"[...document.querySelectorAll('#seats .seat[data-pid=\"{pid}\"] .hreq[{attr}]')].some(e => e.offsetParent !== null)"

def hold(pg, sel):
    """Langes Drücken (≈ 0,9 s) auf ein Element."""
    box = pg.locator(sel).first.bounding_box()
    x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    pg.mouse.move(x, y); pg.mouse.down(); time.sleep(0.95); pg.mouse.up()

env = dict(os.environ, PORT=str(PORT), DATA_DIR=tempfile.mkdtemp(), HTTPS_PORT='0', TICK_MS='300', BOT_MS='150', HANDOVER_MS='4000')
server = subprocess.Popen(['node', os.path.join(ROOT, 'server/server.js')], env=env)
time.sleep(1)
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        H = b.new_context(viewport={'width': 1600, 'height': 900}).new_page()
        H.on('pageerror', lambda e: problems.append(f'pageerror Tisch: {e}'))
        H.goto(BASE); H.fill('#nameIn', 'Hanna'); H.locator('#swatches .sw').first.click(); H.click('#createBtn')
        H.wait_for_selector('#lobby:not([hidden])', timeout=6000)
        htok = H.evaluate("localStorage.getItem('handelsinseln.token')")
        post('/api/act', {'token': htok, 'type': 'add_table_player', 'name': 'Bernd', 'color': 'gruen'})
        post('/api/act', {'token': htok, 'type': 'add_bot', 'kind': 'baumeister'})
        post('/api/act', {'token': htok, 'type': 'set_settings', 'settings': {'dice': 'auto'}})
        H.wait_for_function("document.querySelectorAll('#lobbyList li').length === 3", timeout=6000); time.sleep(1.0)
        H.click('#startBtn'); H.wait_for_selector('#seatAsk', timeout=10000)
        for name, seat in (('Hanna', 'b'), ('Bernd', 'l')):
            H.wait_for_function(f"document.querySelector('#seatAsk h2') && document.querySelector('#seatAsk h2').textContent.includes('{name}')", timeout=6000)
            H.click(f'#seatAsk .sa-seat[data-seat="{seat}"]'); time.sleep(0.6)
        H.wait_for_selector('#seatAsk', state='detached', timeout=6000); time.sleep(1.2); clear(H)
        names = [x['name'] for x in event(htok, 'state')['players']]
        bernd, bot, host = names.index('Bernd'), names.index('Bruno Biber'), names.index('Hanna')

        print('Handy sieht zu und drückt lange auf die Leiste von Bernd')
        P = b.new_context(**p.devices['iPhone 13']).new_page()
        P.on('pageerror', lambda e: problems.append(f'pageerror Handy: {e}'))
        P.goto(BASE); P.wait_for_selector('#gameList .gcard.run', timeout=6000); P.click('#gameList .gcard.run'); P.click('#joinBtn')
        P.wait_for_selector('body.watch #seats .seat', timeout=8000); time.sleep(1.0); clear(P)
        wtok = P.evaluate("localStorage.getItem('handelsinseln.token')")
        sel = f'#seats .seat[data-pid="{bernd}"] .badge:visible'
        hold(P, sel)
        P.wait_for_selector('#dlgRoot [data-d="yes"]', timeout=4000)
        check('Kontrolle übernehmen?' in P.inner_text('#dlgRoot'), 'Handy: Dialog „Kontrolle übernehmen?“')
        # kurzes Tippen löst nichts aus (nur langes Drücken)
        P.click('#dlgRoot [data-d="yes"]')
        P.wait_for_selector('#codeBox', timeout=4000)
        code = P.inner_text('#codeBox .cn').strip()
        check(len(code) == 4 and code.isdigit(), f'Handy zeigt eine vierstellige Nummer ({code})')
        P.screenshot(path=f'{SHOTS}/handy-nummer.png')

        print('Spieltisch: Hamburger in der Leiste, Rückfrage mit derselben Nummer')
        H.wait_for_function(vis_hreq(H, bernd), timeout=4000)
        check(True, 'Tisch: Hamburger in der Leiste von Bernd')
        check(H.locator(f'#seats .seat[data-pid="{host}"] .hreq').count() == 0, 'andere Leisten haben keinen')
        H.locator(f'#seats .seat[data-pid="{bernd}"] .hreq:visible').first.click(force=True); time.sleep(0.5)
        check(code in H.inner_text(f'#seats .seat[data-pid="{bernd}"] .hask'), 'Rückfrage am Tisch nennt dieselbe Nummer')
        H.screenshot(path=f'{SHOTS}/tisch-rueckfrage.png')
        print('Ablehnen')
        H.locator(f'#seats .seat[data-pid="{bernd}"] [data-hq="no"]').click(); time.sleep(0.8)
        check(H.locator(f'#seats .seat[data-pid="{bernd}"] .hreq').count() == 0, 'Hamburger ist weg')
        check(P.locator('.toast').count() >= 1 and 'abgelehnt' in P.inner_text('#toasts'), 'Handy: „abgelehnt“')
        check(P.locator('#codeBox').count() == 0, 'Handy: Nummernfenster geschlossen')

        print('Verfall nach HANDOVER_MS')
        hold(P, sel); P.click('#dlgRoot [data-d="yes"]'); P.wait_for_selector('#codeBox', timeout=4000)
        H.wait_for_function(vis_hreq(H, bernd), timeout=4000)
        H.wait_for_function('!(' + vis_hreq(H, bernd) + ')', timeout=8000)
        check(True, 'Hamburger verschwindet nach Ablauf')
        check('abgelaufen' in P.inner_text('#toasts'), 'Handy: „abgelaufen“')

        print('Falsche Nummer, dann richtige: Kontrolle übergeben')
        hold(P, sel); P.click('#dlgRoot [data-d="yes"]'); P.wait_for_selector('#codeBox', timeout=4000)
        code = P.inner_text('#codeBox .cn').strip()
        check('error' in post('/api/act', {'token': htok, 'type': 'handover_answer', 'pid': bernd, 'code': '0000' if code != '0000' else '1111', 'accept': True}), 'falsche Nummer wird abgelehnt')
        check(post('/api/act', {'token': wtok, 'type': 'handover_answer', 'pid': bernd, 'code': code, 'accept': True}).get('_status') == 403, 'das Handy kann sich nicht selbst bestätigen')
        H.wait_for_function(vis_hreq(H, bernd), timeout=4000)
        H.locator(f'#seats .seat[data-pid="{bernd}"] .hreq:visible').first.click(force=True); time.sleep(0.4)
        H.locator(f'#seats .seat[data-pid="{bernd}"] [data-hq="yes"]').click(); time.sleep(1.5)
        check(H.locator(f'#seats .seat[data-pid="{bernd}"]').evaluate("e => e.classList.contains('pub')"), 'Tisch: Bernds Leiste ist jetzt öffentlich (nur Statistik)')
        check(H.locator(f'#seats .seat[data-pid="{bernd}"] .secret').count() == 0 or H.locator(f'#seats .seat[data-pid="{bernd}"] .secretrow').is_hidden(), 'Tisch: Kontroll-Leisten und geheimer Bereich verschwunden')
        P.wait_for_function("!document.body.classList.contains('watch')", timeout=8000); time.sleep(1.0)
        check(P.locator('#bottom').count() == 1, 'Handy: jetzt die Oberfläche eines Spielers')
        me = event(wtok, 'state')
        check(me['you'] == bernd and me['players'][bernd]['handover'] is True, 'Handy steuert Bernd (gleiches Token, Spieler-Sicht)')
        check(post('/api/act', {'token': htok, 'type': 'place_seat', 'seat': 'r', 'as': bernd}).get('error') is not None, 'Der Tisch kann nicht mehr für Bernd handeln')
        P.click('#btnMenu'); items = P.eval_on_selector_all('.menu-pop [data-mi]', 'e => e.map(x => x.dataset.mi + ":" + x.textContent.trim())')
        check(any('Kontrolle an den Spieltisch' in i for i in items), f'Handy-Menü: „Kontrolle an den Spieltisch“ statt Verlassen: {items}')
        P.screenshot(path=f'{SHOTS}/handy-spieler.png'); P.keyboard.press('Escape'); P.mouse.click(5, 5)

        print('Kontrolle zurück an den Spieltisch (Handy-Sitzung endet sofort)')
        P.click('#btnMenu'); P.click('.menu-pop [data-mi="leave"]')
        P.wait_for_selector('#login:not([hidden])', timeout=6000)
        check(P.evaluate("localStorage.getItem('handelsinseln.token')") is None, 'Handy: Sitzung beendet')
        time.sleep(1.0)
        check(not H.locator(f'#seats .seat[data-pid="{bernd}"]').evaluate("e => e.classList.contains('pub')"), 'Tisch: Bernd ist wieder Tischspieler (volle Leiste)')
        check(post('/api/act', {'token': wtok, 'type': 'chat', 'text': 'x'}).get('_status') == 401, 'altes Handy-Token ist ungültig')

        print('Bot übernehmen: Mensch bleibt Mensch')
        P.goto(BASE); P.wait_for_selector('#gameList .gcard.run', timeout=6000); P.click('#gameList .gcard.run'); P.click('#joinBtn')
        P.wait_for_selector('body.watch #seats .seat', timeout=8000); time.sleep(1.0); clear(P)
        wtok2 = P.evaluate("localStorage.getItem('handelsinseln.token')")
        r = post('/api/handover', {'token': wtok2, 'pid': bot}); code = r['code']
        H.wait_for_function(vis_hreq(H, bot), timeout=4000)
        check(post('/api/act', {'token': htok, 'type': 'handover_answer', 'pid': bot, 'code': code, 'accept': True}).get('ok'), 'Spielleiter am Tisch bestätigt für den Bot')
        P.wait_for_function("!document.body.classList.contains('watch')", timeout=8000)
        st = event(wtok2, 'state')
        check(st['you'] == bot and st['players'][bot]['bot'] is None, 'aus dem Bot wurde ein Mensch')
        check(post('/api/act', {'token': wtok2, 'type': 'handback'}).get('ok'), 'Rückgabe an den Spieltisch')
        pl = event(htok, 'state')['players'][bot]
        check(pl['bot'] is None and pl['tableGuest'] is True, 'danach Tischspieler – nie wieder Bot')

        print('Spielleiter-Platz übergeben: Spielleiter-Rechte bleiben am Tisch')
        P2 = b.new_context(**p.devices['iPhone 13']).new_page()
        P2.on('pageerror', lambda e: problems.append(f'pageerror Handy2: {e}'))
        P2.goto(BASE); P2.wait_for_selector('#gameList .gcard.run', timeout=6000); P2.click('#gameList .gcard.run'); P2.click('#joinBtn')
        P2.wait_for_selector('body.watch #seats .seat', timeout=8000); time.sleep(0.8)
        wtok3 = P2.evaluate("localStorage.getItem('handelsinseln.token')")
        code = post('/api/handover', {'token': wtok3, 'pid': host})['code']
        H.wait_for_function(vis_hreq(H, host), timeout=4000)
        check(post('/api/act', {'token': htok, 'type': 'handover_answer', 'pid': host, 'code': code, 'accept': True}).get('ok'), 'Spielleiter-Platz übergeben')
        P2.wait_for_function("!document.body.classList.contains('watch')", timeout=8000); time.sleep(1.0)
        hv = event(wtok3, 'state')
        check(hv['you'] == host and hv['host'] == -1, 'Handy steuert den Spielleiter-Platz, aber ohne Spielleiter-Rechte (host=-1)')
        check(post('/api/act', {'token': wtok3, 'type': 'end_game'}).get('_status') == 403, 'Handy darf das Spiel nicht beenden')
        check(post('/api/act', {'token': htok, 'type': 'set_settings', 'settings': {'dice': 'auto'}}).get('ok') is not None, 'Der Tisch behält die Spielleiter-Rechte')
        check('error' in post('/api/act', {'token': htok, 'type': 'roll'}), 'Der Tisch kann den übergebenen Platz nicht mehr bedienen')
        H.locator(f'#seats .seat[data-pid="{host}"] .hreq[data-hback]:visible').first.click(force=True); time.sleep(0.4)
        H.locator(f'#seats .seat[data-pid="{host}"] [data-hbq="yes"]').click(); time.sleep(1.2)
        P2.wait_for_selector('#login:not([hidden])', timeout=6000)
        check(True, 'Tisch holt den Platz zurück (Handy weg): Handy-Sitzung endet')
        check(not H.locator(f'#seats .seat[data-pid="{host}"]').evaluate("e => e.classList.contains('pub')"), 'Tisch: Spielleiter-Platz wieder mit voller Leiste')
        b.close()
finally:
    server.terminate()
print('Screenshots:', SHOTS)
print('Probleme:', 'keine' if not problems else '\n' + '\n'.join(problems))
sys.exit(1 if problems else 0)

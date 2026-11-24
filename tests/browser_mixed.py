#!/usr/bin/env python3
"""Gemischte Lobby (Phase 3): Spielleiter (Tisch), ein Tischspieler, ein Online-Spieler (Handy) und ein Bot in einem Spiel.
Prüft Lobby, Platzwahl (nur Tischspieler fragen, die anderen bekommen automatisch einen Platz), öffentliche Plätze am Tisch ohne geheimen Bereich,
Datenschutz in der Tisch-Sicht, und den Ablauf „Online-Spieler gibt am Handy frei → der Spieltisch zeigt die Ziele → Tipp am Tisch führt aus“.
Aufruf: python3 tests/browser_mixed.py"""
import json, time, urllib.request
from playwright.sync_api import sync_playwright
from lib import check, finish, poster, problems, shots, sse_event, start_server

SHOTS = shots('mixed')

def clear(pg):
    pg.evaluate("document.querySelectorAll('.devshow').forEach(e => e.remove())")

server, BASE = start_server(TICK_MS=300, BOT_MS=150)
post = poster(BASE)
event = lambda token, want, query='': sse_event(BASE, token, want, query, timeout=6)
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        H = b.new_context(viewport={'width': 1600, 'height': 900}).new_page()
        H.on('pageerror', lambda e: problems.append(f'pageerror Tisch: {e}'))
        H.goto(BASE); H.fill('#nameIn', 'Hanna'); H.locator('#swatches .sw').first.click(); H.click('#createBtn')
        H.wait_for_selector('#lobby:not([hidden])', timeout=6000)
        htok = H.evaluate("localStorage.getItem('handelsinseln.token')")
        gid = json.load(urllib.request.urlopen(BASE + '/api/games'))['games'][0]['id']

        print('Lobby: Online-Spieler, Tischspieler und Bot mischen')
        P = b.new_context(**p.devices['iPhone 13']).new_page()
        P.on('pageerror', lambda e: problems.append(f'pageerror Handy: {e}'))
        P.goto(BASE); P.wait_for_selector('#gameList .gcard'); P.click('#gameList .gcard')
        P.fill('#nameIn', 'Otto'); P.locator('#swatches .sw:not([disabled])').last.click(); P.click('#joinBtn')
        P.wait_for_selector('#lobby:not([hidden])', timeout=6000)
        otok = P.evaluate("localStorage.getItem('handelsinseln.token')")
        check(post('/api/act', {'token': htok, 'type': 'add_table_player', 'name': 'Bernd', 'color': 'gruen'}).get('ok'), 'Tischspieler Bernd angelegt – trotz Online-Spieler')
        check(post('/api/act', {'token': htok, 'type': 'add_bot', 'kind': 'baumeister'}).get('ok'), 'Bot hinzugefügt – trotz Tisch')
        H.wait_for_function("document.querySelectorAll('#lobbyList li').length === 4", timeout=6000)
        check(H.locator('#lobbyList .botTag:has-text("Tisch")').count() == 1, 'Lobby: Tisch-Marke für den Tischspieler')
        check(H.locator('#lobbyBots .tblnote').count() == 1 and H.locator('#lobbyBots .botdrop').count() == 1, 'Lobby: Tisch-Hinweis und Bot-Liste gleichzeitig')
        check(H.locator('[data-addtable]').is_enabled(), '„Tischspieler anlegen“ bleibt bedienbar')
        gm = json.load(urllib.request.urlopen(BASE + '/api/games'))['games'][0]
        check(gm['table'] and gm['joinable'], 'Spieleliste: Tisch-Partie ist beitretbar')
        post('/api/act', {'token': htok, 'type': 'set_settings', 'settings': {'dice': 'auto'}})
        time.sleep(0.5)
        H.screenshot(path=f'{SHOTS}/gemischt-lobby.png')

        print('Start: nur Tischspieler wählen den Platz')
        H.click('#startBtn'); H.wait_for_selector('#seatAsk', timeout=10000)
        asked = []
        for name, seat in (('Hanna', 'b'), ('Bernd', 'l')):
            H.wait_for_function(f"document.querySelector('#seatAsk h2') && document.querySelector('#seatAsk h2').textContent.includes('{name}')", timeout=6000)
            asked.append(name); H.click(f'#seatAsk .sa-seat[data-seat="{seat}"]'); time.sleep(0.6)
        H.wait_for_selector('#seatAsk', state='detached', timeout=6000); time.sleep(1.5)
        check(asked == ['Hanna', 'Bernd'], f'gefragt wurden nur die Tischspieler: {asked}')
        clear(H); clear(P)
        check(H.locator('#seats .seat').count() == 4, 'vier Plätze am Tisch')
        check(H.locator('#seats .seat.pub').count() == 2, 'zwei öffentliche Plätze (Online-Spieler und Bot)')
        check(H.locator('#seats .seat:not(.pub) .secret').count() == 2, 'geheimer Bereich nur für die zwei Tischspieler')
        H.screenshot(path=f'{SHOTS}/gemischt-tisch.png')

        print('Datenschutz in der Tisch-Sicht')
        tv = event(htok, 'table', '&table=1')['views']
        me = event(htok, 'state')['you']
        names = [x['name'] for x in tv[0]['players']]
        otto, bernd, bot = names.index('Otto'), names.index('Bernd'), names.index('Bruno Biber')
        check(tv[otto].get('watch') is True and tv[otto]['me']['hand'] == {} and tv[otto]['me']['dev'] == [], 'Online-Spieler: am Tisch nur die öffentliche Sicht')
        check(tv[bot].get('watch') is True and tv[bot]['me']['hand'] == {}, 'Bot: am Tisch nur die öffentliche Sicht')
        check(tv[bernd].get('watch') is None and 'hand' in tv[bernd]['me'], 'Tischspieler: volle Sicht am Tisch')
        check(post('/api/act', {'token': htok, 'type': 'place_settlement', 'v': 'x', 'as': otto}).get('error') is not None, 'Spielleiter darf nicht für den Online-Spieler handeln')

        print('Aufbau durchspielen; der Online-Spieler gibt am Handy frei, der Spieltisch zeigt die Ziele')
        P.click('#btnMenu')
        check(P.locator('.menu-pop [data-mi="ctl"]').count() == 1, 'Handy: „Controller-Ansicht“ ist da (der Spieltisch ist die Anzeige)')
        P.keyboard.press('Escape'); P.mouse.click(5, 5); time.sleep(0.5)  # Controller-Ansicht ist mit Tisch-Anzeige schon die Vorgabe
        ui_done = False; end = time.time() + 150
        while time.time() < end:
            v = event(htok, 'state')
            if v['phase'] == 'main': break
            t, step = v['turn'], v['step']
            if t == bot or t is None: time.sleep(0.3); continue
            if t == otto:
                ov = event(otok, 'state')
                if step == 'setup_settlement' and not ui_done:
                    ui_done = True
                    clear(P); clear(H)
                    for _ in range(40):
                        if P.locator('#armPanel .arm.wait').count(): break
                        clear(P); time.sleep(0.3)
                    time.sleep(1.0)
                    n = H.locator('#world .L-target [data-t]').count()
                    check(n > 0, f'Spieltisch des Spielleiters zeigt {n} Ziele für den Online-Spieler')
                    ok = False
                    for i in range(n):
                        H.locator('#world .L-target [data-t]').nth(i).click(force=True); time.sleep(1.0)
                        if len([k for k, x in event(otok, 'state')['verts'].items() if x['p'] == otto]) == 1: ok = True; break
                    check(ok, 'Tipp am Spieltisch setzt die Siedlung des Online-Spielers sofort (die Freigabe am Handy war die Bestätigung)')
                    continue
                L = ov['legal']
                if step == 'setup_settlement' and L['settlement']: post('/api/act', {'token': otok, 'type': 'place_settlement', 'v': L['settlement'][0]})
                elif step == 'setup_road' and L['road']: post('/api/act', {'token': otok, 'type': 'place_road', 'e': L['road'][0]})
            else:  # Spielleiter oder Tischspieler: der Spielleiter handelt am Tisch (für Bernd mit `as`)
                tvs = event(htok, 'table', '&table=1')['views']; L = tvs[t]['legal']
                body = {'token': htok, 'as': t}
                if step == 'setup_settlement' and L['settlement']: post('/api/act', {**body, 'type': 'place_settlement', 'v': L['settlement'][0]})
                elif step == 'setup_road' and L['road']: post('/api/act', {**body, 'type': 'place_road', 'e': L['road'][0]})
            time.sleep(0.25)
        v = event(htok, 'state')
        check(v['phase'] == 'main', 'Aufbau abgeschlossen, Hauptspiel läuft')
        check(ui_done, 'Ablauf über Handy und Spieltisch wurde durchlaufen')
        clear(H); H.screenshot(path=f'{SHOTS}/gemischt-spiel.png')
        check(H.locator('#seats .seat.pub').count() == 2 and H.locator('#seats .seat:not(.pub) .secret').count() == 2, 'im Spiel: öffentliche Plätze bleiben ohne geheimen Bereich')
        b.close()
finally:
    server.terminate()
finish(SHOTS)

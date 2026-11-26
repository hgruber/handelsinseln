#!/usr/bin/env python3
"""Gerätekopplung und Spielerpass im echten Browser:
Host zeigt in der Lobby einen QR-Code und einen Kurzcode, ein zweites Gerät (frischer Browser-Kontext)
koppelt sich per Code und landet in derselben Lobby; danach legt der Host einen Spielerpass an,
und ein dritter Browser findet die Partie allein mit den vier Wörtern wieder – laufend wie beendet,
letztere mit Rückblick auf Endstand, Punkteverlauf und Regeln.
Aufruf: python3 tests/browser_pair.py"""
import hashlib, hmac, json, os, tempfile, time
from playwright.sync_api import sync_playwright
from lib import check, finish, get_json, problems, shots, start_server, wait_until

SHOTS = shots('pair')
DATA = tempfile.mkdtemp(prefix='handelsinseln-pair-')
server, BASE = start_server(GRACE_MS=1500, TICK_MS=300, DATA_DIR=DATA)
try:
    with sync_playwright() as p:
        b = p.chromium.launch()

        def newpage(name):
            pg = b.new_context(viewport={'width': 1400, 'height': 850}).new_page()
            pg.on('pageerror', lambda e: problems.append(f'pageerror({name}): {e}'))
            pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and problems.append(f'console({name}): {m.text}'))
            pg.on('response', lambda r: r.status >= 400 and r.status not in (400, 401) and '/img/' not in r.url and problems.append(f'HTTP {r.status} {r.url}'))
            pg.goto(BASE)
            return pg

        # --- Host eröffnet ein Spiel; die Lobby bietet Kopplung und Spielerpass an
        A = newpage('Host')
        A.fill('#nameIn', 'Hanna'); A.locator('#swatches .sw').first.click(); A.click('#createBtn')
        A.wait_for_selector('#lobby:not([hidden])', timeout=6000)
        check(A.locator('#lbMenuBtn').count() == 1, 'Lobby hat ein Menü neben dem Schließen-Knopf')

        # --- QR anzeigen (kein Kurzcode mehr)
        A.click('#lbMenuBtn')
        A.wait_for_selector('.lb-pop [data-mi=pair]', timeout=4000)
        check(A.locator('.lb-pop [data-mi=pass]').count() == 1, 'Menü enthält Spielerpass')
        A.screenshot(path=f'{SHOTS}/00-lobby-menue.png')
        A.click('.lb-pop [data-mi=pair]')
        A.wait_for_selector('.pairbox', timeout=6000)
        nonce = A.locator('.pairbox').get_attribute('data-k')
        check(nonce and len(nonce) == 32, 'Kopplungs-Nonce im QR')
        check(A.locator('.pairq svg').count() == 1, 'QR-Code gezeichnet')
        check(A.locator('.pairc').count() == 0, 'kein Kurzcode im Dialog')
        A.screenshot(path=f'{SHOTS}/01-kopplung.png')

        # --- Zweites Gerät öffnet die QR-URL (#k=…)
        B = newpage('Handy')
        B.goto(BASE + '/?k=' + nonce + '#k=' + nonce)
        B.wait_for_selector('#lobby:not([hidden])', timeout=6000)
        check(B.locator('#lobbyList').inner_text().count('Hanna') == 1, 'Handy ist in der Lobby des Hosts')

        ok = wait_until(lambda: A.locator('.pairbox').count() == 0, timeout=8000)
        check(ok, 'anzeigendes Gerät meldet die Verbindung und schließt den Dialog')
        check(A.locator('#lobbyList').inner_text().count('Hanna') == 1, 'Host und Handy sehen dieselbe Lobby')

        # --- Spielerpass anlegen
        A.click('#lbMenuBtn')
        A.click('.lb-pop [data-mi=pass]')
        A.wait_for_selector('.passbox [data-p=new]', timeout=4000)
        A.click('.passbox [data-p=new]')
        A.wait_for_selector('.passwords.big', timeout=4000)
        passw = A.locator('.passwords.big').inner_text().strip()
        check(len(passw.split()) == 4, 'Pass aus vier Wörtern')
        A.screenshot(path=f'{SHOTS}/02-spielerpass.png')
        A.click('.passbox [data-p=ok]')
        stored = A.evaluate("localStorage.getItem('handelsinseln.pass')")
        check(stored == passw, 'Pass auf dem Gerät gespeichert')
        time.sleep(0.8)  # Verknüpfung mit der Partie ist unterwegs

        # --- Eine beendete Partie im Archiv, gefunden über dieselbe Personen-ID
        sid = get_json(BASE, '/api/config')['serverId']
        pid = hmac.new(passw.encode(), sid.encode(), hashlib.sha256).hexdigest()
        ended = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        rec = {
            'room': 'archiv-1', 'version': '1.0.0', 'startedAt': ended, 'endedAt': ended,
            'minutes': 42, 'rounds': 6, 'result': 'sieg', 'reason': None, 'winner': 'Hanna',
            'settings': {'variant': 'klassisch', 'winPoints': 12},
            'history': [[0, 0], [3, 2], [7, 4], [12, 8]],
            'players': [
                {'name': 'Hanna', 'color': 'rot', 'kind': 'mensch', 'vp': 12, 'personId': pid},
                {'name': 'Bert', 'color': 'blau', 'kind': 'mensch', 'vp': 8},
            ],
        }
        with open(os.path.join(DATA, 'partien.jsonl'), 'a', encoding='utf-8') as f:
            f.write(json.dumps(rec) + '\n')

        # --- Drittes Gerät findet die Partie nur mit dem Pass
        C = newpage('Neu')
        C.click('#myGamesBtn')
        C.wait_for_selector('.passbox [data-p=in]', timeout=4000)
        C.click('.passbox [data-p=in]')
        C.fill('.passin', passw)
        C.click('.passbox [data-p=ok]')
        C.wait_for_selector('.prow', timeout=8000)
        check(C.locator('.prow').count() == 2 and C.locator('.plist').inner_text().count('Hanna') >= 1, 'laufende und beendete Partie unter „Meine Partien“')
        check(C.locator('.prow.end').count() == 1, 'beendete Partie ist anklickbar')
        C.screenshot(path=f'{SHOTS}/03-meine-partien.png')

        # --- Rückblick: Endstand, Punkteverlauf, Regeln
        C.locator('.prow.end').click()
        C.wait_for_selector('.passbox.wide', timeout=4000)
        check(C.locator('.passbox.wide .rank li').count() == 2, 'Endstand mit beiden Plätzen')
        check('(du)' in C.locator('.passbox.wide .rank').inner_text(), 'eigener Platz markiert')
        check(C.locator('.passbox.wide svg.chart').count() == 1, 'Punkteverlauf gezeichnet')
        check('Siegpunkte zum Sieg' in C.locator('.passbox.wide .pregeln').inner_text(), 'abweichende Regel der Partie angezeigt')
        C.screenshot(path=f'{SHOTS}/04-partie-rueckblick.png')
        C.click('.passbox.wide [data-p=back]')
        C.wait_for_selector('.plist', timeout=4000)
        check(C.locator('.prow').count() == 2, 'zurück zur Partienliste')
        C.click('.prow [data-i="0"]')
        C.wait_for_selector('#lobby:not([hidden])', timeout=6000)
        check(C.locator('#lobbyList').inner_text().count('Hanna') == 1, 'Partie mit dem Pass fortgesetzt')

        ok = wait_until(lambda: C.evaluate("!!localStorage.getItem('handelsinseln.token')"), timeout=4000)
        check(ok, 'Token nach dem Fortsetzen gespeichert')
finally:
    server.terminate()

finish(SHOTS, 'Browser-Kopplung und Spielerpass bestanden')

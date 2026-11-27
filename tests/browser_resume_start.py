#!/usr/bin/env python3
"""Fortsetzen auf der Startseite: Spieler B verlässt eine laufende Partie (A bleibt verbunden), die Partie
läuft weiter. Auf der Startseite erscheint sie mit dem Spielerpass als „Fortsetzen“; ein Klick holt den Platz
zurück, ohne den Umweg über „Meine Partien“. Aufruf: python3 tests/browser_resume_start.py"""
import json, time, urllib.request
from playwright.sync_api import sync_playwright
from lib import check, finish, problems, shots, start_server

SHOTS = shots('resume_start')
server, BASE = start_server(TICK_MS=300)

def games():
    return json.load(urllib.request.urlopen(BASE + '/api/games'))['games']

try:
    with sync_playwright() as p:
        b = p.chromium.launch()

        # Spielleiterin Anna bleibt im Spiel
        A = b.new_context(viewport={'width': 1400, 'height': 850}).new_page()
        A.on('pageerror', lambda e: problems.append(f'pageerror Anna: {e}'))
        A.goto(BASE); A.fill('#nameIn', 'Anna'); A.locator('#swatches .sw').first.click(); A.click('#createBtn')
        A.wait_for_selector('#lobby:not([hidden])', timeout=6000)

        # Bernd tritt bei und bekommt automatisch einen Spielerpass
        B = b.new_context(viewport={'width': 1300, 'height': 800}).new_page()
        B.on('pageerror', lambda e: problems.append(f'pageerror Bernd: {e}'))
        B.goto(BASE); B.wait_for_selector('#gameList [data-g]', timeout=6000)
        B.locator('#gameList [data-g]').first.click()
        B.fill('#nameIn', 'Bernd'); B.locator('#swatches .sw:not([disabled])').first.click(); B.click('#joinBtn')
        B.wait_for_selector('#lobby:not([hidden])', timeout=6000)
        A.wait_for_function("document.querySelectorAll('#lobbyList li').length === 2", timeout=6000)
        time.sleep(1.0)  # Spielerpass ist mit dem Platz verknüpft

        A.click('#startBtn'); A.wait_for_selector('#board:not([hidden])', timeout=8000)
        B.wait_for_selector('#board:not([hidden])', timeout=8000)
        check(B.evaluate("!!localStorage.getItem('handelsinseln.pass')"), 'Bernd hat einen Spielerpass')

        # Bernd verlässt die laufende Partie; Anna bleibt, die Partie läuft weiter.
        B.click('#btnMenu'); B.click('.menu-pop [data-mi=leave]')
        B.wait_for_selector('[data-d=yes]', timeout=4000); B.click('[data-d=yes]')
        B.wait_for_selector('#login:not([hidden])', timeout=6000)
        check(any(g['phase'] in ('setup', 'main') for g in games()), 'Partie läuft nach dem Verlassen weiter')
        B.reload()  # frische Startseite: Spielerpass bleibt, Auswahl ist leer
        B.wait_for_selector('#login:not([hidden])', timeout=6000)

        # Startseite: eigene Partie wird als „Fortsetzen“ angeboten.
        B.wait_for_function("document.querySelector('#gameList .gcard.run') && document.querySelector('#gameList .gcard.run').textContent.includes('Fortsetzen')", timeout=12000)
        card = B.locator('#gameList .gcard.run').first
        check('Fortsetzen' in card.inner_text(), 'Startseite kennzeichnet die eigene Partie mit „Fortsetzen“')
        selected = 'on' in (card.get_attribute('class') or '').split()
        B.screenshot(path=f'{SHOTS}/startseite-fortsetzen.png')
        if selected:
            check(B.locator('#joinBtn').get_attribute('aria-disabled') == 'false', 'eigene Partie ist bereits ausgewählt')
        else:
            check(B.locator('#joinBtn').get_attribute('aria-disabled') == 'true', 'ohne Auswahl ist der Knopf noch gesperrt')
            card.click()
        B.wait_for_function("document.querySelector('#joinBtn').textContent.trim() === 'Fortsetzen'", timeout=4000)
        check(B.locator('#joinBtn').get_attribute('aria-disabled') == 'false', '„Fortsetzen“ ist frei')
        B.click('#joinBtn')
        B.wait_for_selector('#login', state='hidden', timeout=8000)
        B.wait_for_selector('#board:not([hidden])', timeout=8000)
        check(B.evaluate("!!localStorage.getItem('handelsinseln.token')"), 'Fortsetzen von der Startseite liefert eine Sitzung')
        check(B.evaluate("document.body.dataset.screen") in ('setup', 'main'), 'Bernd spielt wieder mit')
        B.screenshot(path=f'{SHOTS}/fortgesetzt.png')

        for _ in range(40):
            if any(q['name'] == 'Bernd' for g in games() for q in g.get('players', [])):
                break
            time.sleep(0.2)
        check(any(q['name'] == 'Bernd' for g in games() for q in g.get('players', [])), 'Bernd ist wieder im Spiel (nicht mehr verlassen)')
        b.close()
finally:
    server.terminate()
finish(SHOTS, 'Fortsetzen auf der Startseite bestanden')

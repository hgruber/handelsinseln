#!/usr/bin/env python3
"""Pause mit Spielerpass im echten Browser:
Solo gegen einen Bot, den automatisch angelegten Spielerpass zeigen, Spiel verlassen – die Partie
pausiert statt abgeräumt und lässt sich unter „Meine Partien“ fortsetzen.
Aufruf: python3 tests/browser_pause.py"""
import time
from playwright.sync_api import sync_playwright
from lib import check, finish, problems, shots, start_server

SHOTS = shots('pause')
server, BASE = start_server(GRACE_MS=1500, TICK_MS=300)
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_context(viewport={'width': 1400, 'height': 850}).new_page()
        pg.on('pageerror', lambda e: problems.append(f'pageerror: {e}'))
        pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and problems.append(f'console: {m.text}'))
        pg.on('response', lambda r: r.status >= 400 and r.status not in (400, 401) and '/img/' not in r.url and problems.append(f'HTTP {r.status} {r.url}'))
        pg.goto(BASE)
        check(pg.locator('#loginId').is_hidden(), 'erster Besuch: noch kein fester Spielerpass-Kopf')
        check(pg.locator('#myGamesBtn').inner_text().strip() == 'Ich habe einen Spielerpass', 'nur der Pass-Eingang')
        pg.wait_for_timeout(800)
        pg.screenshot(path=f'{SHOTS}/00-anmeldung-neu.png')

        # --- Solo gegen einen Bot
        pg.fill('#nameIn', 'Ida'); pg.locator('#swatches .sw').first.click(); pg.click('#createBtn')
        pg.wait_for_selector('#lobby:not([hidden])', timeout=6000)
        pg.evaluate("document.querySelector('#lobbyBots .botdrop').open = true")
        pg.click('#lobbyBots [data-addbot]')
        pg.wait_for_selector('#startBtn', timeout=6000)
        pg.click('#startBtn')
        pg.wait_for_selector('#board:not([hidden])', timeout=8000)
        check(True, 'Partie mit Bot gestartet')

        # --- Spielerpass ist automatisch angelegt und mit der Partie verknüpft
        passw = pg.evaluate("localStorage.getItem('handelsinseln.pass')")
        check(passw and len(passw.split()) == 4, 'Pass automatisch aus vier Wörtern')
        pg.click('#btnMenu')
        pg.click('.menu-pop [data-mi=pass]')
        pg.wait_for_selector('.passbox [data-p=pass]', timeout=4000)
        pg.click('.passbox [data-p=pass]')
        pg.wait_for_selector('.passwords', timeout=4000)
        check(pg.locator('.passwords').inner_text().strip() == passw, 'Dialog zeigt den Pass')
        check(pg.locator('.passbox .passid b').inner_text().strip() == 'Ida', 'Dialog zeigt den Kopf')
        check(pg.locator('.passbox .ptab.on').inner_text().strip() == 'Mein Spielerpass', 'Reiter „Mein Spielerpass“ aktiv')
        pg.wait_for_timeout(500)
        pg.screenshot(path=f'{SHOTS}/00-spielerpass.png')
        pg.click('.passbox [data-p=close]')
        time.sleep(0.8)  # Verknüpfung mit der Partie ist unterwegs

        # --- Spiel verlassen → Partie pausiert
        pg.click('#btnMenu')
        pg.click('.menu-pop [data-mi=leave]')
        pg.wait_for_selector('[data-d=yes]', timeout=4000)
        pg.click('[data-d=yes]')
        pg.wait_for_selector('#login:not([hidden])', timeout=6000)
        check(pg.locator('#loginId:not([hidden])').count() == 1, 'Anmeldung zeigt den festen Spielerpass-Kopf')
        check(pg.locator('#loginIdName').inner_text().strip() == 'Ida', 'Name im Kopf')
        check(pg.locator('#loginIdAv img').count() == 1, 'Avatar im Kopf')
        check(pg.locator('#loginIdSub a.lid-pass').count() == 1, '„Spielerpass aktiv“ ist verlinkt')
        check(pg.locator('#nameFld').is_hidden() and pg.locator('#avatarFld').is_hidden(), 'Name und Avatar sind gesperrt')
        check(pg.locator('#colorFld').is_hidden(), 'Farbpalette entfällt bei gebundenem Pass')
        check(pg.locator('#loginIdNav:not([hidden])').count() == 1, 'Leiste unter dem Kopf')
        check(pg.locator('#loginIdNav [data-p=list]').inner_text().strip() == 'Meine Partien', 'Reiter „Meine Partien“')
        check(pg.locator('#loginIdNav [data-p=pass]').inner_text().strip() == 'Mein Spielerpass', 'Reiter „Mein Spielerpass“')
        pg.wait_for_timeout(800)
        pg.screenshot(path=f'{SHOTS}/01-anmeldung-pass.png')

        pg.click('#loginIdNav [data-p=list]')
        pg.wait_for_selector('.prow', timeout=6000)
        check(pg.locator('.passid b').inner_text().strip() == 'Ida', '„Meine Partien“ zeigt den Kopf')
        check(pg.locator('.passid .pidav img').count() == 1, 'Avatar im Kopf von „Meine Partien“')
        check(pg.locator('.plist').inner_text().count('Pausiert') == 1, 'Partie ist als pausiert gekennzeichnet')
        pg.screenshot(path=f'{SHOTS}/01-pausiert.png')

        # --- Fortsetzen mit dem Pass
        pg.click('.prow [data-i="0"]')
        pg.wait_for_selector('#board:not([hidden])', timeout=8000)
        check(pg.evaluate("!!localStorage.getItem('handelsinseln.token')"), 'Token nach dem Fortsetzen gespeichert')
        pg.screenshot(path=f'{SHOTS}/02-fortgesetzt.png')
        check(pg.evaluate("document.body.dataset.screen") in ('setup', 'main'), 'Partie läuft nach dem Fortsetzen')

        # --- Pass löschen: Name, Avatar und Farbe sind wieder frei wählbar
        pg.wait_for_timeout(400)
        ov = pg.locator('.devshow.manual')
        if ov.count():
            ov.first.click(force=True)  # Hinweis „Spielreihenfolge“ schließen
        pg.click('#btnMenu')
        pg.click('.menu-pop [data-mi=pass]')
        pg.wait_for_selector('.passbox [data-p=pass]', timeout=4000)
        pg.click('.passbox [data-p=pass]')
        pg.wait_for_selector('.passbox [data-p=clear]', timeout=4000)
        pg.click('.passbox [data-p=clear]')
        pg.click('#btnMenu')
        pg.click('.menu-pop [data-mi=leave]')
        pg.wait_for_selector('[data-d=yes]', timeout=4000)
        pg.click('[data-d=yes]')
        pg.wait_for_selector('#login:not([hidden])', timeout=6000)
        check(pg.locator('#nameFld').is_visible(), 'Name wieder wählbar')
        check(pg.locator('#avatarFld').is_visible(), 'Avatar wieder wählbar')
        check(pg.locator('#myGamesBtn').is_visible() and pg.locator('#myGamesBtn').inner_text().strip() == 'Ich habe einen Spielerpass', 'nur noch der Pass-Eingang')
        check(pg.locator('#loginIdNav').is_hidden(), 'Kopf-Leiste entfällt')
        check(pg.locator('#colorFld').is_visible(), 'Farbpalette wieder da')
        check(pg.locator('#swatches .sw:not([disabled])').count() > 1, 'Farbauswahl wieder frei')
        pg.wait_for_timeout(800)
        pg.screenshot(path=f'{SHOTS}/03-anmeldung-ohne-pass.png')
finally:
    server.terminate()

finish(SHOTS, 'Pause mit Spielerpass bestanden')

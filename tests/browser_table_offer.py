#!/usr/bin/env python3
"""Spieltisch anbieten: Der Spielleiter (FullHD) bietet an, ein Handy nimmt an und wählt einen Platz,
ein zweiter Spieler lehnt ab. Danach wird der Bildschirm des Spielleiters zur Tischplatte, das Handy
wechselt in die Controller-Ansicht, der Ablehner bleibt in der normalen Ansicht. Außerdem: kein
Menüpunkt auf einem kleinen Bildschirm und keine Platzabfrage beim Start.
Aufruf: python3 tests/browser_table_offer.py"""
import time
from playwright.sync_api import sync_playwright
from lib import check, finish, problems, shots, start_server

SHOTS = shots('table_offer')

server, BASE = start_server(TICK_MS=300, TABLE_OFFER_MS=15000)
try:
    with sync_playwright() as p:
        b = p.chromium.launch()

        def join(ctx, name):
            pg = ctx.new_page()
            pg.on('pageerror', lambda e: problems.append(f'pageerror {name}: {e}'))
            pg.goto(BASE)
            pg.wait_for_selector('#login:not([hidden])', timeout=6000)
            pg.fill('#nameIn', name)
            pg.locator('#swatches .sw:not([disabled])').first.click()
            return pg

        # Spielleiter auf FullHD
        H = join(b.new_context(viewport={'width': 1920, 'height': 1080}, screen={'width': 1920, 'height': 1080}), 'Hanna')
        H.click('#createBtn')
        H.wait_for_selector('#lobby:not([hidden])', timeout=6000)
        htok = H.evaluate("localStorage.getItem('handelsinseln.token')")

        # Zwei Mitspieler: Handy (nimmt an) und Desktop (lehnt ab)
        P = b.new_context(**p.devices['iPhone 13']).new_page()
        P.on('pageerror', lambda e: problems.append(f'pageerror Handy: {e}'))
        P.goto(BASE); P.wait_for_selector('#gameList .gcard', timeout=6000); P.click('#gameList .gcard')
        P.fill('#nameIn', 'Otto'); P.locator('#swatches .sw:not([disabled])').last.click(); P.click('#joinBtn')
        P.wait_for_selector('#lobby:not([hidden])', timeout=6000)

        D = join(b.new_context(viewport={'width': 1280, 'height': 720}, screen={'width': 1280, 'height': 720}), 'Dora')
        D.wait_for_selector('#gameList .gcard', timeout=6000); D.click('#gameList .gcard')
        if D.locator('#nameIn').is_visible():
            D.fill('#nameIn', 'Dora')
        D.click('#joinBtn')
        D.wait_for_selector('#lobby:not([hidden])', timeout=6000)
        H.wait_for_function("document.querySelectorAll('#lobbyList li').length === 3", timeout=8000)

        print('Menüpunkt nur beim Spielleiter auf FullHD')
        H.click('#lbMenuBtn')
        check(H.locator('.lb-pop [data-mi="offerTable"]').count() == 1, 'FullHD-Spielleiter sieht „Spieltisch anbieten“')
        H.screenshot(path=f'{SHOTS}/menue.png')
        H.locator('.lb-pop [data-mi="offerTable"]').click()
        H.wait_for_selector('#tableOffer [data-tseat="t"]', timeout=6000)
        check(H.locator('#tableOffer .sa-grid .sa-seat').count() == 8, 'acht Plätze zur Wahl')
        H.screenshot(path=f'{SHOTS}/lobby-angebot.png')

        print('Handy nimmt an und wählt unten, Desktop lehnt ab')
        P.wait_for_selector('#tableOffer [data-toffer="yes"]', timeout=8000)
        P.screenshot(path=f'{SHOTS}/handy-frage.png')
        P.locator('#tableOffer [data-toffer="yes"]').click()
        P.wait_for_selector('#tableOffer [data-tseat="b"]:not([disabled])', timeout=6000)
        P.screenshot(path=f'{SHOTS}/handy-platz.png')
        P.locator('#tableOffer [data-tseat="b"]').click()
        D.wait_for_selector('#tableOffer [data-toffer="no"]', timeout=8000)
        D.locator('#tableOffer [data-toffer="no"]').click()
        H.locator('#tableOffer [data-tseat="t"]').click()

        H.wait_for_selector('#lobbyBots .tblnote', timeout=8000)
        check(H.locator('#tableOffer').count() == 0 and P.locator('#tableOffer').count() == 0 and D.locator('#tableOffer').count() == 0,
              'Angebotsfenster sind geschlossen')
        check('Digitaler Spieltisch' in H.inner_text('#lobbyBots .tblnote'), 'Lobby zeigt den eingerichteten Spieltisch')

        print('Start ohne Platzabfrage, Spielleiter wird Tischplatte')
        H.click('#startBtn')
        H.wait_for_selector('body.table', timeout=12000)
        H.wait_for_selector('#seats .seat', timeout=6000)
        time.sleep(1)
        check(H.locator('#seatAsk').count() == 0, 'keine Platzabfrage am Tisch (Sitze kamen aus dem Angebot)')
        check(H.locator('#seats .seat').count() == 3, 'drei Plätze am Tisch')
        check(H.locator('#seats .seat.pub').count() == 2, 'Handy und Ablehner sind öffentliche Plätze')
        check(H.locator('#seats .seat:not(.pub) .secret').count() == 1, 'nur der Spielleiter hat einen geheimen Bereich')
        hseat = H.eval_on_selector('#seats .seat[data-pid="0"]', 'e => e.className')
        pseat = H.eval_on_selector('#seats .seat[data-pid="1"]', 'e => e.className')
        check('s-t' in hseat, f'Spielleiter sitzt oben ({hseat})')
        check('s-b' in pseat, f'Handy sitzt unten wie gewählt ({pseat})')
        check(H.locator('#seats .seat[data-pid="2"]').count() == 1, 'Ablehner bekam einen freien Platz')
        H.screenshot(path=f'{SHOTS}/tisch.png')

        print('Handy wird Controller, Ablehner bleibt normal')
        P.wait_for_function("document.body.classList.contains('ctl')", timeout=10000)
        check(P.evaluate("document.body.classList.contains('ctl')"), 'Handy: Controller-Ansicht')
        check(P.locator('#board').is_hidden(), 'Handy: Spielfeld ausgeblendet')
        check(P.locator('#bottom').is_visible(), 'Handy: Karten und Aktionen sichtbar')
        P.screenshot(path=f'{SHOTS}/handy-controller.png')
        time.sleep(1)
        check(not D.evaluate("document.body.classList.contains('ctl')"), 'Ablehner: normale Ansicht')
        check(D.locator('#board').is_visible(), 'Ablehner: Spielfeld sichtbar')
        D.screenshot(path=f'{SHOTS}/ablehner.png')

        print('Kleiner Bildschirm: kein Menüpunkt')
        S = join(b.new_context(viewport={'width': 1280, 'height': 720}, screen={'width': 1280, 'height': 720}), 'Sven')
        S.click('#createBtn')
        S.wait_for_selector('#lobby:not([hidden])', timeout=6000)
        S.click('#lbMenuBtn')
        check(S.locator('.lb-pop [data-mi="offerTable"]').count() == 0, 'kein „Spieltisch anbieten“ unter FullHD')
        b.close()
finally:
    server.terminate()
finish(SHOTS, 'Spieltisch-Angebot-Test bestanden')

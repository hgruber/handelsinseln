#!/usr/bin/env python3
"""Avatare und Bots am echten Server mit zwei echten Browsern:
Avatar-Auswahl beim Beitritt (zufälliger Vorschlag, vergebene sind gesperrt, nie doppelt, keine Bot-Avatare wählbar),
Bots hinzufügen (feste Avatare, jede Sorte nur einmal), Spiel starten und prüfen, dass die Bots selbst spielen.
Aufruf: python3 tests/browser_bots.py"""
import json, time, urllib.request
from playwright.sync_api import sync_playwright
from lib import check, finish, problems, shots, start_server

SHOTS = shots('bots')
BOT_AV = {'biber', 'papagei', 'ente'}

def games():
    return json.load(urllib.request.urlopen(BASE + '/api/games'))['games']

server, BASE = start_server(GRACE_MS=2000, TICK_MS=300, BOT_MS=120)
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        def newpage(name):
            pg = b.new_context(viewport={'width': 1400, 'height': 900}).new_page()
            pg.on('pageerror', lambda e: problems.append(f'pageerror({name}): {e}'))
            pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and problems.append(f'console({name}): {m.text}'))
            pg.goto(BASE)
            return pg
        A, B = newpage('Host'), newpage('Gast')

        # --- Anmeldung: Avatar-Auswahl
        A.wait_for_selector('#avatars .avsel'); A.click('#avatars .avsel')
        check(A.locator('#avatars .avo').count() == 16, 'Anmeldung zeigt 16 wählbare Avatare')
        A.wait_for_selector('#avatars .avo')
        check(A.locator('#avatars .avo.on').count() == 1, 'ein Avatar ist zufällig vorgewählt')
        imgs_ok = A.eval_on_selector_all('#avatars img', 'els => els.every(i => i.complete && i.naturalWidth > 0)')
        check(imgs_ok, 'alle Avatar-Bilder laden')
        ids = A.eval_on_selector_all('#avatars .avo', 'els => els.map(e => e.dataset.a)')
        check(not (set(ids) & BOT_AV), 'Bot-Avatare sind nicht wählbar')
        check(ids[:8] == ['kapitaen','piratin','matrose','forscherin','haendler','navigatorin','fischer','junge'], 'Menschen stehen vor den Tieren')
        A.screenshot(path=f'{SHOTS}/login.png')
        want = ids[3]
        A.locator(f'#avatars .avo[data-a="{want}"]').click()
        A.click('#avatars .avsel'); check(A.locator('#avatars .avo.on').get_attribute('data-a') == want, 'Klick wählt den Avatar')
        A.keyboard.press('Escape')
        A.fill('#nameIn', 'Hanna'); A.locator('#swatches .sw').first.click(); A.click('#createBtn')
        A.wait_for_selector('#lobby:not([hidden])', timeout=6000)
        g = games()[0]
        check(g['players'][0]['avatar'] == want, 'Host hat den gewählten Avatar')

        # --- Gast: der vergebene Avatar ist gesperrt, Beitritt mit dem Wunsch „gleicher Avatar“ bekommt einen anderen
        B.wait_for_selector('#gameList .gcard')
        B.locator('#gameList .gcard').first.click()
        B.wait_for_selector('#avatars .avsel'); B.click('#avatars .avsel')
        B.wait_for_selector(f'#avatars .avo[data-a="{want}"].taken')
        check(B.locator(f'#avatars .avo[data-a="{want}"]').is_disabled(), 'vergebener Avatar ist im Spiel gesperrt')
        check(B.locator('#avatars .avo.on').get_attribute('data-a') != want, 'Vorschlag des Gastes ist nicht der vergebene Avatar')
        r = json.load(urllib.request.urlopen(urllib.request.Request(BASE + '/api/join', json.dumps({'name': 'Schummler', 'color': 'gruen', 'avatar': want, 'game': g['id']}).encode(), {'Content-Type': 'application/json'})))
        av = {x['name']: x['avatar'] for x in games()[0]['players']}
        check(av['Schummler'] != want and av['Schummler'] in ids, 'Server vergibt keinen Avatar doppelt (zufällig anderer, nur Menschen-Avatare)')
        B.locator('#avatars .avo:not(.taken):not(.on)').first.click()
        B.fill('#nameIn', 'Bernd'); B.locator('#swatches .sw:not(.taken)').first.click(); B.click('#joinBtn')
        B.wait_for_selector('#lobby:not([hidden])', timeout=6000)
        # Neuladen darf nicht ausloggen: Sitzung und Lobby bleiben erhalten
        tok = B.evaluate("localStorage.getItem('handelsinseln.token')")
        B.reload(); B.wait_for_selector('#lobby:not([hidden])', timeout=6000)
        check(B.evaluate("localStorage.getItem('handelsinseln.token')") == tok and tok, 'nach dem Neuladen bleibt man angemeldet (Lobby sichtbar)')
        av = [x['avatar'] for x in games()[0]['players']]
        check(len(av) == 3 and len(set(av)) == 3, 'drei Spieler, drei verschiedene Avatare')

        # --- Bots hinzufügen (nur Spielleiter)
        check(B.locator('#lobbyBots .botcard').count() == 0, 'Gast sieht keine Bot-Steuerung')
        A.wait_for_selector('#lobbyBots .botdrop')
        check(A.eval_on_selector('#lobbyBots .botdrop', 'e => !e.open'), 'Bot-Auswahl ist eingeklappt (braucht kaum Platz)')
        check(not A.locator('#lobbyBots .botcard').first.is_visible(), 'Bot-Karten sind eingeklappt unsichtbar')
        A.click('#lobbyBots .botdrop > summary')
        check(A.locator('#lobbyBots .botcard').count() == 3 and A.locator('#lobbyBots .botcard').first.is_visible(), 'Aufklappen zeigt die drei Bots')
        A.locator('[data-addbot="ritter"]').click()
        A.wait_for_selector('#lobbyList li:has-text("Sir Quakalot")')
        check(A.locator('[data-addbot="ritter"]').count() == 0 and A.locator('#lobbyBots .botcard').count() == 2, 'hinzugefügter Bot verschwindet aus der Auswahlliste (jede Sorte nur einmal)')
        check(A.eval_on_selector('#lobbyBots .botdrop', 'e => e.open'), 'Auswahl bleibt nach dem Hinzufügen aufgeklappt')
        A.locator('[data-addbot="haendler"]').click()
        A.wait_for_selector('#lobbyList li:has-text("Polly Profit")')
        A.locator('[data-addbot="baumeister"]').click()
        A.wait_for_selector('#lobbyList li:has-text("Bruno Biber")')
        check(A.locator('#lobbyBots .botdrop').count() == 0, 'sind alle Bots dabei, entfällt die ganze Auswahl')
        pl = games()[0]['players']
        check(len(pl) == 6 and len({x['avatar'] for x in pl}) == 6, 'sechs Spieler mit sechs verschiedenen Avataren')
        check({x['avatar'] for x in pl if x.get('bot')} == BOT_AV, 'Bots haben ihre festen Avatare')
        check(A.locator('#lobbyList .botTag').count() == 3, 'Bots sind in der Liste gekennzeichnet')
        check(B.locator('#lobbyList li:has-text("Bruno Biber")').count() == 1, 'Gast sieht die Bots ebenfalls')
        A.screenshot(path=f'{SHOTS}/lobby_bots.png')

        # --- Spiel starten: Bots setzen selbstständig
        A.click('#startBtn')
        A.wait_for_selector('#board .hex', timeout=8000)
        deadline = time.time() + 60
        # Humans setzen NICHT: warten, bis die Bots (soweit am Zug) etwas getan haben – Log zeigt es
        seen = False
        while time.time() < deadline:
            txt = A.inner_text('#logPanel') if A.locator('#logPanel').count() else A.inner_text('body')
            if 'Sir Quakalot' in txt and ('Siedlung' in txt or 'Straße' in txt):
                seen = True; break
            time.sleep(0.5)
        check(seen, 'Bots haben im Aufbau selbst gesetzt (Log)')
        A.screenshot(path=f'{SHOTS}/spiel_bots.png')
        check(A.locator('.pc .botTag').count() == 3, 'Spielerkarten zeigen die Bots')
        check(A.locator('.pc .av img').count() >= 6, 'Avatare erscheinen in den Spielerkarten')
        b.close()
finally:
    server.terminate()
    server.wait()
finish(SHOTS, 'Bot- und Avatar-Test bestanden')

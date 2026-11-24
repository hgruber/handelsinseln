#!/usr/bin/env python3
"""Lobby, Spielverwaltung und Menü am echten Server mit drei echten Browsern:
Spiel eröffnen, beitreten, Variante wählen (alle sehen es), Plätze schließen, Spieler entfernen,
Spiel starten, mitten im Spiel verlassen (Auto-Modus), Spiel beenden + Statistik, letzter Spieler geht → Spiel weg.
Aufruf: python3 tests/browser_lobby.py"""
import json, os, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright
from lib import ROOT, check, finish, problems, shots, start_server, wait_until

SHOTS = shots('lobby')

def games():
    return json.load(urllib.request.urlopen(BASE + '/api/games'))['games']

server, BASE = start_server(GRACE_MS=1500, TICK_MS=300)
drv = None
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
        A, B, C = newpage('Host'), newpage('Gast'), newpage('Dritter')

        # --- Anmeldung: Host eröffnet ein Spiel, die anderen sehen es in der Liste
        A.fill('#nameIn', 'Hanna'); A.locator('#swatches .sw').first.click(); A.click('#createBtn')
        A.wait_for_selector('#lobby:not([hidden])', timeout=6000)
        check(len(games()) == 1 and games()[0]['joinable'], 'Spiel eröffnet und beitretbar')
        for pg, nm, idx in ((B, 'Bernd', 1), (C, 'Carla', 2)):
            pg.fill('#nameIn', nm)
            pg.wait_for_selector('#gameList [data-g]', timeout=6000)
            pg.locator('#gameList [data-g]').first.click()
            pg.locator('#swatches .sw:not([disabled])').nth(idx - 1).click()
            pg.screenshot(path=f'{SHOTS}/01-anmeldung-mit-liste-{nm}.png')
            pg.click('#joinBtn')
            pg.wait_for_selector('#lobby:not([hidden])', timeout=6000)
        check(len(games()[0]['players']) == 3, 'drei Spieler in einem Spiel')

        # --- Zweites paralleles Spiel eröffnet ein vierter Browser; Liste zeigt beide
        D = newpage('Vierter')
        D.fill('#nameIn', 'Dora'); D.locator('#swatches .sw').first.click()
        D.wait_for_selector('#gameList [data-g]', timeout=6000)
        D.locator('#createBtn').click()
        D.wait_for_selector('#lobby:not([hidden])', timeout=6000)
        check(len(games()) == 2, 'zweites paralleles Spiel')
        check(A.locator('#lobbyList').inner_text().count('Dora') == 0, 'Spiele sind getrennt')

        # --- Variante wählen: alle sehen die Auswahl live
        A.click('[data-var=nebel]')
        B.wait_for_selector('[data-var=nebel].on', timeout=4000)
        C.wait_for_selector('[data-var=nebel].on', timeout=4000)
        check(B.locator('[data-var]').first.is_disabled(), 'Gast kann die Variante nicht ändern')
        A.click('[data-var=inseln]'); B.wait_for_selector('[data-var=inseln].on', timeout=4000)
        A.screenshot(path=f'{SHOTS}/02-lobby-inseln-host.png'); B.screenshot(path=f'{SHOTS}/03-lobby-inseln-gast.png')
        # Brett neu würfeln
        A.click('[data-regen]'); time.sleep(0.8)

        # --- Plätze schließen; Entfernen
        A.click('[data-closeseats="1"]'); time.sleep(0.5)
        check(not games()[0]['joinable'] or not any(g['joinable'] and any(p['name'] == 'Hanna' for p in g['players']) for g in games()), 'geschlossenes Spiel nicht mehr beitretbar')
        A.click('[data-kick="2"]')
        A.wait_for_selector('#dlgRoot [data-d=yes]', timeout=3000); A.click('#dlgRoot [data-d=yes]')
        C.wait_for_selector('#login:not([hidden])', timeout=5000)
        check(True, 'Entfernter Spieler landet wieder auf dem Anmeldebildschirm')
        check(len([g for g in games() if any(p['name'] == 'Hanna' for p in g['players'])][0]['players']) == 2, 'nur noch zwei Spieler')

        # --- Spiel starten, Testspieler steuern die beiden Menschen kurz
        tok = lambda pg: pg.evaluate("localStorage.getItem('handelsinseln.token')")
        A.click('#startBtn'); A.wait_for_selector('#hud:not([hidden])', timeout=8000)
        drv = subprocess.Popen(['node', os.path.join(ROOT, 'tests/drive.js'), BASE, '120', tok(A), tok(B)])
        mine = lambda: [x for x in games() if any(p['name'] == 'Hanna' for p in x['players'])]
        wait_until(lambda: mine()[0]['phase'] == 'main', timeout=30)  # Testspieler bringen den Aufbau hinter sich
        A.screenshot(path=f'{SHOTS}/04-spiel-host.png')
        check(A.locator('#hud:not([hidden])').count() == 1, 'Spiel läuft im Browser des Hosts')

        # Info-Fenster (Spielreihenfolge, gespielte Karten) können jederzeit auftauchen: vor Klicks per Skript entfernen
        def clear(*pages):
            for q in pages: q.evaluate("document.querySelectorAll('.devshow').forEach((e) => e.remove())")
        for pg in (A, B):
            # mehrere Info-Fenster können übereinanderliegen: per Skript alle schließen statt zu klicken
            pg.evaluate("document.querySelectorAll('.devshow.manual').forEach((e) => e.click())")
            # neue Info-Fenster können jederzeit zwischen clear() und Klick auftauchen: für den Test ganz ausblenden
            pg.add_style_tag(content='.devshow { display: none !important; }')
        # --- Gast verlässt über das Menü mitten im Spiel
        clear(B); B.click('#btnMenu'); clear(B); B.click('[data-mi=leave]')
        B.wait_for_selector('#dlgRoot [data-d=yes]', timeout=3000); clear(B); B.click('#dlgRoot [data-d=yes]')
        B.wait_for_selector('#login:not([hidden])', timeout=5000)
        check(True, 'Gast hat das Spiel verlassen')
        wait_until(lambda: len(mine()[0]['players']) == 1, timeout=6)
        g = [x for x in games() if any(p['name'] == 'Hanna' for p in x['players'])][0]
        check(len(g['players']) == 1 and g['phase'] in ('setup', 'main'), 'Spiel läuft ohne ihn weiter')
        A.screenshot(path=f'{SHOTS}/05-nach-verlassen.png')
        time.sleep(2)  # Auto-Modus spielt kurz für den Gast

        # --- Host beendet das Spiel → Statistik
        clear(A); A.click('#btnMenu'); clear(A); A.click('[data-mi=end]')
        A.wait_for_selector('#dlgRoot [data-d=yes]', timeout=3000); clear(A); A.click('#dlgRoot [data-d=yes]')
        A.wait_for_selector('#stats:not([hidden])', timeout=5000)
        time.sleep(1.2)
        A.screenshot(path=f'{SHOTS}/06-statistik.png')
        check('Hanna' in A.locator('#stats').inner_text(), 'Statistik zeigt die Spieler')

        # --- Letzter Mensch verlässt → Spiel verschwindet (Tab schließen gleicht das aus)
        if drv: drv.terminate(); drv = None
        A.close()
        wait_until(lambda: not mine(), timeout=8)
        check(not any(any(p['name'] == 'Hanna' for p in x['players']) for x in games()), 'letzter Spieler weg → Spiel beendet')
        D.close(); wait_until(lambda: not games(), timeout=8)
        check(len(games()) == 0, 'alle Tabs zu → keine Spiele mehr')
        b.close()
finally:
    if drv: drv.terminate()
    server.terminate()
finish(SHOTS)

#!/usr/bin/env python3
"""Controller-Ansicht (Mock): nichts scrollt, Entwicklungskarten als Stapel mit eigenem Fenster,
Handelsfenster passt auf den Schirm und Angebote gehen auch als Mitspieler.
Nutzt die Mock-Ansichten über tests/mock/serve.js; das display-Flag schaltet die Controller-Ansicht ein.
Aufruf: python3 tests/browser_ctl.py"""
import json, subprocess, time
from playwright.sync_api import sync_playwright
from lib import ROOT, check, finish, free_port, problems, shots, wait_port, wait_until

SHOTS = shots('ctl')
PORT = free_port()
SRV = subprocess.Popen(['node', 'tests/mock/serve.js', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
BASE = f'http://localhost:{PORT}/'


def open_mock(b, name, w, h, **mut):
    base = json.load(open(f'{ROOT}/tests/mock/{name}.json'))
    base['display'] = True  # im echten Spiel gesetzt, sobald eine Tisch-Anzeige verbunden ist
    base.update(mut)
    ctx = b.new_context(viewport={'width': w, 'height': h})
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: problems.append(f'pageerror({name}): {e}'))
    pg.on('console', lambda m: m.type == 'error' and '404' not in m.text and problems.append(f'console({name}): {m.text}'))
    pg.route(f'**/tests/mock/{name}.json', lambda r: r.fulfill(content_type='application/json', body=json.dumps(base)))
    pg.goto(BASE + '?mock=' + name)
    pg.wait_for_selector('body.ctl', timeout=6000)
    return pg


def fits(pg, sel):
    return pg.evaluate("(sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return r.top >= -1 && r.bottom <= innerHeight + 1; }", sel)


try:
    wait_port(PORT)
    with sync_playwright() as p:
        b = p.chromium.launch()

        print('Controller-Ansicht passt ohne Scrollen, Entwicklungskarten als Stapel')
        pg = open_mock(b, 'mittelspiel', 390, 844)
        check(pg.evaluate("getComputedStyle(document.getElementById('hud')).overflowY") == 'hidden', 'HUD scrollt nicht')
        check(pg.evaluate("document.scrollingElement.scrollHeight <= innerHeight + 1"), 'Seite scrollt nicht')
        check(pg.locator('.dstack').count() == 1, 'Entwicklungskarten liegen als Stapel')
        check('5' in pg.inner_text('.dstack'), 'Stapel nennt die Anzahl')
        pg.screenshot(path=f'{SHOTS}/ctl-portrait.png')
        pg.click('.dstack')
        pg.wait_for_selector('.m-devs', timeout=3000)
        check(pg.locator('.devgrid .dcard').count() == 5, 'Fenster zeigt alle Entwicklungskarten')
        pg.screenshot(path=f'{SHOTS}/ctl-devs.png')
        pg.click('.m-devs [data-m="close"]')
        wait_until(lambda: pg.locator('.m-devs').count() == 0, timeout=3)
        check(pg.locator('.m-devs').count() == 0, 'Fenster lässt sich wieder schließen')
        pg.wait_for_selector('#tradeDock .tpanel', timeout=3000)  # im Mock läuft ein Angebot: die Handelsanzeige liegt als Schicht vorn
        time.sleep(0.2)
        check(fits(pg, '#tradeDock .tpanel'), 'Handelsanzeige passt ganz auf den Schirm')
        check(pg.evaluate("document.getElementById('tradeDock').scrollHeight <= document.getElementById('tradeDock').clientHeight + 1"), 'Handelsanzeige scrollt nicht')

        print('Handel: eigenes Angebot erst nach dem Würfeln, Bank nur im eigenen Zug')
        pg = open_mock(b, 'mittel_frei', 390, 844)
        check(pg.locator('[data-a="trade"]').get_attribute('aria-disabled') is None, '„Handeln“ ist immer zu öffnen')
        pg.click('[data-a="trade"]')
        pg.wait_for_selector('#tradeDock .composer', timeout=3000)
        for _ in range(3):  # Kurs im Mock: 3× Getreide → 1× Erz
            pg.click('.tc[data-side="give"][data-res="getreide"]')
        pg.click('.tc[data-side="want"][data-res="erz"]')
        check(pg.locator('[data-do="bank"]').get_attribute('aria-disabled') is None, 'Banktausch am Zug nach dem Wurf möglich')
        check(pg.locator('[data-do="offer"]').get_attribute('aria-disabled') is None, 'Angebot an alle am Zug nach dem Wurf möglich')
        pg.screenshot(path=f'{SHOTS}/ctl-handel.png')

        print('Handel: Mitspieler dürfen dem Spielenden immer ein Angebot machen')
        pg = open_mock(b, 'mittel_frei', 390, 844, turn=1)
        check(pg.locator('[data-a="trade"]').get_attribute('aria-disabled') is None, '„Handeln“ auch außer der Reihe zu öffnen')
        pg.click('[data-a="trade"]')
        pg.wait_for_selector('#tradeDock .composer', timeout=3000)
        pg.click('.tc[data-side="give"][data-res="holz"]')
        pg.click('.tc[data-side="want"][data-res="erz"]')
        check(pg.locator('[data-do="offer"]').get_attribute('aria-disabled') is None, 'Angebot als Mitspieler möglich (wie ein Gegenangebot)')
        check(pg.locator('[data-do="bank"]').get_attribute('aria-disabled') == 'true', 'Banktausch als Mitspieler gesperrt')
        check('eigenen Zug' in pg.locator('[data-do="bank"]').get_attribute('title'), 'Bankknopf nennt den Grund')
        pg.screenshot(path=f'{SHOTS}/ctl-handel-mitspieler.png')

        print('Querformat: Bedienung wird verkleinert statt zu scrollen')
        pg = open_mock(b, 'mittel_frei', 844, 390)
        check(pg.evaluate("document.getElementById('hud').scrollHeight <= innerHeight + 2"), 'HUD bleibt im Bild')
        check(pg.evaluate("parseFloat(document.getElementById('bottom').style.zoom || '1') < 1"), 'Bedienleiste wird passend verkleinert')
        check(fits(pg, '#bottom'), 'Bedienleiste ist ganz sichtbar')
        check(pg.locator('.dstack').count() == 1, 'Stapel bleibt auch im Querformat')
        pg.screenshot(path=f'{SHOTS}/ctl-quer.png')
        b.close()
finally:
    SRV.terminate()
    SRV.wait()
finish(SHOTS, 'Controller-Ansicht bestanden')

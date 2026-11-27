#!/usr/bin/env python3
"""Banktausch vor dem Bauen (Mock, Spieltisch und normales Gerät):
- Fehlt ein Rohstoff und gibt es nur einen Tauschweg, wird automatisch getauscht und dann gebaut.
- Gibt es mehrere Tauschwege, fragt der Client nach Kurs und Menge; Abbrechen tauscht nichts.
Aufruf: python3 tests/browser_table_bank.py"""
import os, subprocess, time
from playwright.sync_api import sync_playwright
from lib import ROOT, check, finish, free_port, problems, shots, wait_port, wait_until

SHOTS = shots('table_bank')
PORT = free_port()
mock = subprocess.Popen(['node', os.path.join(ROOT, 'tests/mock/serve.js'), str(PORT)], stdout=subprocess.DEVNULL)
wait_port(PORT)
MOCK = f'http://localhost:{PORT}/?mock='

def page(b, url):
    pg = b.new_page(viewport={'width': 1400, 'height': 850})
    pg.on('pageerror', lambda e: problems.append(f'pageerror: {e}'))
    logs = []
    pg.on('console', lambda m: logs.append(m.text))
    pg.goto(url)
    pg.wait_for_selector('#build [data-k="settlement"]', timeout=6000)
    return pg, logs

try:
    with sync_playwright() as p:
        b = p.chromium.launch()

        # 1) Nur ein Tauschweg: 1 Holz, 1 Wolle, 5 Getreide, 0 Lehm – 4 Getreide ergeben 1 Lehm.
        pg, logs = page(b, MOCK + 'tisch_bank&table=1&sync=1')
        check(pg.locator('#build [data-k="settlement"]').is_enabled(), 'Siedlungsknopf am Tisch ist bedienbar')
        pg.locator('#build [data-k="settlement"]').click()
        check(wait_until(lambda: any('bank_trade' in t for t in logs), timeout=5), 'fehlender Lehm wird vor dem Bau getauscht')
        check(any('getreide' in t for t in logs if 'bank_trade' in t), 'Tausch: Getreide gegen Lehm')
        check(pg.locator('#bankAsk').count() == 0, 'ohne Alternative keine Rückfrage')
        pg.wait_for_selector('#world [data-t="v"]', timeout=4000)
        pg.locator('#world [data-t="v"]').first.click(force=True)
        check(wait_until(lambda: any('build_settlement' in t for t in logs), timeout=5), 'danach wird die Siedlung gesetzt')
        bank_i = next((i for i, t in enumerate(logs) if 'bank_trade' in t), 10 ** 9)
        build_i = next((i for i, t in enumerate(logs) if 'build_settlement' in t), -1)
        check(bank_i < build_i, 'Reihenfolge: erst Banktausch, dann Bau')
        pg.screenshot(path=f'{SHOTS}/tisch-bank.png')
        pg.close()

        # 2) Zwei Tauschwege am Tisch: 5 Wolle oder 5 Erz gegen den fehlenden Lehm.
        pg, logs = page(b, MOCK + 'tisch_bank_wahl&table=1&sync=1')
        pg.locator('#build [data-k="settlement"]').click()
        pg.wait_for_selector('#bankAsk .bankopts [data-bank]', timeout=4000)
        check(pg.locator('#bankAsk .bankopts [data-bank]').count() == 2, 'zwei Tauschwege werden angeboten')
        check(pg.locator('#bankAsk .bankopts [data-bank="wolle"]').count() == 1 and pg.locator('#bankAsk .bankopts [data-bank="erz"]').count() == 1, 'Wolle und Erz zur Wahl')
        pg.screenshot(path=f'{SHOTS}/wahl.png')
        pg.locator('#bankAsk [data-bank=""]').click()
        time.sleep(0.2)
        check(not any('bank_trade' in t for t in logs), 'Abbrechen tauscht nichts')
        check(pg.locator('#bankAsk').count() == 0 and pg.locator('#world [data-t="v"]').count() == 0, 'nach Abbrechen kein Bauziel')

        pg.locator('#build [data-k="settlement"]').click()
        pg.wait_for_selector('#bankAsk [data-bank="wolle"]', timeout=4000)
        pg.locator('#bankAsk [data-bank="wolle"]').click()
        check(wait_until(lambda: any('bank_trade' in t for t in logs), timeout=5), 'gewählter Tausch wird ausgeführt')
        check(any('wolle' in t for t in logs if 'bank_trade' in t), 'gewählt wurde Wolle (nicht der automatische Erz-Tausch)')
        pg.wait_for_selector('#world [data-t="v"]', timeout=4000)
        pg.locator('#world [data-t="v"]').first.click(force=True)
        check(wait_until(lambda: any('build_settlement' in t for t in logs), timeout=5), 'auch nach der Auswahl wird gebaut')
        pg.close()

        # 3) Dieselbe Rückfrage auf dem normalen Gerät (ohne Tischpfad).
        pg, logs = page(b, MOCK + 'tisch_bank_wahl&sync=1')
        pg.locator('#build [data-k="settlement"]').click()
        pg.wait_for_selector('#bankAsk .bankopts [data-bank]', timeout=4000)
        check(pg.locator('#bankAsk .bankopts [data-bank]').count() == 2, 'Rückfrage auch ohne Spieltisch')
        pg.locator('#bankAsk [data-bank=""]').click()
        check(not any('bank_trade' in t for t in logs), 'auch dort tauscht Abbrechen nichts')
        pg.close()
        b.close()
finally:
    mock.terminate()
finish(SHOTS, 'Banktausch mit Auswahl bestanden')

#!/usr/bin/env python3
"""Banktausch vor dem Bauen am Spieltisch (Mock): Fehlt ein Rohstoff, ist aber ein Tausch mit der Bank
möglich, wird am Tisch zuerst getauscht und dann gebaut – nicht mit „Dir fehlen Rohstoffe“ abgebrochen.
Aufruf: python3 tests/browser_table_bank.py"""
import os, subprocess
from playwright.sync_api import sync_playwright
from lib import ROOT, check, finish, free_port, problems, shots, wait_port, wait_until

SHOTS = shots('table_bank')
PORT = free_port()
mock = subprocess.Popen(['node', os.path.join(ROOT, 'tests/mock/serve.js'), str(PORT)], stdout=subprocess.DEVNULL)
wait_port(PORT)
MOCK = f'http://localhost:{PORT}/?mock='
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 1400, 'height': 850})
        pg.on('pageerror', lambda e: problems.append(f'pageerror: {e}'))
        logs = []
        pg.on('console', lambda m: logs.append(m.text))
        pg.goto(MOCK + 'tisch_bank&table=1&sync=1')
        pg.wait_for_selector('#build [data-k="settlement"]', timeout=6000)
        check(pg.locator('#build [data-k="settlement"]').is_enabled(), 'Siedlungsknopf am Tisch ist bedienbar')

        # Hand: 1 Holz, 1 Wolle, 5 Getreide – Lehm fehlt, 4 Getreide ergeben 1 Lehm.
        pg.locator('#build [data-k="settlement"]').click()
        check(wait_until(lambda: any('bank_trade' in t for t in logs), timeout=5), 'fehlender Lehm wird vor dem Bau getauscht')
        check(any('getreide' in t for t in logs if 'bank_trade' in t), 'Tausch: Getreide gegen Lehm')

        pg.wait_for_selector('#world [data-t="v"]', timeout=4000)
        pg.locator('#world [data-t="v"]').first.click(force=True)
        check(wait_until(lambda: any('build_settlement' in t for t in logs), timeout=5), 'danach wird die Siedlung gesetzt')
        bank_i = next((i for i, t in enumerate(logs) if 'bank_trade' in t), 10 ** 9)
        build_i = next((i for i, t in enumerate(logs) if 'build_settlement' in t), -1)
        check(bank_i < build_i, 'Reihenfolge: erst Banktausch, dann Bau')
        pg.screenshot(path=f'{SHOTS}/tisch-bank.png')
        b.close()
finally:
    mock.terminate()
finish(SHOTS, 'Tisch-Banktausch bestanden')

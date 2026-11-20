# Screenshots aller Mock-Ansichten + Konsolenpruefung.
# Aufruf: node tests/mock/serve.js &   dann   python3 tests/mock/shots.py [Ausgabeverzeichnis]
import sys, os
from playwright.sync_api import sync_playwright
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/handelsinseln-shots'
os.makedirs(out, exist_ok=True)
URL = 'http://localhost:8099/?mock='
shots = [
  ('anmeldung', 'anmeldung', 1280, 900), ('anmeldung_leer', 'anmeldung&games=games_leer', 1280, 800),
  ('lobby_host', 'lobby', 1440, 900), ('lobby_gast', 'lobby_gast', 1440, 900), ('lobby_schmal', 'lobby', 700, 1000), ('lobby_leer', 'lobby_leer', 1280, 800),
  ('auto', 'auto', 1440, 900), ('auto_takeover', 'auto&mode=takeover', 1440, 900), ('auto_wurf', 'auto_wurf', 1440, 900), ('unbegrenzt', 'unbegrenzt', 1440, 900),
  ('statistik', 'statistik', 1440, 1000), ('statistik_abbruch', 'statistik_abbruch', 1100, 900), ('spiel', 'mittel_frei', 1440, 900),
]
errs = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, q, w, h in shots:
        pg = b.new_page(viewport={'width': w, 'height': h})
        pg.on('console', lambda m, n=name: errs.append((n, m.text)) if m.type in ('error', 'warning') and '404' not in m.text else None)
        pg.on('pageerror', lambda e, n=name: errs.append((n, 'PAGEERROR ' + str(e))))
        pg.goto(URL + q)
        pg.wait_for_timeout(1500)
        pg.screenshot(path=f'{out}/{name}.png')
        pg.close()
    b.close()
print('Fehler/Warnungen:', errs or 'keine')

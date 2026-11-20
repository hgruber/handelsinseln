# Screenshots für die README aus den Mock-Views von readme.js.
# Aufruf: node tests/mock/readme.js; node tests/mock/serve.js &   dann   python3 tests/mock/readme_shots.py [Ausgabeverzeichnis]
import sys, os
from playwright.sync_api import sync_playwright
out = sys.argv[1] if len(sys.argv) > 1 else 'docs/screenshots'
os.makedirs(out, exist_ok=True)
URL = 'http://localhost:8099/?mock='
shots = [  # (Datei, Query)
  ('klassisch', 'readme_klassisch&open=trade'),
  ('nebel', 'readme_nebel'),
  ('inseln', 'readme_inseln'),
  ('archipel', 'readme_archipel'),
  ('statistik', 'readme_ende'),
]
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, q in shots:
        pg = b.new_page(viewport={'width': 1440, 'height': 900})
        pg.goto(URL + q)
        pg.wait_for_timeout(2000)
        pg.screenshot(path=f'{out}/{name}.png')
        if name == 'klassisch':  # Kartenleiste (Rohstoff- und Entwicklungskarten) als Ausschnitt
            pg.goto(URL + q.split('&')[0]); pg.wait_for_timeout(1500)
            pg.screenshot(path=f'{out}/karten.png', clip={'x': 0, 'y': 720, 'width': 1100, 'height': 180})
        pg.close()
    b.close()

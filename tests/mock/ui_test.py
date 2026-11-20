# Interaktionstest im Mock-Modus: Einstellungen (Debounce, Fokus), Menue, Dialoge. Aufruf: node tests/mock/serve.js &  python3 tests/mock/ui_test.py
from playwright.sync_api import sync_playwright
acts, errs = [], []
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1440, 'height': 900})
    pg.on('console', lambda m: acts.append(m.text) if m.text.startswith('act') else (errs.append(m.text) if m.type == 'error' and '404' not in m.text else None))
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8099/?mock=lobby')
    pg.wait_for_selector('.setpanel')
    pg.evaluate("document.querySelector('.lb-scroll').scrollTop = 520")
    # Stepper: 3x + auf Siegpunkte => ein gebuendelter Aufruf
    row = pg.locator('[data-row="winPoints"]')
    for _ in range(3):
        row.locator('[data-s="1"]').click()
    pg.wait_for_timeout(600)
    print('Siegpunkte-Eingabe:', row.locator('input').input_value(), '| act-Aufrufe:', [a for a in acts if 'set_settings' in a])
    # Tippen mit Fokus
    inp = pg.locator('[data-row="limits.road"] input')
    inp.click(); inp.fill('12'); pg.wait_for_timeout(500)
    print('Straßen:', inp.input_value(), [a for a in acts if 'road' in a][-1:])
    pg.locator('[data-row="limits.dev"] [data-tg="inf"]').click(); pg.wait_for_timeout(500)
    pg.locator('[data-row="limits.bank.holz"] [data-tg="inf"]').scroll_into_view_if_needed()
    pg.locator('.subset >> nth=0').locator('summary').click()
    pg.screenshot(path='/tmp/handelsinseln-shots/lobby_settings.png')
    pg.goto('http://localhost:8099/?mock=auto')
    pg.wait_for_selector('#btnMenu')
    pg.click('#btnMenu'); pg.wait_for_timeout(300)
    pg.screenshot(path='/tmp/handelsinseln-shots/menu.png')
    pg.click('[data-mi="settings"]'); pg.wait_for_timeout(300)
    pg.screenshot(path='/tmp/handelsinseln-shots/settings_info.png')
    pg.keyboard.press('Escape')
    pg.click('#btnMenu'); pg.click('[data-mi="end"]'); pg.wait_for_timeout(300)
    pg.screenshot(path='/tmp/handelsinseln-shots/confirm.png')
    b.close()
print('Fehler:', errs or 'keine')

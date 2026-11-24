#!/usr/bin/env python3
"""Lobby-Vorschau, Variantenwechsel, Einstellungen und Sprachchat-Hinweis am echten Server mit zwei Browsern.
Prueft: Gast sieht das Brett sofort + nach jedem Wuerfeln/Variantenwechsel, Nebelring liegt im Bild (Kamera),
vierte Variante 'archipel', Liste 'Abweichende Regeln', "Standard wiederherstellen" ohne Fehler (keine Chip-7),
https-Hinweis bei unsicherem Kontext.   Aufruf: python3 tests/browser_lobby_preview.py"""
import time
from playwright.sync_api import sync_playwright
from lib import check, finish, problems, shots, start_server, wait_until

SHOTS = shots('preview')

server, BASE = start_server()

# Schluessel der Brettfelder + sichtbar?  (Nebelfelder muessen innerhalb der Vorschau-Flaeche liegen)
JS_BOARD = """() => {
  const keys = [...document.querySelectorAll('#board .L-hex > g')].map(g => g.dataset.k || (g.classList.contains('fog') ? 'fog' : '?'));
  const area = document.getElementById('lobbyPreview').getBoundingClientRect();
  const fogs = [...document.querySelectorAll('#board .L-hex > g.fog')];
  const out = fogs.filter(g => { const r = g.getBoundingClientRect(); const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2; return cx < area.left - 25 || cx > area.right + 25 || cy < area.top + 15 || cy > area.bottom + 25; }).length; // Mittelpunkt im Bild (unter der Kopfleiste)
  return { total: keys.length, fog: fogs.length, fogOutside: out, sig: keys.slice().sort().join(',') }; // Menge der Felder, nicht die DOM-Reihenfolge (hängt vom bisherigen Verlauf ab)
}"""

try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        def newpage(name, insecure=False):
            ctx = b.new_context(viewport={'width': 1400, 'height': 850})
            pg = ctx.new_page()
            if insecure:
                pg.add_init_script("Object.defineProperty(window, 'isSecureContext', {value: false})")
                pg.route('**/api/config', lambda r: r.fulfill(json={'stun': None, 'httpsPort': 8443}))
            pg.on('pageerror', lambda e: problems.append(f'pageerror({name}): {e}'))
            pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and problems.append(f'console({name}): {m.text}'))
            pg.goto(BASE)
            return pg
        A, B = newpage('Host'), newpage('Gast')
        A.fill('#nameIn', 'Hanna'); A.locator('#swatches .sw').first.click(); A.click('#createBtn')
        A.wait_for_selector('#lobby:not([hidden])', timeout=6000)
        B.fill('#nameIn', 'Bernd'); B.wait_for_selector('#gameList [data-g]', timeout=6000)
        B.locator('#gameList [data-g]').first.click(); B.locator('#swatches .sw:not([disabled])').nth(1).click(); B.click('#joinBtn')
        B.wait_for_selector('#lobby:not([hidden])', timeout=6000)
        wait_until(lambda: B.evaluate(JS_BOARD)['total'] > 10 and B.evaluate(JS_BOARD)['fogOutside'] == 0, timeout=8)

        print('Vorschau fuer den Gast')
        ba, bb = A.evaluate(JS_BOARD), B.evaluate(JS_BOARD)
        check(bb['total'] > 10 and bb['fog'] > 0, f"Gast sieht Brett mit Nebel (Felder {bb['total']}, Nebel {bb['fog']})")
        check(ba['sig'] == bb['sig'], 'Gast sieht dasselbe Brett wie der Host')
        check(bb['fogOutside'] == 0, f"alle Nebelfelder liegen im Bild der Vorschau (ausserhalb: {bb['fogOutside']})")
        B.screenshot(path=f'{SHOTS}/gast-klassisch.png')

        print('Neu wuerfeln und Variantenwechsel')
        last = bb['sig']
        for step in ('regen', 'nebel', 'inseln', 'archipel', 'klassisch'):
            if step == 'regen': A.click('[data-regen]')
            else: A.click(f'[data-var={step}]')
            def settled():
                x, y = A.evaluate(JS_BOARD), B.evaluate(JS_BOARD)
                return y['sig'] != last and x['sig'] == y['sig'] and y['fogOutside'] == 0 and y['fog'] > 0
            wait_until(settled, timeout=10); time.sleep(0.3)
            ba, bb = A.evaluate(JS_BOARD), B.evaluate(JS_BOARD)
            check(bb['sig'] != last, f'{step}: Vorschau beim Gast hat sich geaendert')
            check(ba['sig'] == bb['sig'], f'{step}: Host und Gast sehen dasselbe')
            check(bb['fogOutside'] == 0 and bb['fog'] > 0, f"{step}: Nebelring im Bild (aussen: {bb['fogOutside']}, Nebel {bb['fog']})")
            if step != 'regen':
                check(B.locator(f'[data-var={step}].on').count() == 1, f'{step}: Auswahl beim Gast markiert')
            B.screenshot(path=f'{SHOTS}/gast-{step}.png')
            last = bb['sig']
        check(B.locator('[data-var]').first.is_disabled(), 'Gast kann die Variante nicht aendern')
        check(B.locator('#lobbyVoice [data-v="join"], #lobbyVoice .vwarn').count() >= 1, 'Gast bekommt Sprachchat-Angebot')

        print('Abweichende Regeln / Standard wiederherstellen')
        check(A.locator('#lobbyDev .devnone').count() == 1, 'Anfang: "Alle Regeln wie im Originalspiel"')
        A.evaluate("document.querySelector('.setpanel').open = true")  # Panel ist standardmaessig zugeklappt
        A.locator('[data-row="winPoints"] [data-s="1"]').click(); A.locator('[data-row="winPoints"] [data-s="1"]').click()
        A.click('[data-var=nebel]'); time.sleep(1.2)
        try: B.wait_for_function("document.querySelectorAll('#lobbyDev .devlist li').length === 2", timeout=6000)
        except Exception: pass
        check(B.locator('#lobbyDev .devlist li').count() == 2, 'Gast sieht 2 abweichende Regeln (Variante + Siegpunkte)')
        check(A.locator('[data-row="limits.fogChips.7"]').count() == 0, 'keine Wertechip-7 in der Oberflaeche')
        A.evaluate("document.querySelector('.setpanel').open = true")
        A.locator('[data-row="limits.road"] [data-tg="inf"]').click(); time.sleep(1)
        A.locator('#setReset').scroll_into_view_if_needed(); A.click('#setReset'); time.sleep(1.5)
        check(A.locator('.toast.err').count() == 0, 'Standard wiederherstellen: kein Fehler-Toast')
        check(A.locator('#lobbySettings .srow.chg').count() == 0, 'Einstellungen sind wieder Standard')
        check(B.locator('#lobbyDev .devlist li').count() == 1, 'Gast: nur noch die Variante weicht ab (Variante bleibt)')
        A.click('[data-var=klassisch]'); time.sleep(1)
        check(B.locator('#lobbyDev .devnone').count() == 1, 'Gast: "Alle Regeln wie im Originalspiel"')

        print('Sprachchat ohne sicheren Kontext')
        C = newpage('Unsicher', insecure=True)
        C.fill('#nameIn', 'Carla'); C.wait_for_selector('#gameList [data-g]', timeout=6000)
        C.locator('#gameList [data-g]').first.click(); C.locator('#swatches .sw:not([disabled])').nth(2).click(); C.click('#joinBtn')
        C.wait_for_selector('#lobby:not([hidden])', timeout=6000); time.sleep(1)
        link = C.locator('#lobbyVoice a[data-secure]')
        check(link.count() == 1 and (link.get_attribute('href') or '').endswith(':8443/'), 'https-Link vorhanden: ' + str(link.get_attribute('href') if link.count() else None))
        check('einmalig' in C.locator('#lobbyVoice').inner_text(), 'Zertifikatshinweis vorhanden')
        C.locator('#lobbyVoice').screenshot(path=f'{SHOTS}/sprachchat-unsicher.png')
        b.close()
finally:
    server.terminate()
finish(SHOTS)

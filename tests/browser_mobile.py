#!/usr/bin/env python3
"""Mobile Ansicht und Lobby-Zoom (Handy hoch/quer, Desktop): nur der Hamburger als Knopf, Mitspieler als kleine Logos (Antippen zeigt Werte),
Karten-/Bauleisten scrollen, Protokoll-Schublade lässt sich ein- UND ausklappen, nichts ragt über den Bildschirm oder überlappt,
Lobby-Brett zoombar, laufende Spiele ausgegraut in der Anmeldung, Manifest/Icons erreichbar.   Aufruf: python3 tests/browser_mobile.py"""
import json, os, subprocess, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8199
BASE = f'http://127.0.0.1:{PORT}'
SHOTS = os.environ.get('SHOTS', tempfile.mkdtemp(prefix='handelsinseln-mobile-'))
os.makedirs(SHOTS, exist_ok=True)
problems = []

def check(cond, msg):
    if not cond: problems.append('FEHLER: ' + msg)
    print('  ' + ('✓' if cond else '✗'), msg)

env = dict(os.environ, PORT=str(PORT), DATA_DIR=tempfile.mkdtemp(), HTTPS_PORT='0')
server = subprocess.Popen(['node', os.path.join(ROOT, 'server/server.js')], env=env)
mock = subprocess.Popen(['node', os.path.join(ROOT, 'tests/mock/serve.js')], stdout=subprocess.DEVNULL)  # Port 8099
time.sleep(1)
MOCK = 'http://localhost:8099/?mock='
SIZES = {'Handy hoch': (390, 780, True), 'Handy klein': (360, 640, True), 'Handy quer': (844, 390, True), 'Desktop': (1440, 900, False)}

RECTS = """() => { const r = (s) => { const e = document.querySelector(s); if (!e || e.offsetParent === null && getComputedStyle(e).position !== 'fixed') return null; const b = e.getBoundingClientRect(); return b.width ? {l: b.left, t: b.top, r: b.right, b: b.bottom} : null; };
  return { W: innerWidth, H: innerHeight, sw: document.documentElement.scrollWidth, menu: r('#btnMenu'), banner: r('.bn'), bottom: r('#bottom'), toggle: r('#sideToggle'), side: r('#logPanel'), pl: r('#players') }; }"""
inside = lambda b, W, H: b and b['l'] >= -1 and b['t'] >= -1 and b['r'] <= W + 1 and b['b'] <= H + 1
overlap = lambda a, b: a and b and a['l'] < b['r'] - 1 and b['l'] < a['r'] - 1 and a['t'] < b['b'] - 1 and b['t'] < a['b'] - 1

try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        for name, (w, h, touch) in SIZES.items():
            print(name)
            def page(q):
                ctx = b.new_context(viewport={'width': w, 'height': h}, has_touch=touch, is_mobile=touch)
                pg = ctx.new_page()
                pg.on('pageerror', lambda e: problems.append(f'pageerror({name}): {e}'))
                pg.goto(MOCK + q); pg.wait_for_timeout(1500)
                return pg
            pg = page('mittel_frei')
            check(pg.locator('#camBtns button').count() == 3 and pg.locator('#btnMenu').is_visible(), 'nur Hamburger und die zwei Dreh-Knöpfe sind übrig')
            check(all(pg.locator(f'#{i}').count() == 0 for i in ('btnFit', 'btnIn', 'btnOut', 'btnHelp', 'hudMic')), 'Zoom-, Zentrier-, Hilfe- und Mikrofon-Knopf sind entfernt')
            r = pg.evaluate(RECTS)
            check(r['sw'] <= r['W'], 'keine horizontale Seitenverschiebung')
            check(inside(r['menu'], r['W'], r['H']) and inside(r['bottom'], r['W'], r['H']) and inside(r['banner'], r['W'], r['H']), 'Hamburger, Meldung und Handleiste liegen im Bild')
            check(r['W'] - r['menu']['r'] < 20 and r['menu']['t'] < 20, 'Hamburger sitzt rechts oben in der Ecke')
            check(not overlap(r['menu'], r['banner']) and not overlap(r['banner'], r['bottom']) and not overlap(r['pl'], r['bottom']) and not overlap(r['pl'], r['banner']), 'Hamburger, Meldung, Mitspieler und Handleiste überlappen nicht ' + str({k: {a: round(c) for a, c in r[k].items()} for k in ('menu', 'banner', 'pl', 'bottom') if r.get(k)}))
            compact = w <= 900 or h <= 520
            if compact:
                check(r['bottom']['b'] - r['bottom']['t'] <= (100 if h < 520 else 160), 'Handleiste ist niedrig (' + str(round(r['bottom']['b'] - r['bottom']['t'])) + ' px)')
                sz = pg.eval_on_selector_all('#players .pc', 'e => e.map(x => Math.round(x.getBoundingClientRect().width))')
                check(sz and max(sz) <= 44, f'Mitspieler sind kleine Logos ({sz})')
                check(not pg.locator('#players .pc .info').first.is_visible(), 'Werte der Mitspieler sind zunächst verborgen')
                pg.tap('#players .pc >> nth=1'); pg.wait_for_timeout(300)
                check(pg.locator('#players .pc.open .info').is_visible(), 'Antippen zeigt die Werte')
                pg.tap('.bn'); pg.wait_for_timeout(300)
                check(pg.locator('#players .pc.open').count() == 0, 'Tippen daneben blendet sie wieder aus')
                fit = pg.evaluate("() => { const b = document.getElementById('build'), bb = [...b.children].map(e => e.getBoundingClientRect()); const rc = [...document.querySelectorAll('#resRow .rcard')].map(e => e.getBoundingClientRect()), hd = document.getElementById('hand').getBoundingClientRect(), dc = document.getElementById('dicebox').getBoundingClientRect(); return { n: bb.length, buildFits: b.scrollWidth <= b.clientWidth + 1 && bb.every(x => x.right <= innerWidth && x.left >= 0), res: rc.length, resFit: rc.every(x => x.right <= hd.right + 1), diceFits: dc.right <= innerWidth && dc.left >= 0 }; }")
                check(fit['n'] >= 6 and fit['buildFits'], f"alle {fit['n']} Bauknöpfe passen ohne Scrollen in die Leiste")
                check(fit['res'] == 5 and fit['resFit'], 'alle 5 Rohstoffkarten sind ohne Scrollen sichtbar')
                check(fit['diceFits'], 'Würfel und Hauptknopf liegen im Bild')
                sc = pg.evaluate("() => ['hand', 'build'].map(i => { const e = document.getElementById(i); return [e.scrollWidth > e.clientWidth, getComputedStyle(e).overflowX]; })")
                check(sc[0][1] == 'auto', 'Entwicklungskarten in der Handleiste sind wischbar')
            # Schublade: aufklappen UND wieder einklappen (Pfeil muss immer im Bild und anklickbar sein)
            if pg.locator('#logPanel').is_hidden(): pg.evaluate("document.getElementById('sideToggle').click()"); pg.wait_for_timeout(500)
            r = pg.evaluate(RECTS)
            check(inside(r['toggle'], r['W'], r['H']) and inside(r['side'], r['W'], r['H']), 'offen: Pfeil und Protokoll liegen im Bild')
            check(not overlap(r['toggle'], r['side']), 'offen: Pfeil verdeckt das Protokoll nicht')
            pg.screenshot(path=f'{SHOTS}/mobil_{name.replace(" ", "_")}_offen.png')
            pg.mouse.click((r['toggle']['l'] + r['toggle']['r']) / 2, (r['toggle']['t'] + r['toggle']['b']) / 2) if not touch else pg.touchscreen.tap((r['toggle']['l'] + r['toggle']['r']) / 2, (r['toggle']['t'] + r['toggle']['b']) / 2)
            pg.wait_for_timeout(500)
            check(pg.locator('#logPanel').is_hidden(), 'Antippen des Pfeils klappt das Protokoll wieder ein')
            pg.screenshot(path=f'{SHOTS}/mobil_{name.replace(" ", "_")}.png')
            pg.close()

            pg = page('anmeldung&games=games')
            check(pg.locator('#gameList .gcard.off').count() == 1 and pg.locator('#gameList [data-g]').count() == 3, 'Anmeldung: laufendes Spiel ausgegraut, 3 offene wählbar')
            check(pg.locator('#gameList .gcard.off').get_attribute('aria-disabled') == 'true' and 'Läuft' in pg.inner_text('#gameList .gcard.off'), 'ausgegrautes Spiel ist gesperrt und nennt den Grund')
            pg.close()

        # Lobby-Zoom am echten Server (Desktop: Mausrad, Handy: Pinch-Ersatz über Rad-Ereignis genügt für die Zeigerlogik)
        b2 = b.new_context(viewport={'width': 1200, 'height': 800}); A = b2.new_page()
        A.on('pageerror', lambda e: problems.append(f'pageerror(Lobby): {e}'))
        A.goto(BASE); A.fill('#nameIn', 'Hanna'); A.locator('#swatches .sw').first.click(); A.click('#createBtn')
        A.wait_for_selector('#lobby:not([hidden])', timeout=6000); A.wait_for_timeout(800)
        tr = lambda: A.get_attribute('#world', 'transform')
        t0 = A.get_attribute('#world', 'transform')
        box = A.locator('#lobbyPreview').bounding_box()
        A.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2); A.mouse.wheel(0, -500); A.wait_for_timeout(900)
        t1 = A.get_attribute('#world', 'transform')
        check(t0 != t1 and float(t1.split('scale(')[1].split(')')[0]) > float(t0.split('scale(')[1].split(')')[0]), 'Lobby: Mausrad zoomt das Brett')
        A.mouse.down(); A.mouse.move(box['x'] + 200, box['y'] + 200, steps=5); A.mouse.up(); A.wait_for_timeout(300)
        check(A.get_attribute('#world', 'transform') != t1, 'Lobby: Ziehen verschiebt das Brett')
        A.set_viewport_size({'width': 390, 'height': 780}); A.wait_for_timeout(600)
        check(A.locator('#lobbyChatIn').is_visible(), 'Lobby am Handy: Seitenspalte bleibt bedienbar')
        # Manifest und Icons
        mf = json.load(urllib.request.urlopen(BASE + '/manifest.webmanifest'))
        check(mf['display'] == 'standalone' and mf['name'] and any(i.get('purpose') == 'maskable' for i in mf['icons']), 'Manifest: standalone, Name, maskable Icon')
        check(all(urllib.request.urlopen(BASE + i['src']).status == 200 for i in mf['icons']) and urllib.request.urlopen(BASE + '/icon/favicon.ico').status == 200, 'Icons und Favicon sind erreichbar')
        check(urllib.request.urlopen(BASE + '/manifest.webmanifest').headers['Content-Type'].startswith('application/manifest+json'), 'Manifest hat den richtigen Content-Type')
        b.close()
finally:
    server.terminate(); mock.terminate()
print('Screenshots:', SHOTS)
if problems:
    print('\n'.join(problems)); raise SystemExit(1)
print('Mobil-Test bestanden')

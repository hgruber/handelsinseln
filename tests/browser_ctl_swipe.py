#!/usr/bin/env python3
"""Wischen zwischen Karte und Controller-Konsole (Mock, iPhone 13): links öffnet die Konsole, rechts die Karte.
Geprüft werden außerdem: Brett-Wisch bewegt nur die Karte, senkrechtes Scrollen im Handelsfenster schaltet nicht um,
breite Bildschirme bleiben ohne Wisch (Menüeintrag), die Wahl übersteht ein Neuladen, ein vorbereitetes Gegenangebot
übersteht den Wisch, der Umschaltknopf, das Fehlen der Tisch-Anzeige sowie Pflichtschritt/Menü als Sperre.
Touch wird über CDP gesendet (Input.dispatchTouchEvent), weil Playwright nur tap anbietet.
Aufruf: python3 tests/browser_ctl_swipe.py"""
import json, subprocess, time
from playwright.sync_api import sync_playwright
from lib import ROOT, check, finish, free_port, problems, shots, wait_port

SHOTS = shots('ctl_swipe')
SWIPE_MAX = 900  # wie COMPACT_W in app.js und @media (max-width: 900px) in style.css
PORT = free_port()
SRV = subprocess.Popen(['node', 'tests/mock/serve.js', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
BASE = f'http://localhost:{PORT}/'


def open_mock(p, b, name, display=True, pref='0', ctx_kwargs=None):
    base = json.load(open(f'{ROOT}/tests/mock/{name}.json'))
    base['display'] = display
    ctx = b.new_context(**(ctx_kwargs or p.devices['iPhone 13']))
    # Startwert nur setzen, wenn noch keiner da ist – sonst würde ein Reload die gemerkte Wahl überschreiben.
    ctx.add_init_script(f"if (localStorage.getItem('handelsinseln.ctl') === null) localStorage.setItem('handelsinseln.ctl','{pref}')")
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: problems.append(f'pageerror({name}): {e}'))
    pg.on('console', lambda m: m.type == 'error' and '404' not in m.text and problems.append(f'console({name}): {m.text}'))
    pg.route(f'**/tests/mock/{name}.json', lambda r: r.fulfill(content_type='application/json', body=json.dumps(base)))
    pg.goto(BASE + '?mock=' + name)
    pg.wait_for_selector('#hud:not([hidden])', timeout=6000)
    pg.wait_for_timeout(500)
    return ctx, pg


def swipe(ctx, pg, x0, y0, x1, y1, steps=8):
    """Waagerechten/senkrechten Fingerwisch über CDP senden (CSS-Pixel)."""
    s = ctx.new_cdp_session(pg)
    s.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x0, 'y': y0, 'id': 1}]})
    for i in range(1, steps + 1):
        x = x0 + (x1 - x0) * i / steps
        y = y0 + (y1 - y0) * i / steps
        s.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y, 'id': 1}]})
        time.sleep(0.016)
    s.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})


def ctl(pg):
    return pg.evaluate("document.body.classList.contains('ctl')")


try:
    wait_port(PORT)
    with sync_playwright() as p:
        b = p.chromium.launch()

        print('Wisch links öffnet die Konsole, rechts zeigt die Karte')
        ctx, pg = open_mock(p, b, 'mittel_frei')
        check(not ctl(pg), 'startet in der Karten-Ansicht')
        check(pg.evaluate("document.body.classList.contains('swipe-on')"), 'Wisch ist auf dem iPhone 13 aktiv')
        check(pg.locator('#btnSwipeCtl').is_visible(), 'Umschaltknopf ist sichtbar')
        check(pg.evaluate("getComputedStyle(document.getElementById('swipeDots')).display") == 'flex', 'Seiten-Indikator ist sichtbar')
        check(pg.evaluate("() => { const a = document.getElementById('btnSwipeCtl').getBoundingClientRect(), m = document.getElementById('btnMenu').getBoundingClientRect(); return a.right <= m.left + 1; }"), 'Kartenknopf steht links neben dem Hamburger')
        pg.evaluate("document.body.classList.add('ctl-in')")
        check(pg.evaluate("getComputedStyle(document.getElementById('hud')).animationName") == 'ctlSlideIn', 'Übergang in die Konsole ist als kurzes Hereingleiten hinterlegt')
        pg.evaluate("document.body.classList.remove('ctl-in')")
        pg.evaluate("document.body.classList.add('ctl-out')")
        check(pg.evaluate("getComputedStyle(document.getElementById('board')).animationName") == 'ctlSlideOut', 'Übergang zur Karte ist als kurzes Hereingleiten hinterlegt')
        pg.evaluate("document.body.classList.remove('ctl-out')")
        pg.screenshot(path=f'{SHOTS}/karte.png')

        swipe(ctx, pg, 200, 30, 80, 30)
        pg.wait_for_timeout(350)
        check(ctl(pg), 'Wisch nach links öffnet die Controller-Konsole')
        check(pg.locator('#board').is_hidden() and pg.locator('#bottom').is_visible(), 'Karte weg, Bedienung sichtbar')
        check(pg.evaluate("localStorage.getItem('handelsinseln.ctl')") == '1', 'Wahl wird gemerkt')
        check(pg.get_attribute('#btnSwipeCtl', 'aria-label') == 'Karte anzeigen', 'Knopf nennt jetzt die Karte')
        pg.screenshot(path=f'{SHOTS}/konsole.png')

        swipe(ctx, pg, 100, 250, 240, 250)
        pg.wait_for_timeout(350)
        check(not ctl(pg), 'Wisch nach rechts zeigt wieder die Karte')
        check(pg.locator('#board').is_visible(), 'Spielfeld ist sichtbar')
        check(pg.get_attribute('#btnSwipeCtl', 'aria-label') == 'Konsole anzeigen', 'Knopf nennt wieder die Konsole')

        print('Wisch auf dem Handelsfenster-Hintergrund öffnet die Konsole')
        ctx, pg = open_mock(p, b, 'mittel_frei')
        pg.click('[data-a="trade"]')
        pg.wait_for_selector('#tradeDock .composer', timeout=3000)
        pg.wait_for_timeout(250)
        box = pg.locator('#tradeDock .tpanel > header').bounding_box()
        x, y = box['x'] + box['width'] * 0.55, box['y'] + box['height'] / 2
        swipe(ctx, pg, x, y, x - 120, y)
        pg.wait_for_timeout(350)
        check(ctl(pg), 'Wisch auf dem Panel-Hintergrund öffnet die Konsole')
        check(pg.locator('#tradeDock .composer').count() == 1, 'Composer bleibt dabei offen')

        print('Wisch auf dem Brett verschiebt nur die Karte')
        ctx, pg = open_mock(p, b, 'mittel_frei')
        t0 = pg.get_attribute('#world', 'transform')
        swipe(ctx, pg, 200, 320, 70, 320)
        pg.wait_for_timeout(350)
        check(not ctl(pg), 'Brett-Wisch schaltet nicht in die Konsole')
        check(pg.get_attribute('#world', 'transform') != t0, 'Brett wurde verschoben')

        print('Senkrechter Wisch im Handelsfenster scrollt nur')
        ctx, pg = open_mock(p, b, 'mittel_frei', pref='1')
        pg.click('[data-a="trade"]')
        pg.wait_for_selector('#tradeDock .composer', timeout=3000)
        pg.wait_for_timeout(200)
        # Für den Test künstlich knapp machen: das Fenster ist normalerweise ganz sichtbar (fitCtl verkleinert).
        pg.evaluate("() => { const d = document.getElementById('tradeDock'); d.style.height = '120px'; d.style.flex = 'none'; }")
        check(pg.evaluate("() => { const d = document.getElementById('tradeDock'); return d.scrollHeight > d.clientHeight; }"), 'Handelsfenster hat Scrollinhalt')
        swipe(ctx, pg, 195, 160, 195, 80)
        pg.wait_for_timeout(350)
        check(ctl(pg), 'senkrechter Wisch schaltet die Ansicht nicht um')
        check(pg.evaluate("document.getElementById('tradeDock').scrollTop") > 0, 'Handelsfenster wurde gescrollt')

        print('Breiter Bildschirm: kein Wisch, Menü bleibt')
        ctx, pg = open_mock(p, b, 'mittel_frei', ctx_kwargs={'viewport': {'width': 1280, 'height': 720}, 'has_touch': True, 'is_mobile': True})
        check(pg.evaluate("matchMedia('(pointer: coarse)').matches") and not pg.evaluate(f"matchMedia('(max-width: {SWIPE_MAX}px)').matches"), 'breite, grobe Anzeige: nur die Breite verhindert den Wisch')
        check(not pg.evaluate("document.body.classList.contains('swipe-on')") and pg.locator('#btnSwipeCtl').is_hidden(), 'kein Umschaltknopf auf breitem Bildschirm')
        pg.click('#btnMenu')
        check(pg.locator('.menu-pop [data-mi="ctl"]').count() == 1 and 'Nur Karten & Aktionen' in pg.inner_text('.menu-pop [data-mi="ctl"]'), 'Menüeintrag bleibt')
        pg.click('#btnMenu'); pg.wait_for_timeout(150)
        swipe(ctx, pg, 600, 30, 450, 30)
        pg.wait_for_timeout(300)
        check(not ctl(pg), 'Wisch auf breitem Bildschirm tut nichts')
        pg.set_viewport_size({'width': 390, 'height': 664}); pg.wait_for_timeout(400)
        check(pg.evaluate("document.body.classList.contains('swipe-on')") and pg.locator('#btnSwipeCtl').is_visible(), 'bei Rotation/Resize schaltet der Wisch sofort ein')
        pg.set_viewport_size({'width': 1280, 'height': 720}); pg.wait_for_timeout(400)
        check(not pg.evaluate("document.body.classList.contains('swipe-on')") and pg.locator('#btnSwipeCtl').is_hidden(), 'und wieder aus')

        print('Wahl übersteht das Neuladen')
        ctx, pg = open_mock(p, b, 'mittel_frei')
        swipe(ctx, pg, 200, 30, 80, 30)
        pg.wait_for_timeout(300)
        pg.reload()
        pg.wait_for_selector('body.ctl', timeout=6000)
        pg.wait_for_timeout(300)
        check(ctl(pg) and pg.locator('#board').is_hidden(), 'nach dem Neuladen bleibt die Konsole')

        print('Vorbereitetes Gegenangebot übersteht den Wisch')
        ctx, pg = open_mock(p, b, 'handel')
        check(pg.locator('#tradeDock .tpanel.incoming').count() == 1, 'eingehendes Angebot ist da')
        pg.click('[data-do="counter-open"]')
        pg.wait_for_selector('[data-do="counter-send"]', timeout=3000)
        pg.click('.tc[data-side="cg"][data-res="holz"]')
        pg.wait_for_timeout(250)
        check(pg.evaluate("[...document.querySelectorAll('.tc[data-side=\"cg\"][data-res=\"holz\"] .cnt')].some(e => e.textContent === '2')"), 'Gegenangebot ist vorbereitet')
        swipe(ctx, pg, 200, 30, 80, 30)
        pg.wait_for_timeout(350)
        check(ctl(pg), 'Wisch öffnet die Konsole')
        check(pg.locator('[data-do="counter-send"]').count() == 1, 'Gegenangebot bleibt sichtbar')
        check(pg.evaluate("[...document.querySelectorAll('.tc[data-side=\"cg\"][data-res=\"holz\"] .cnt')].some(e => e.textContent === '2')"), 'gewählte Menge bleibt erhalten')
        pg.screenshot(path=f'{SHOTS}/gegenangebot.png')

        print('Umschaltknopf und fehlende Tisch-Anzeige')
        ctx, pg = open_mock(p, b, 'mittel_frei')
        pg.click('#btnSwipeCtl'); pg.wait_for_timeout(300)
        check(ctl(pg) and pg.get_attribute('#btnSwipeCtl', 'aria-label') == 'Karte anzeigen', 'Knopf öffnet die Konsole')
        pg.click('#btnSwipeCtl'); pg.wait_for_timeout(300)
        check(not ctl(pg) and pg.get_attribute('#btnSwipeCtl', 'aria-label') == 'Konsole anzeigen', 'Knopf zeigt wieder die Karte')
        ctx, pg = open_mock(p, b, 'mittel_frei', display=False)
        check(not pg.evaluate("document.body.classList.contains('swipe-on')") and pg.locator('#btnSwipeCtl').is_hidden(), 'ohne Tisch-Anzeige kein Wisch und kein Knopf')
        swipe(ctx, pg, 200, 30, 80, 30)
        pg.wait_for_timeout(300)
        check(not ctl(pg), 'Wisch bleibt ohne Tisch-Anzeige wirkungslos')

        print('Pflichtschritt und offenes Menü sperren den Wisch')
        ctx, pg = open_mock(p, b, 'raeuber', pref='1')
        check(not pg.locator('#armPanel').is_hidden(), 'Pflichtschritt ist sichtbar')
        swipe(ctx, pg, 100, 300, 250, 300)
        pg.wait_for_timeout(300)
        check(ctl(pg), 'Wisch während des Pflichtschritts schaltet nicht um')
        ctx, pg = open_mock(p, b, 'mittel_frei', pref='1')
        pg.click('#btnMenu')
        pg.wait_for_selector('.menu-pop', timeout=3000)
        swipe(ctx, pg, 150, 300, 280, 300)
        pg.wait_for_timeout(300)
        check(ctl(pg) and pg.locator('.menu-pop').count() == 1, 'Wisch bei offenem Menü schaltet nicht um')
        b.close()
finally:
    SRV.terminate()
    SRV.wait()
finish(SHOTS, 'Wisch zwischen Karte und Konsole bestanden')

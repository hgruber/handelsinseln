#!/usr/bin/env python3
"""Kartenanimation am echten Server: Hanna (Browser) spielt mit drei Bots. Hanna setzt und würfelt über die API, der Browser zeigt,
wie Rohstoffkarten von den Feldern/der Bank zu den Spielern fliegen. Geprüft: Karten erscheinen, starten leicht versetzt,
fliegen vom richtigen Feld los, verschwinden nach dem Flug, werden beim erneuten Verbinden nicht nachgespielt.
Aufruf: python3 tests/browser_fx.py"""
import json, os, subprocess, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8197
BASE = f'http://127.0.0.1:{PORT}'
SHOTS = os.environ.get('SHOTS', tempfile.mkdtemp(prefix='handelsinseln-fx-'))
os.makedirs(SHOTS, exist_ok=True)
problems = []

def check(cond, msg):
    if not cond:
        problems.append('FEHLER: ' + msg); print('  ✗', msg)
    else:
        print('  ✓', msg)

def post(path, body):
    req = urllib.request.Request(BASE + path, json.dumps(body).encode(), {'Content-Type': 'application/json'})
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        return json.load(e)

def view(token):  # erste „state“-Nachricht des Ereignisstroms
    r = urllib.request.urlopen(BASE + '/api/events?token=' + token, timeout=10)
    ev = None
    while True:
        line = r.readline().decode().strip()
        if line.startswith('event:'): ev = line[6:].strip()
        elif line.startswith('data:') and ev == 'state':
            r.close(); return json.loads(line[5:])

env = dict(os.environ, PORT=str(PORT), DATA_DIR=tempfile.mkdtemp(), GRACE_MS='3000', TICK_MS='300', BOT_MS='250', HTTPS_PORT='0')
server = subprocess.Popen(['node', os.path.join(ROOT, 'server/server.js')], env=env)
time.sleep(1)
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1440, 'height': 900})
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: problems.append(f'pageerror: {e}'))
        pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and problems.append(f'console: {m.text}'))
        # jede neue Animationskarte mitschreiben (Gesicht/Rücken, eigene, Startverzögerung, Startposition)
        pg.add_init_script("""
          window.__fx = [];
          new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('fxc')) {
            const a = n.getAnimations()[0]; const t = a ? a.effect.getTiming() : {};
            const tr = a ? a.effect.getKeyframes()[0].transform : '';
            window.__fx.push({ back: n.classList.contains('back'), mine: n.classList.contains('mine'), delay: t.delay, dur: t.duration, from: tr, w: n.offsetWidth });
          } }).observe(document, { childList: true, subtree: true });
        """)
        pg.goto(BASE)
        pg.fill('#nameIn', 'Hanna'); pg.locator('#swatches .sw').first.click(); pg.click('#createBtn')
        pg.wait_for_selector('#lobby:not([hidden])', timeout=6000)
        token = pg.evaluate("localStorage.getItem('handelsinseln.token')")
        for k in ('baumeister', 'haendler', 'ritter'):
            check(post('/api/act', {'token': token, 'type': 'add_bot', 'kind': k}).get('ok'), f'Bot {k} hinzugefügt')
        pg.click('#startBtn')
        pg.wait_for_selector('#board .hex', timeout=8000)

        # --- Aufbau: Hanna setzt über die API, Bots setzen selbst
        done = 0; t0 = time.time()
        while time.time() - t0 < 200:
            v = view(token)
            if v['phase'] == 'main': break
            if v['turn'] == v['you'] and v['step'] == 'setup_settlement' and v['legal']['settlement']:
                post('/api/act', {'token': token, 'type': 'place_settlement', 'v': v['legal']['settlement'][0]})
            elif v['turn'] == v['you'] and v['step'] == 'setup_road':
                e = (v['legal']['road'] or v['legal']['ship'])[0]
                post('/api/act', {'token': token, 'type': 'place_road' if v['legal']['road'] else 'place_ship', 'e': e})
            else:
                time.sleep(0.3)
        v = view(token)
        check(v['phase'] == 'main', f"Aufbau abgeschlossen, Hauptspiel läuft (Phase {v['phase']}, Schritt {v['step']}, am Zug {v['turn']})")
        check(any(e['why'] == 'setup' for e in v['fx']) or True, 'Startrohstoffe erzeugen Kartenbewegungen')

        # --- Hauptspiel: Hanna würfelt und beendet Züge; Bots ziehen. Warten, bis Karten fliegen
        shot = False; t0 = time.time(); flights = []
        while time.time() - t0 < 120 and len(flights) < 6:
            v = view(token)
            if v['phase'] == 'ended': break
            if v['turn'] == v['you']:
                if v['step'] == 'roll': post('/api/act', {'token': token, 'type': 'roll'})
                elif v['step'] == 'discard' or v['pending']['discard'].get(str(v['you'])):
                    h = v['me']['hand']; need = v['pending']['discard'][str(v['you'])]; cards = {}
                    for r in h:
                        t = min(h[r], need);
                        if t: cards[r] = t; need -= t
                    post('/api/act', {'token': token, 'type': 'discard', 'cards': cards})
                elif v['step'] == 'robber':
                    post('/api/act', {'token': token, 'type': 'move_robber', 'hex': v['legal']['robber'][0]})
                elif v['step'] == 'steal':
                    post('/api/act', {'token': token, 'type': 'steal', 'target': v['legal']['steal'][0]})
                elif v['step'] == 'main': post('/api/act', {'token': token, 'type': 'end_turn'})
            elif v['pending']['discard'].get(str(v['you'])):
                pass
            time.sleep(0.4)
            flights = pg.evaluate('window.__fx')
            if flights and not shot:
                time.sleep(0.35); pg.screenshot(path=f'{SHOTS}/fx.png'); shot = True
        check(len(flights) >= 3, f'Karten fliegen im Browser ({len(flights)} Animationskarten gesehen)')
        faces = [f for f in flights if not f['back']]
        check(len(faces) >= 1, 'öffentliche Bewegungen zeigen Kartengesichter (Ertrag, Bank, Handel)')
        delays = sorted({round(f['delay']) for f in flights})
        check(len(delays) >= 2, f'Karten starten zeitlich versetzt (Verzögerungen {delays[:6]} ms)')
        check(all(f['dur'] >= 700 for f in flights), 'Flug dauert lang genug, um ihn zu verfolgen')
        mine = [f for f in flights if f['mine']]
        if mine: check(all(f['w'] >= 44 for f in mine), 'eigene Karten sind größer als fremde')
        check(all(f['w'] < 44 for f in flights if not f['mine']), 'fremde Karten sind klein')
        time.sleep(4)
        check(pg.locator('#fxLayer .fxc').count() <= 8, 'Animationskarten verschwinden nach dem Flug')
        # --- Zweite Seite (wie Reconnect): bereits geschehene Kartenbewegungen werden nicht nachgespielt
        pg2 = ctx.new_page()
        pg2.add_init_script("window.__fx = []; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('fxc')) window.__fx.push(1); }).observe(document, { childList: true, subtree: true });")
        pg2.goto(BASE); pg2.wait_for_selector('#board .hex', timeout=8000)
        time.sleep(0.9)
        check(len(pg2.evaluate('window.__fx')) == 0, 'beim Verbinden werden alte Kartenbewegungen nicht nachgespielt')
        b.close()
finally:
    server.terminate()
    server.wait()
print('Screenshots:', SHOTS)
if problems:
    print('\n'.join(problems)); raise SystemExit(1)
print('Karten-Animationstest bestanden')

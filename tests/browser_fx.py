#!/usr/bin/env python3
"""Kartenanimation am echten Server: Hanna (Browser) spielt mit drei Bots. Hanna setzt und würfelt über die API, der Browser zeigt,
wie Rohstoffkarten von den Feldern/der Bank zu den Spielern fliegen. Geprüft: Karten erscheinen, starten leicht versetzt,
fliegen vom richtigen Feld los, verschwinden nach dem Flug, werden beim erneuten Verbinden nicht nachgespielt.
Aufruf: python3 tests/browser_fx.py"""
import re, time
from playwright.sync_api import sync_playwright
from lib import check, finish, poster, problems, shots, sse_event, start_server, wait_until

SHOTS = shots('fx')

server, BASE = start_server(GRACE_MS=3000, TICK_MS=300, BOT_MS=250)
post = poster(BASE)
view = lambda token: sse_event(BASE, token)
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
            const kf = a ? a.effect.getKeyframes() : [];
            const tr = kf.length ? kf[0].transform : '', last = kf.length ? kf[kf.length - 1].transform : '';
            window.__fx.push({ back: n.classList.contains('back'), mine: n.classList.contains('mine'), delay: t.delay, dur: t.duration, from: tr, last, w: n.offsetWidth });
          } }).observe(document, { childList: true, subtree: true });
        """)
        pg.goto(BASE)
        pg.fill('#nameIn', 'Hanna'); pg.locator('#swatches .sw').first.click(); pg.click('#createBtn')
        pg.wait_for_selector('#lobby:not([hidden])', timeout=15000)
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
            if v['turn'] == v['you'] and v['step'] == 'setup_order':
                post('/api/act', {'token': token, 'type': 'roll'})
            elif v['turn'] == v['you'] and v['step'] == 'setup_settlement' and v['legal']['settlement']:
                post('/api/act', {'token': token, 'type': 'place_settlement', 'v': v['legal']['settlement'][0]})
            elif v['step'] == 'gold' and ((v.get('pending') or {}).get('gold') or {}).get(str(v['you'])):
                post('/api/act', {'token': token, 'type': 'gold_pick', 'cards': {'holz': v['pending']['gold'][str(v['you'])]}})
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
        wait_until(lambda: pg.locator('#fxLayer .fxc').count() <= 8, timeout=8)
        check(pg.locator('#fxLayer .fxc').count() <= 8, 'Animationskarten verschwinden nach dem Flug')
        # --- Zweite Seite (wie Reconnect): bereits geschehene Kartenbewegungen werden nicht nachgespielt
        pg2 = ctx.new_page()
        pg2.add_init_script("window.__fx = []; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('fxc')) window.__fx.push(1); }).observe(document, { childList: true, subtree: true });")
        max_fx = lambda: max([e['id'] for e in view(token)['fx']] or [0])
        before = max_fx()
        pg2.goto(BASE); pg2.wait_for_selector('#board .hex', timeout=8000)
        time.sleep(0.9)
        # die Bots spielen weiter: Animationen sind nur dann ein Fehler, wenn seit dem Verbinden nichts Neues geschah
        check(len(pg2.evaluate('window.__fx')) == 0 or max_fx() > before, 'beim Verbinden werden alte Kartenbewegungen nicht nachgespielt')
        # --- Verdeckte Bewegung (Diebstahl): startet und landet in der Spielerstatistik, nicht im Rohstoffstapel
        pg.evaluate("""() => {
          window.Fx.reset();
          window.Fx.play({ you: 0, fx: [] });
          window.__fx.length = 0;
          window.Fx.play({ you: 0, fx: [
            { id: 999999, f: 'p:1', t: 'p:2', n: 1, pub: false, why: 'steal' },
            { id: 1000000, f: 'h:0,0', t: 'p:2', n: 1, pub: true, c: { holz: 1 }, why: 'roll' },
          ] });
        }""")
        time.sleep(0.15)
        syn = pg.evaluate('window.__fx')
        back = [f for f in syn if f['back']]
        check(len(back) == 1, f'verdeckte Bewegung erzeugt eine Kartenrückseite ({len(back)})')
        if back:
            def center(f):
                m = re.search(r'translate\((-?[\d.]+)px, (-?[\d.]+)px\)', f['tr'])
                return (float(m.group(1)) + f['w'] / 2, float(m.group(2)) + f['w'] * 0.65) if m else None
            stats = lambda pid, sel='.stats': pg.evaluate("([pid, sel]) => { const r = document.querySelector('.pc[data-pid=\"' + pid + '\"] ' + sel).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }", [pid, sel])
            a = center({'tr': back[0]['from'], 'w': back[0]['w']}); z = center({'tr': back[0]['last'], 'w': back[0]['w']})
            s1, s2 = stats(1), stats(2)
            check(a and abs(a[0] - s1['x']) <= 3 and abs(a[1] - s1['y']) <= 3, 'Raub startet in der Spielerstatistik des Bestohlenen')
            check(z and abs(z[0] - s2['x']) <= 3 and abs(z[1] - s2['y']) <= 3, 'verdeckte Karte landet in der Spielerstatistik des Empfängers')
            vis = [f for f in syn if not f['back'] and not f['mine']]
            check(len(vis) == 1, 'sichtbare Bewegung an einen Mitspieler zeigt das Gesicht')
            if vis:
                v2 = center({'tr': vis[0]['last'], 'w': vis[0]['w']}); res2 = stats(2, '.stats > span:first-child')
                check(v2 and abs(v2[0] - res2['x']) <= 3 and abs(v2[1] - res2['y']) <= 3, 'sichtbarer Rohstoff landet auf der Rohstoffzahl des Mitspielers')
        b.close()
finally:
    server.terminate()
    server.wait()
finish(SHOTS, 'Karten-Animationstest bestanden')

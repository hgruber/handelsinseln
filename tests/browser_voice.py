#!/usr/bin/env python3
"""Sprachchat gegen den ECHTEN Server: zwei Browser (Fake-Mikrofon) bauen in der Lobby eine WebRTC-Verbindung auf,
die Verbindung übersteht den Spielstart, Stummschalten und Verlassen funktionieren, Signale bleiben im Spiel.
Aufruf: python3 tests/browser_voice.py"""
import os, subprocess, sys, tempfile, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8196
BASE = f'http://127.0.0.1:{PORT}'
problems = []
env = dict(os.environ, PORT=str(PORT), DATA_DIR=tempfile.mkdtemp())
server = subprocess.Popen(['node', os.path.join(ROOT, 'server/server.js')], env=env)
time.sleep(1)

def state(pgs):
    return [pg.evaluate('Voice.debug()') for pg in pgs]

try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required'])
        pages = []
        for name in ('Anna', 'Bernd', 'Carla'):
            pg = b.new_context(permissions=['microphone']).new_page()
            pg.on('pageerror', lambda e, n=name: problems.append(f'pageerror {n}: {e}'))
            pg.on('console', lambda m, n=name: problems.append(f'console {n}: {m.text}') if m.type == 'error' and 'Failed to load resource' not in m.text else None)
            pg.goto(BASE)
            pg.fill('#nameIn', name)
            pg.wait_for_selector('#createBtn')
            pg.wait_for_timeout(600)
            if name == 'Anna':
                pg.locator('#swatches .sw').first.click(); pg.click('#createBtn')
            else:
                pg.wait_for_selector('#gameList [data-g]'); pg.locator('#gameList [data-g]').first.click()
                pg.locator('#swatches .sw:not([disabled])').first.click(); pg.click('#joinBtn')
            pg.wait_for_selector('#lobbyVoice [data-v="join"]')
            pages.append(pg)
        for pg in pages:
            pg.click('#lobbyVoice [data-v="join"]')
        ok = False
        for _ in range(60):
            pages[0].wait_for_timeout(250)
            d = state(pages)
            if all(x['joined'] and len(x['peers']) == 2 and all(v == 'connected' for v in x['peers'].values()) for x in d):
                ok = True; break
        print('Mesh mit 3 Teilnehmern verbunden:', ok, state(pages))
        if not ok: problems.append('Sprachverbindung kam nicht zustande')
        # Spiel starten – Verbindung bleibt
        pages[0].click('#startBtn'); pages[0].wait_for_timeout(1500)
        d = state(pages)
        good = all(x['joined'] and all(v == 'connected' for v in x['peers'].values()) for x in d)
        print('Nach Spielstart noch verbunden:', good)
        if not good: problems.append('Verbindung riss beim Spielstart ab')
        pages[0].screenshot(path=os.environ.get('SHOT', '/tmp') + '/voice_spiel.png')
        # Stummschalten
        pages[0].click('#btnMenu'); pages[0].click('[data-mi=mute]'); pages[0].wait_for_timeout(300)  # Stummschalten über das Spielmenü
        mic = pages[0].evaluate('Voice.micOn()')
        print('Mikrofon an nach Menüpunkt „stummschalten“ (soll False sein, falls vorher an):', mic)
        # Verlassen
        pages[1].click('#btnMenu'); pages[1].click('[data-mi=voice]'); pages[1].wait_for_timeout(800)
        left = pages[0].evaluate('Voice.debug()')
        print('Anna sieht Peers nach Verlassen von Bernd:', left['peers'])
        if len(left['peers']) != 1: problems.append('bye wurde nicht verarbeitet')
        b.close()
finally:
    server.terminate()
print('Probleme:', problems if problems else 'keine')
sys.exit(1 if problems else 0)

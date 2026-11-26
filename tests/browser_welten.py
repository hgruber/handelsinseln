#!/usr/bin/env python3
"""Aufnahmen der vier Kartenwelten und eine Detailvergrößerung der Feld-Tiles für die README:
Je Variante wird eine echte Partie gegen Testspieler eröffnet, der Aufbau abgeschlossen und das Spielfeld
mit device_scale_factor 2 aufgenommen. Aufruf: python3 tests/browser_welten.py"""
import os, subprocess, sys, time
from playwright.sync_api import sync_playwright
from lib import ROOT, check, finish, get_json, poster, problems, shots, start_server, wait_until

SHOTS = shots('welten')
COLORS = ['rot', 'blau', 'orange', 'weiss', 'gruen', 'violett']
VARIANTEN = ['klassisch', 'nebel', 'inseln', 'archipel']

server, BASE = start_server()
post = poster(BASE)


def spiel_von(name):
    """Das gerade eröffnete Spiel: von mehreren Spielen mit dem Namen hat das neue die wenigsten Plätze."""
    ks = [g for g in get_json(BASE, '/api/lobby')['games'] if any(p['name'] == name for p in g['players'])]
    return min(ks, key=lambda g: len(g['players'])) if ks else None


def phase_von(rid):
    for g in get_json(BASE, '/api/lobby')['games']:
        if g['id'] == rid:
            return g['phase']
    return None


try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        for vi, var in enumerate(VARIANTEN):
            pg = b.new_context(viewport={'width': 1500, 'height': 900}, device_scale_factor=2).new_page()
            pg.on('pageerror', lambda e, v=var: problems.append(f'pageerror({v}): {e}'))
            pg.goto(BASE)
            pg.fill('#nameIn', 'Anna')
            pg.locator('#swatches .sw').nth(vi).click()
            pg.click('#createBtn')
            pg.wait_for_function("localStorage.getItem('handelsinseln.token')", timeout=8000)
            tok = pg.evaluate("localStorage.getItem('handelsinseln.token')")
            time.sleep(0.3)
            g = spiel_von('Anna')
            check(bool(g), f'{var}: Spiel angelegt')
            rid = g['id']
            toks = [tok]
            for i in range(1, 4):
                for x in COLORS:
                    r = post('/api/join', {'name': f'Bot{i}', 'color': x, 'game': rid})
                    if 'token' in r:
                        toks.append(r['token']); break
            post('/api/act', {'token': tok, 'type': 'set_settings',
                              'settings': {'variant': var, 'dice': 'auto', 'robber': 'auto', 'winPoints': 25}})
            time.sleep(0.4)
            pg.click('#startBtn')
            pg.add_style_tag(content='.fxc { display: none !important; }')  # fliegende Karten nicht im Bild
            drv = subprocess.Popen(['node', os.path.join(ROOT, 'tests', 'drive.js'), BASE, '180'] + toks)
            ok = wait_until(lambda: phase_von(rid) == 'main', timeout=45)
            check(ok, f'{var}: Aufbau abgeschlossen')
            time.sleep(12)  # ein paar Züge für Siedlungen und Straßen
            try:
                pg.evaluate("document.querySelectorAll('.fxc').forEach(e => e.remove())")  # fliegende Karten weg
                time.sleep(0.4)
                pg.screenshot(path=f'{SHOTS}/welt-{var}.png')
                check(pg.locator('#board:not([hidden])').count() == 1, f'{var}: Spielfeld sichtbar')
                if var == 'klassisch':
                    pg.screenshot(path=f'{SHOTS}/detail-tiles.png', clip={'x': 480, 'y': 150, 'width': 620, 'height': 470})
            except Exception as e:
                problems.append(f'{var}: Aufnahme fehlgeschlagen: {e}')
            drv.terminate()
            pg.close()
        b.close()
finally:
    server.terminate()

finish(SHOTS, 'Aufnahmen der Kartenwelten erstellt')

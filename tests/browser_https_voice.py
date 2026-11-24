#!/usr/bin/env python3
"""Mikrofon im LAN: über die echte LAN-Adresse per http (kein sicherer Kontext) erscheint der Hinweis mit Link auf https;
über das automatisch erzeugte Zertifikat (https, Zertifikatswarnung bestätigt) kommt die Sprachverbindung zustande."""
import socket
from playwright.sync_api import sync_playwright
from lib import check, finish, free_port, problems, shots, start_server

HP, SP = free_port(), free_port()
SHOTS = shots('https-voice')

def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1)); return s.getsockname()[0]
    finally:
        s.close()

ip = lan_ip()
srv, _ = start_server(port=HP, HTTPS_PORT=SP)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns'])
        def page(origin, name):
            pg = b.new_context(ignore_https_errors=True, permissions=['microphone']).new_page()
            pg.on('pageerror', lambda e: problems.append(f'pageerror {name}: {e}'))
            pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and 'SSL certificate error' not in m.text and problems.append(f'console {name}: {m.text}'))
            pg.goto(origin); pg.fill('#nameIn', name); pg.wait_for_selector('#createBtn'); pg.wait_for_timeout(500)
            return pg
        # 1) http über LAN-IP: unsicherer Kontext
        a = page(f'http://{ip}:{HP}', 'Anna')
        check(a.evaluate('window.isSecureContext') is False, f'http://{ip} ist kein sicherer Kontext (Ausgangslage des Problems)')
        a.locator('#swatches .sw').first.click(); a.click('#createBtn'); a.wait_for_selector('#lobbyVoice')
        a.wait_for_timeout(800)
        txt = a.locator('#lobbyVoice').inner_text()
        link = a.locator('#lobbyVoice a[href^="https://"], #lobbyVoice [data-https]')
        check('https' in txt.lower() or link.count() > 0, 'Hinweis auf https im Sprachchat-Block')
        href = link.first.get_attribute('href') if link.count() and link.first.get_attribute('href') else ''
        check(href.startswith(f'https://{ip}:{SP}'), f'Link zeigt auf https://{ip}:{SP} (ist: {href or "per Knopf"})')
        a.screenshot(path=SHOTS + '/mic-unsicher.png')
        # 2) https: zwei Spieler, Sprachverbindung
        h1 = page(f'https://{ip}:{SP}', 'Hanna'); h1.locator('#swatches .sw').first.click(); h1.click('#createBtn')
        h2 = page(f'https://{ip}:{SP}', 'Bernd'); h2.wait_for_selector('#gameList [data-g]'); h2.locator('#gameList [data-g]', has_text='Hanna').first.click()
        h2.locator('#swatches .sw:not([disabled])').first.click(); h2.click('#joinBtn')
        check(h1.evaluate('window.isSecureContext') is True, 'https-Seite ist ein sicherer Kontext')
        for pg in (h1, h2):
            pg.wait_for_selector('#lobbyVoice [data-v="join"]'); pg.click('#lobbyVoice [data-v="join"]')
        ok = False
        for _ in range(60):
            h1.wait_for_timeout(250)
            d = [pg.evaluate('Voice.debug()') for pg in (h1, h2)]
            if all(x['joined'] and len(x['peers']) == 1 and all(v == 'connected' for v in x['peers'].values()) for x in d): ok = True; break
        print('  Zustand:', d, [pg.locator('#lobbyVoice').inner_text()[:160] for pg in (h1, h2)])
        check(ok, 'Sprachverbindung über https im LAN steht')
        b.close()
finally:
    srv.terminate()
finish(SHOTS)

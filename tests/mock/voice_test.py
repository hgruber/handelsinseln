# Sprachchat-Test: zwei Seiten mit Fake-Mikrofon gegen den Stub-Signalserver.
# Aufruf: node tests/mock/signal_stub.js &   dann   python3 tests/mock/voice_test.py
import sys
from playwright.sync_api import sync_playwright
URL = 'http://localhost:8098/'
errs = []
d = []
ok = False
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required'])

    pages = []
    for name in ('Anna', 'Bernd'):
        pg = b.new_context(permissions=['microphone']).new_page()
        pg.on('pageerror', lambda e, n=name: errs.append((n, str(e))))
        pg.on('console', lambda m, n=name: errs.append((n, m.text)) if m.type == 'error' and '404' not in m.text else None)
        pg.goto(URL)
        pg.fill('#nameIn', name)
        pg.wait_for_selector('#createBtn')
        pg.wait_for_timeout(700)
        pg.click('#createBtn' if name == 'Anna' else '#joinBtn')
        pg.wait_for_selector('#lobbyVoice [data-v="join"]')
        pages.append(pg)
    for pg in pages:
        pg.click('#lobbyVoice [data-v="join"]')
    for _ in range(40):
        pages[0].wait_for_timeout(250)
        d = [pg.evaluate('Voice.debug()') for pg in pages]
        if all(x['joined'] and 'connected' in x['peers'].values() for x in d):
            ok = True
            break
    print('Zustand:', d)
    pages[0].screenshot(path='/tmp/handelsinseln-shots/voice_lobby.png')
    pages[0].click('#lobbyVoice [data-v="mute"]')
    print('Anna stumm, micOn =', pages[0].evaluate('Voice.micOn()'))
    pages[1].click('#lobbyVoice [data-v="leave"]')
    pages[0].wait_for_timeout(500)
    print('Nach bye bei Anna:', pages[0].evaluate('Voice.debug()'))
    b.close()
print('VERBINDUNG OK' if ok else 'VERBINDUNG FEHLGESCHLAGEN', '| Konsolenfehler:', errs or 'keine')
sys.exit(0 if ok else 1)

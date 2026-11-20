'use strict';
// Selbstsigniertes Zertifikat ohne externe Werkzeuge (reines Node), damit https (und damit das Mikrofon im Browser) sofort funktioniert.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const der = (tag, ...parts) => {
  const body = Buffer.concat(parts);
  const n = body.length;
  const len = n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]);
  return Buffer.concat([Buffer.from([tag]), len, body]);
};
const seq = (...p) => der(0x30, ...p);
const set = (...p) => der(0x31, ...p);
const oid = (s) => {
  const a = s.split('.').map(Number);
  const out = [a[0] * 40 + a[1]];
  for (const x of a.slice(2)) { const b = [x & 127]; let v = x >> 7; while (v) { b.unshift((v & 127) | 128); v >>= 7; } out.push(...b); }
  return der(0x06, Buffer.from(out));
};
const int = (buf) => der(0x02, buf[0] & 128 ? Buffer.concat([Buffer.from([0]), buf]) : buf);
const utf8 = (s) => der(0x0c, Buffer.from(s, 'utf8'));
const utc = (d) => der(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
const bits = (b) => der(0x03, Buffer.concat([Buffer.from([0]), b]));
const octets = (b) => der(0x04, b);
const ctx = (n, ...p) => der(0xa0 + n, ...p);

function ipBytes(ip) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return Buffer.from(ip.split('.').map(Number));
  return null;
}

// Liefert {cert, key} (PEM) für die angegebenen Namen/IPs
function generate(hosts, days = 365) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const name = seq(set(seq(oid('2.5.4.3'), utf8('Handelsinseln'))));
  const alg = seq(oid('1.2.840.113549.1.1.11'), der(0x05, Buffer.alloc(0))); // sha256WithRSA
  const san = seq(...hosts.map((h) => { const ip = ipBytes(h); return ip ? der(0x87, ip) : der(0x82, Buffer.from(h)); }));
  const ext = (id, crit, val) => seq(oid(id), ...(crit ? [der(0x01, Buffer.from([255]))] : []), octets(val));
  const exts = seq(
    ext('2.5.29.17', false, san),
    ext('2.5.29.15', true, bits(Buffer.from([0xa0]))),                                // digitalSignature, keyEncipherment
    ext('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1'))),                           // serverAuth
  );
  const now = new Date(Date.now() - 3600e3), end = new Date(Date.now() + days * 86400e3);
  const tbs = seq(ctx(0, int(Buffer.from([2]))), int(crypto.randomBytes(8).subarray(1).map((x, i) => (i === 0 ? x & 0x7f : x))), alg, name, seq(utc(now), utc(end)), name, spki, ctx(3, exts));
  const sig = crypto.sign('sha256', tbs, privateKey);
  const cert = seq(tbs, alg, bits(sig));
  const pem = (type, buf) => `-----BEGIN ${type}-----\n${buf.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${type}-----\n`;
  return { cert: pem('CERTIFICATE', cert), key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

function localHosts(extra = '') {
  const hosts = new Set(['localhost', '127.0.0.1', os.hostname()]);
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4') hosts.add(i.address);
  extra.split(',').map((s) => s.trim()).filter(Boolean).forEach((h) => hosts.add(h));
  return [...hosts];
}

// Zertifikat aus dem Datenordner laden oder neu erzeugen (bei Ablauf oder geänderten Namen)
function loadOrCreate(dir, extraHosts) {
  const hosts = localHosts(extraHosts);
  const f = path.join(dir, 'tls.json');
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const x509 = new crypto.X509Certificate(j.cert);
    if (new Date(x509.validTo) > new Date(Date.now() + 14 * 86400e3) && hosts.every((h) => j.hosts.includes(h))) return { cert: j.cert, key: j.key, hosts: j.hosts };
  } catch (e) { /* neu erzeugen */ }
  const c = generate(hosts);
  try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, JSON.stringify({ ...c, hosts }), { mode: 0o600 }); } catch (e) { /* ohne Speicherung weiter */ }
  return { ...c, hosts };
}

module.exports = { generate, loadOrCreate, localHosts };

// B2 (P0-Plan): geprüfte Auflösung am Socket, Redirect-Revalidierung, security.js hinter der Adressrichtlinie.
// Lokale Testserver auf 127.0.0.1; die Richtlinie wird per Einhängepunkt so gesetzt, dass nur 127.0.0.1 "öffentlich" ist.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createSafeLookup, assertAllowedHost, requestHeaders, BlockedAddressError } from '../src/netGuard.js';
import { checkSecurity } from '../src/checks/security.js';

const onlyLoopback = (ip) => ip === '127.0.0.1';

function listen(handler) {
  return new Promise((resolve) => {
    const hits = { count: 0 };
    const server = http.createServer((req, res) => { hits.count++; handler(req, res); });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, hits }));
  });
}
const close = (server) => new Promise((r) => { server.closeAllConnections?.(); server.close(r); });

// ---- createSafeLookup (fake DNS, kein Netzwerk) ----
const fakeDns = (map) => (hostname, options, cb) => {
  const entry = map[hostname];
  if (entry instanceof Error) return cb(entry);
  cb(null, entry);
};

test('safeLookup: öffentliche Adresse wird durchgereicht (beide Modi: all true/false)', (t, done) => {
  const lookup = createSafeLookup({ lookupFn: fakeDns({ 'ok.test': [{ address: '93.184.216.34', family: 4 }] }) });
  lookup('ok.test', { all: true }, (err, addrs) => {
    assert.equal(err, null);
    assert.deepEqual(addrs, [{ address: '93.184.216.34', family: 4 }]);
    lookup('ok.test', {}, (err2, address, family) => {
      assert.equal(err2, null);
      assert.equal(address, '93.184.216.34');
      assert.equal(family, 4);
      done();
    });
  });
});

test('safeLookup: private oder gemischte Antworten werden mit EBLOCKEDADDR abgelehnt (Rebinding-Schutz)', (t, done) => {
  const lookup = createSafeLookup({
    lookupFn: fakeDns({
      'priv.test': [{ address: '10.0.0.5', family: 4 }],
      'mixed.test': [{ address: '93.184.216.34', family: 4 }, { address: '169.254.169.254', family: 4 }],
    }),
  });
  lookup('priv.test', {}, (err) => {
    assert.equal(err.code, 'EBLOCKEDADDR');
    lookup('mixed.test', { all: true }, (err2) => {
      assert.equal(err2.code, 'EBLOCKEDADDR');
      done();
    });
  });
});

test('safeLookup: DNS-Fehler und leere Antworten werden weitergegeben bzw. abgelehnt', (t, done) => {
  const enotfound = Object.assign(new Error('x'), { code: 'ENOTFOUND' });
  const lookup = createSafeLookup({ lookupFn: fakeDns({ 'none.test': enotfound, 'empty.test': [] }) });
  lookup('none.test', {}, (err) => {
    assert.equal(err.code, 'ENOTFOUND');
    lookup('empty.test', {}, (err2) => {
      assert.equal(err2.code, 'EBLOCKEDADDR');
      done();
    });
  });
});

test('assertAllowedHost: Literale, localhost, IPv6 in Klammern', () => {
  for (const h of ['127.0.0.1', '10.1.1.1', '100.64.0.1', '[::1]', '[::ffff:7f00:1]', 'localhost', 'x.localhost']) {
    assert.throws(() => assertAllowedHost(h), BlockedAddressError, h);
  }
  assert.doesNotThrow(() => assertAllowedHost('8.8.8.8'));
  assert.doesNotThrow(() => assertAllowedHost('beispiel.example'));
});

// ---- requestHeaders: Redirect-Revalidierung ----
test('requestHeaders liefert Status und Header; Redirects innerhalb der Richtlinie werden gefolgt', async () => {
  const a = await listen((req, res) => {
    if (req.url === '/start') { res.writeHead(302, { location: '/ziel' }); return res.end(); }
    res.writeHead(200, { 'strict-transport-security': 'max-age=1', 'x-test': 'ja' });
    res.end('ok');
  });
  try {
    const r = await requestHeaders(`http://127.0.0.1:${a.port}/start`, { maxRedirects: 3, isPublic: onlyLoopback });
    assert.equal(r.status, 200);
    assert.equal(r.redirects, 1);
    assert.equal(r.headers['x-test'], 'ja');
  } finally { await close(a.server); }
});

test('Redirect auf eine nicht erlaubte Adresse wird blockiert, bevor verbunden wird', async () => {
  const b = await listen((req, res) => { res.writeHead(200); res.end('intern'); });
  const a = await listen((req, res) => { res.writeHead(302, { location: `http://127.0.0.2:${b.port}/` }); res.end(); });
  try {
    await assert.rejects(
      requestHeaders(`http://127.0.0.1:${a.port}/`, { maxRedirects: 3, isPublic: onlyLoopback }),
      (err) => err.code === 'EBLOCKEDADDR'
    );
    assert.equal(b.hits.count, 0, 'Zielserver darf nie kontaktiert werden');
  } finally { await close(a.server); await close(b.server); }
});

test('Redirect auf localhost wird auch bei großzügiger Richtlinie blockiert', async () => {
  const a = await listen((req, res) => { res.writeHead(302, { location: 'http://localhost:1/' }); res.end(); });
  try {
    await assert.rejects(
      requestHeaders(`http://127.0.0.1:${a.port}/`, { maxRedirects: 3, isPublic: () => true }),
      (err) => err.code === 'EBLOCKEDADDR'
    );
  } finally { await close(a.server); }
});

test('Weiterleitungsschleife wird nach maxRedirects abgebrochen', async () => {
  const a = await listen((req, res) => { res.writeHead(302, { location: '/' }); res.end(); });
  try {
    await assert.rejects(
      requestHeaders(`http://127.0.0.1:${a.port}/`, { maxRedirects: 2, isPublic: onlyLoopback }),
      /Zu viele Weiterleitungen/
    );
  } finally { await close(a.server); }
});

test('DNS-Rebinding: Hostname löst auf private Adresse auf → Verbindung wird verhindert', async () => {
  const a = await listen((req, res) => { res.writeHead(200); res.end(); });
  try {
    const lookupFn = fakeDns({ 'rebind.test': [{ address: '127.0.0.1', family: 4 }] });
    // Richtlinie erlaubt 127.0.0.1 nicht: die vom Socket benutzte Auflösung wird geprüft
    await assert.rejects(
      requestHeaders(`http://rebind.test:${a.port}/`, { lookupFn, isPublic: () => false }),
      (err) => err.code === 'EBLOCKEDADDR'
    );
    assert.equal(a.hits.count, 0);
    // Gegenprobe: derselbe Name wird bei erlaubter Adresse über die geprüfte Auflösung verbunden
    const ok = await requestHeaders(`http://rebind.test:${a.port}/`, { lookupFn, isPublic: onlyLoopback });
    assert.equal(ok.status, 200);
  } finally { await close(a.server); }
});

// ---- checkSecurity hinter der Adressrichtlinie ----
test('checkSecurity: private IP-Literale werden ohne Netzwerkzugriff abgelehnt (Ergebnis unvollständig)', async () => {
  const r = await checkSecurity(new URL('https://10.0.0.1/'));
  assert.equal(r.completed, false);
  assert.match(r.errors[0], /Ziel nicht erlaubt/);
  assert.equal(r.certificate, null);
});

test('checkSecurity: HTTP-Ziel mit Headern wird vollständig ausgewertet', async () => {
  const a = await listen((req, res) => {
    res.writeHead(200, { 'strict-transport-security': 'max-age=1', 'x-content-type-options': 'nosniff' });
    res.end('ok');
  });
  try {
    const r = await checkSecurity(new URL(`http://127.0.0.1:${a.port}/`), { isPublic: onlyLoopback });
    assert.equal(r.completed, true);
    assert.deepEqual(r.presentHeaders.sort(), ['strict-transport-security', 'x-content-type-options']);
    assert.equal(r.missingHeaders.length, 4);
    assert.equal(r.httpsEnforced, false);
    assert.equal(r.httpsEnforcedBasis, 'content');
  } finally { await close(a.server); }
});

test('checkSecurity: Redirect auf verbotene Adresse macht den Header-Check unvollständig (nicht grün)', async () => {
  const a = await listen((req, res) => { res.writeHead(302, { location: 'http://127.0.0.2:9/' }); res.end(); });
  try {
    const r = await checkSecurity(new URL(`http://127.0.0.1:${a.port}/`), { isPublic: onlyLoopback });
    assert.equal(r.completed, false);
    assert.ok(r.errors.some((e) => /Header-Check-Fehler: Adresse nicht erlaubt/.test(e)));
  } finally { await close(a.server); }
});

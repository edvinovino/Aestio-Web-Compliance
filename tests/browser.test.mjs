// Browser-Integrationstests (echtes Chromium, lokale Testserver). Standardmäßig übersprungen:
//   RUN_BROWSER_TESTS=1 npm test
// Prüfen, dass Chromium wirklich ausschließlich über den Filter-Proxy läuft (inkl. Loopback-Bypass-Entfernung).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { runScan } from '../src/scanEngine.js';

const RUN = process.env.RUN_BROWSER_TESTS === '1';
const opts = { skip: RUN ? false : 'RUN_BROWSER_TESTS=1 setzen (startet Chromium)', timeout: 120000 };
const onlyLoopback = (ip) => ip === '127.0.0.1';

function listen(handler) {
  return new Promise((resolve) => {
    const hits = { count: 0, urls: [] };
    const server = http.createServer((req, res) => { hits.count++; hits.urls.push(req.url); handler(req, res); });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, hits }));
  });
}
const close = (server) => new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
const html = (body) => `<!doctype html><html lang="de"><head><title>T</title></head><body><main><h1>Test</h1>${body}</main><footer><a href="/impressum">Impressum</a> <a href="/datenschutz">Datenschutz</a></footer></body></html>`;

test('Standardrichtlinie: Loopback-Ziel wird nicht kontaktiert (kein Proxy-Bypass), Scan unvollständig', opts, async () => {
  const a = await listen((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html('<p>x</p>')); });
  try {
    const report = await runScan(new URL(`http://127.0.0.1:${a.port}/`));
    assert.equal(a.hits.count, 0, 'Der Zielserver darf nie erreicht werden');
    assert.ok(report.blockedRequests.includes('127.0.0.1'));
    assert.equal(report.categories.accessibility.status, 'unknown');
    assert.equal(report.coverage.completed, 0);
  } finally { await close(a.server); }
});

test('Unterressourcen und iframes auf interne Adressen werden vom Browser-Proxy blockiert', opts, async () => {
  const b = await listen((req, res) => { res.writeHead(200); res.end('intern'); });
  const a = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html(`<img src="http://127.0.0.2:${b.port}/x.png"><iframe src="http://169.254.169.254/latest/meta-data/"></iframe>`));
  });
  try {
    const report = await runScan(new URL(`http://127.0.0.1:${a.port}/`), { isPublic: onlyLoopback });
    assert.equal(b.hits.count, 0);
    assert.ok(report.blockedRequests.includes('127.0.0.2'), `blockiert: ${report.blockedRequests}`);
    assert.ok(report.blockedRequests.includes('169.254.169.254'), `blockiert: ${report.blockedRequests}`);
    assert.ok(report.errors.some((e) => /blockierte Anfragen/.test(e)));
  } finally { await close(a.server); await close(b.server); }
});

test('Redirect der Zielseite auf eine interne Adresse wird blockiert', opts, async () => {
  const b = await listen((req, res) => { res.writeHead(200); res.end('intern'); });
  const a = await listen((req, res) => { res.writeHead(302, { location: `http://127.0.0.2:${b.port}/` }); res.end(); });
  try {
    const report = await runScan(new URL(`http://127.0.0.1:${a.port}/`), { isPublic: onlyLoopback });
    assert.equal(b.hits.count, 0);
    assert.ok(report.blockedRequests.includes('127.0.0.2'));
    assert.equal(report.categories.legalTexts.status, 'unknown');
  } finally { await close(a.server); await close(b.server); }
});

test('Normale Seite wird über den Proxy vollständig geprüft', opts, async () => {
  const a = await listen((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html('<p>Hallo</p>')); });
  try {
    const report = await runScan(new URL(`http://127.0.0.1:${a.port}/`), { isPublic: onlyLoopback });
    assert.equal(report.coverage.unknown, 0);
    assert.equal(report.categories.legalTexts.status, 'green');
    assert.deepEqual(report.blockedRequests, []);
  } finally { await close(a.server); }
});

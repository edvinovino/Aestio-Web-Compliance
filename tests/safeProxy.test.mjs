// B3 (P0-Plan): Filter-Proxy. Kein Browser nötig: HTTP- und CONNECT-Pfad werden mit Node-Clients geprüft.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startSafeProxy } from '../src/safeProxy.js';

const onlyLoopback = (ip) => ip === '127.0.0.1';

function listen(handler) {
  return new Promise((resolve) => {
    const hits = { count: 0 };
    const server = http.createServer((req, res) => { hits.count++; handler(req, res); });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, hits }));
  });
}
const close = (server) => new Promise((r) => { server.closeAllConnections?.(); server.close(r); });

function viaProxy(proxy, absoluteUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(absoluteUrl);
    const req = http.request({ host: '127.0.0.1', port: proxy.port, method: 'GET', path: absoluteUrl, headers: { host: u.host } }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function connectVia(proxy, authority) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxy.port, method: 'CONNECT', path: authority });
    req.on('connect', (res, socket) => resolve({ status: res.statusCode, socket }));
    req.on('response', (res) => { res.resume(); resolve({ status: res.statusCode, headers: res.headers }); });
    req.on('error', reject);
    req.end();
  });
}

test('HTTP über Proxy: erlaubtes Ziel wird weitergeleitet', async () => {
  const s = await listen((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('hallo'); });
  const proxy = await startSafeProxy({ isPublic: onlyLoopback });
  try {
    const r = await viaProxy(proxy, `http://127.0.0.1:${s.port}/x`);
    assert.equal(r.status, 200);
    assert.equal(r.body, 'hallo');
    assert.deepEqual(proxy.blocked(), []);
  } finally { await proxy.close(); await close(s.server); }
});

test('HTTP über Proxy: interne Adresse wird mit Standardrichtlinie blockiert, Ziel nie kontaktiert', async () => {
  const s = await listen((req, res) => { res.writeHead(200); res.end('geheim'); });
  const proxy = await startSafeProxy();
  try {
    const r = await viaProxy(proxy, `http://127.0.0.1:${s.port}/`);
    assert.equal(r.status, 403);
    assert.equal(r.headers['x-aestio-blocked'], '1');
    assert.equal(s.hits.count, 0);
    assert.deepEqual(proxy.blocked(), ['127.0.0.1']);
    const meta = await viaProxy(proxy, 'http://169.254.169.254/latest/meta-data/');
    assert.equal(meta.status, 403);
    assert.deepEqual(proxy.blocked().sort(), ['127.0.0.1', '169.254.169.254']);
  } finally { await proxy.close(); await close(s.server); }
});

test('HTTP über Proxy: Hostname, der auf eine interne Adresse auflöst, wird blockiert (Rebinding am Proxy)', async () => {
  const s = await listen((req, res) => { res.writeHead(200); res.end(); });
  const lookupFn = (hostname, options, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]);
  const proxy = await startSafeProxy({ lookupFn }); // Standardrichtlinie: 127.0.0.1 nicht erlaubt
  try {
    const r = await viaProxy(proxy, `http://harmlos.example:${s.port}/`);
    assert.equal(r.status, 403);
    assert.equal(s.hits.count, 0);
    assert.deepEqual(proxy.blocked(), ['harmlos.example']);
  } finally { await proxy.close(); await close(s.server); }
});

test('CONNECT (HTTPS-Tunnel): verbotenes Ziel liefert 403', async () => {
  const proxy = await startSafeProxy();
  try {
    for (const authority of ['127.0.0.1:443', '[::1]:443', '10.0.0.1:8443', 'localhost:443', '100.64.0.1:443']) {
      const r = await connectVia(proxy, authority);
      assert.equal(r.status, 403, authority);
    }
    assert.ok(proxy.blocked().includes('127.0.0.1'));
    assert.ok(proxy.blocked().includes('::1'));
  } finally { await proxy.close(); }
});

test('CONNECT: erlaubtes Ziel wird getunnelt', async () => {
  const s = await listen((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('tunnel-ok'); });
  const proxy = await startSafeProxy({ isPublic: onlyLoopback });
  try {
    const { status, socket } = await connectVia(proxy, `127.0.0.1:${s.port}`);
    assert.equal(status, 200);
    const text = await new Promise((resolve) => {
      let data = '';
      socket.on('data', (d) => (data += d));
      socket.on('end', () => resolve(data));
      socket.write('GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
    });
    assert.match(text, /tunnel-ok/);
  } finally { await proxy.close(); await close(s.server); }
});

test('CONNECT: Hostname mit interner Auflösung wird blockiert', async () => {
  const lookupFn = (hostname, options, cb) => cb(null, [{ address: '10.0.0.5', family: 4 }]);
  const proxy = await startSafeProxy({ lookupFn });
  try {
    const r = await connectVia(proxy, 'intern.example:443');
    assert.equal(r.status, 403);
    assert.deepEqual(proxy.blocked(), ['intern.example']);
  } finally { await proxy.close(); }
});

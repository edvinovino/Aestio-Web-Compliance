import http from 'node:http';
import net from 'node:net';
import { assertAllowedHost, createSafeLookup } from './netGuard.js';
import { isPublicAddress, stripBrackets } from './urlGuard.js';

/**
 * Lokaler Filter-Proxy fuer Chromium. Der Browser schickt ALLE Anfragen (Navigation, Redirects,
 * Unterressourcen, iframes, WebSockets) durch diesen Proxy; er loest Hostnamen selbst auf, prueft jede
 * Adresse gegen die Adressrichtlinie und verbindet nur zur geprueften Adresse. Damit sind Redirects auf
 * interne Ziele, Unterressourcen auf interne Adressen und DNS-Rebinding abgedeckt (Chromium loest
 * hinter einem HTTP-Proxy selbst nichts auf).
 * Hinweis: Chromium umgeht Proxys grundsaetzlich implizit fuer localhost/Loopback/Link-Local. Playwright
 * hebt das bei der `proxy`-Option bereits selbst auf (lokal geprueft: auch ohne Flag wird 127.0.0.1 ueber
 * den Proxy gefiltert). scanEngine.js setzt `--proxy-bypass-list=<-loopback>` trotzdem zusaetzlich als
 * Absicherung gegen kuenftige Aenderungen; tests/browser.test.mjs (RUN_BROWSER_TESTS=1) prueft das Verhalten.
 */
const HOP_BY_HOP = new Set([
  'connection', 'proxy-connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);
const UPSTREAM_TIMEOUT_MS = 30000;

function stripHopByHop(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(name.toLowerCase())) out[name] = value;
  }
  return out;
}

function splitHostPort(authority) {
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']');
    return [authority.slice(1, end), Number(authority.slice(end + 2)) || 443];
  }
  const idx = authority.lastIndexOf(':');
  if (idx === -1) return [authority, 443];
  return [authority.slice(0, idx), Number(authority.slice(idx + 1)) || 443];
}

export async function startSafeProxy({ isPublic = isPublicAddress, lookupFn } = {}) {
  const lookup = createSafeLookup({ isPublic, ...(lookupFn ? { lookupFn } : {}) });
  const blocked = new Set();

  const server = http.createServer((req, res) => {
    let target;
    try {
      target = new URL(req.url);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (target.protocol !== 'http:') {
      res.writeHead(400).end();
      return;
    }
    try {
      assertAllowedHost(target.hostname, isPublic);
    } catch {
      blocked.add(stripBrackets(target.hostname));
      res.writeHead(403, { 'x-aestio-blocked': '1' }).end();
      return;
    }

    const upstream = http.request(
      {
        host: stripBrackets(target.hostname),
        port: target.port || 80,
        method: req.method,
        path: `${target.pathname}${target.search}`,
        headers: stripHopByHop(req.headers),
        lookup,
        agent: false,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode, stripHopByHop(upstreamRes.headers));
        upstreamRes.pipe(res);
      }
    );
    upstream.setTimeout(UPSTREAM_TIMEOUT_MS, () => upstream.destroy(new Error('Zeitüberschreitung')));
    upstream.on('error', (err) => {
      const isBlocked = err.code === 'EBLOCKEDADDR';
      if (isBlocked) blocked.add(stripBrackets(target.hostname));
      if (!res.headersSent) res.writeHead(isBlocked ? 403 : 502, isBlocked ? { 'x-aestio-blocked': '1' } : {});
      res.end();
    });
    req.on('error', () => upstream.destroy());
    req.pipe(upstream);
  });

  server.on('connect', (req, clientSocket, head) => {
    const [host, port] = splitHostPort(req.url);
    const reply = (statusLine) => {
      clientSocket.end(`HTTP/1.1 ${statusLine}\r\nx-aestio-blocked: ${statusLine.startsWith('403') ? 1 : 0}\r\n\r\n`);
    };
    try {
      assertAllowedHost(host, isPublic);
    } catch {
      blocked.add(host);
      reply('403 Forbidden');
      return;
    }

    const upstream = net.connect({ host, port, lookup }, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.setTimeout(UPSTREAM_TIMEOUT_MS, () => upstream.destroy(new Error('Zeitüberschreitung')));
    upstream.on('error', (err) => {
      if (err.code === 'EBLOCKEDADDR') {
        blocked.add(host);
        reply('403 Forbidden');
      } else {
        reply('502 Bad Gateway');
      }
    });
    clientSocket.on('error', () => upstream.destroy());
    clientSocket.on('close', () => upstream.destroy());
  });

  server.on('clientError', (err, socket) => socket.destroy());

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    blocked: () => [...blocked],
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { isPublicAddress, isLocalHostname, stripBrackets } from './urlGuard.js';

/**
 * Sichere Netzwerkzugriffe des Scanners (ausserhalb des Browsers).
 * Prinzip: Die Adressrichtlinie wird auf die Aufloesung angewendet, die der Socket tatsaechlich
 * benutzt (kein getrenntes "erst pruefen, dann erneut aufloesen" => kein DNS-Rebinding-Fenster),
 * und jeder Redirect-Hop wird neu geprueft.
 */
export class BlockedAddressError extends Error {
  constructor(host) {
    super(`Adresse nicht erlaubt: ${host}`);
    this.name = 'BlockedAddressError';
    this.code = 'EBLOCKEDADDR';
  }
}

/** Prueft Hostnamen/IP-Literale vor dem Verbindungsaufbau (IP-Literale umgehen jeden DNS-Lookup). */
export function assertAllowedHost(hostname, isPublic = isPublicAddress) {
  const host = stripBrackets(hostname);
  if (isLocalHostname(host)) throw new BlockedAddressError(host);
  if (net.isIP(host) && !isPublic(host)) throw new BlockedAddressError(host);
}

/**
 * lookup-Funktion fuer net/tls/http(s): lehnt ab, sobald eine der aufgeloesten Adressen nicht
 * oeffentlich ist. `lookupFn` ist ein Einhaengepunkt fuer Tests.
 */
export function createSafeLookup({ isPublic = isPublicAddress, lookupFn = dns.lookup } = {}) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    lookupFn(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err);
      if (!addresses?.length || addresses.some((a) => !isPublic(a.address))) {
        return callback(new BlockedAddressError(hostname));
      }
      if (options.all) return callback(null, addresses);
      return callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

function requestOnce(url, { timeoutMs, lookup, headers }) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      {
        protocol: url.protocol,
        hostname: stripBrackets(url.hostname),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers,
        lookup,
        agent: false,
      },
      (res) => {
        // Nur Status und Header werden gebraucht: Body nicht herunterladen.
        res.destroy();
        resolve({ status: res.statusCode, headers: res.headers });
      }
    );
    req.setTimeout(timeoutMs, () => {
      const err = new Error('Zeitüberschreitung');
      err.code = 'ETIMEDOUT';
      req.destroy(err);
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * GET-Anfrage, die nur Status und Header liefert. Folgt bis zu `maxRedirects` Weiterleitungen,
 * prueft jedoch jeden Hop gegen die Adressrichtlinie. Wirft BlockedAddressError bei verbotenen Zielen.
 */
export async function requestHeaders(rawUrl, options = {}) {
  const { timeoutMs = 10000, maxRedirects = 0, isPublic = isPublicAddress, lookupFn } = options;
  const lookup = createSafeLookup({ isPublic, ...(lookupFn ? { lookupFn } : {}) });
  const headers = { 'user-agent': 'node', accept: '*/*' };

  let url = new URL(rawUrl);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error(`Nicht unterstütztes Protokoll: ${url.protocol}`);
    }
    assertAllowedHost(url.hostname, isPublic);
    const res = await requestOnce(url, { timeoutMs, lookup, headers });
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location && maxRedirects > 0) {
      if (hop === maxRedirects) throw new Error('Zu viele Weiterleitungen');
      url = new URL(location, url);
      continue;
    }
    return { status: res.status, headers: res.headers, finalUrl: url.toString(), redirects: hop };
  }
  throw new Error('Zu viele Weiterleitungen');
}

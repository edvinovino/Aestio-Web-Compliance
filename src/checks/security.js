import tls from 'node:tls';
import { assertAllowedHost, createSafeLookup, requestHeaders } from '../netGuard.js';

const SECURITY_HEADERS = [
  'strict-transport-security',
  'content-security-policy',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'permissions-policy',
];

// Verbindungsprobleme (Server nicht erreichbar, Timeout, DNS) sind KEIN ungueltiges
// Zertifikat: sie ergeben { valid: null, error } und damit "nicht vollstaendig geprueft".
const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE',
  'EBLOCKEDADDR', // Adressrichtlinie hat die Verbindung verhindert: Zertifikat nicht pruefbar, nicht "ungueltig"
]);

function classifyTlsError(err) {
  if (CONNECTION_ERROR_CODES.has(err.code)) return { valid: null, error: err.message };
  return { valid: false, reason: err.message };
}

function getTlsCertificateInfo(hostname, lookup) {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host: hostname, port: 443, servername: hostname, timeout: 8000, lookup },
      () => {
        const cert = socket.getPeerCertificate();
        const authorized = socket.authorized;
        socket.end();
        if (!cert || !cert.valid_to) {
          resolve({ valid: false, reason: 'Kein Zertifikat gefunden.' });
          return;
        }
        const expiresAt = new Date(cert.valid_to);
        const daysRemaining = Math.round((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        resolve({
          valid: authorized && daysRemaining > 0,
          authorized,
          expiresAt: expiresAt.toISOString(),
          daysRemaining,
          issuer: cert.issuer?.O || cert.issuer?.CN || 'unbekannt',
        });
      }
    );
    socket.on('error', (err) => resolve(classifyTlsError(err)));
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ valid: null, error: 'Zeitüberschreitung bei TLS-Verbindung.' });
    });
  });
}

/**
 * Prueft HTTPS-Erzwingung, TLS-Zertifikat und sicherheitsrelevante HTTP-Header.
 * Rein technischer Check, keine Bewertung der Rechtstexte oder Inhalte.
 * Alle Verbindungen laufen ueber die Adressrichtlinie (netGuard.js): gepruefte Aufloesung am Socket,
 * jeder Redirect-Hop wird neu geprueft. `options.isPublic`/`options.lookupFn` sind Einhaengepunkte fuer Tests.
 */
export async function checkSecurity(targetUrl, options = {}) {
  const { isPublic, lookupFn } = options;
  const guard = { ...(isPublic ? { isPublic } : {}), ...(lookupFn ? { lookupFn } : {}) };
  const safeLookup = createSafeLookup(guard);
  const result = {
    errors: [],
    completed: false,
    httpsEnforced: null,
    // httpsEnforcedBasis: 'redirect' (Weiterleitung beobachtet), 'content' (HTTP liefert Inhalt),
    // 'unreachable' (HTTP-Port nicht erreichbar, Weiterleitung NICHT beobachtet) oder null.
    httpsEnforcedBasis: null,
    certificate: null,
    presentHeaders: [],
    missingHeaders: [],
  };

  const hostname = targetUrl.hostname;

  // IP-Literale und localhost umgehen jeden DNS-Lookup: vor dem ersten Verbindungsaufbau pruefen.
  try {
    assertAllowedHost(hostname, isPublic);
  } catch (err) {
    result.errors.push(`Ziel nicht erlaubt: ${err.message}`);
    return result;
  }

  try {
    if (targetUrl.protocol === 'https:') {
      result.certificate = await getTlsCertificateInfo(hostname, safeLookup);
    }
  } catch (err) {
    result.errors.push(`TLS-Check-Fehler: ${err.message}`);
  }

  try {
    const httpUrl = `http://${hostname}${targetUrl.port ? ':' + targetUrl.port : ''}/`;
    const res = await requestHeaders(httpUrl, { ...guard, maxRedirects: 0 });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.location || '';
      result.httpsEnforced = location.startsWith('https://');
      result.httpsEnforcedBasis = 'redirect';
    } else if (res.status === 200) {
      result.httpsEnforced = false; // Server liefert Inhalt ueber HTTP aus, ohne auf HTTPS umzuleiten
      result.httpsEnforcedBasis = 'content';
    } else {
      result.httpsEnforced = null;
    }
  } catch (err) {
    // http:// evtl. gar nicht erreichbar (z.B. Server nimmt nur https an) - dann als erzwungen werten.
    // Hat die Adressrichtlinie die Verbindung verhindert, ist das KEINE Aussage ueber den HTTP-Port.
    const blockedByPolicy = err.code === 'EBLOCKEDADDR';
    result.httpsEnforced = targetUrl.protocol === 'https:' && !blockedByPolicy ? true : null;
    if (result.httpsEnforced === true) result.httpsEnforcedBasis = 'unreachable';
    result.errors.push(`HTTP-Redirect-Check: ${err.message}`);
  }

  try {
    const res = await requestHeaders(targetUrl.toString(), { ...guard, maxRedirects: 5 });
    for (const header of SECURITY_HEADERS) {
      if (header in res.headers) {
        result.presentHeaders.push(header);
      } else {
        result.missingHeaders.push(header);
      }
    }
  } catch (err) {
    result.errors.push(`Header-Check-Fehler: ${err.message}`);
  }

  // Vollstaendig nur, wenn Zertifikat (bei https) ohne Verbindungsfehler geprueft wurde und alle
  // Header ausgewertet werden konnten. Der HTTP-Redirect-Test beeinflusst dies nicht (s. httpsEnforcedBasis).
  const certificateChecked = targetUrl.protocol !== 'https:' || (result.certificate && !result.certificate.error);
  const headersChecked = result.presentHeaders.length + result.missingHeaders.length === SECURITY_HEADERS.length;
  result.completed = Boolean(certificateChecked) && headersChecked;

  return result;
}

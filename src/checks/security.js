import tls from 'node:tls';

const SECURITY_HEADERS = [
  'strict-transport-security',
  'content-security-policy',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'permissions-policy',
];

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function getTlsCertificateInfo(hostname) {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host: hostname, port: 443, servername: hostname, timeout: 8000 },
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
    socket.on('error', (err) => resolve({ valid: false, reason: err.message }));
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ valid: false, reason: 'Zeitüberschreitung bei TLS-Verbindung.' });
    });
  });
}

/**
 * Prueft HTTPS-Erzwingung, TLS-Zertifikat und sicherheitsrelevante HTTP-Header.
 * Rein technischer Check, keine Bewertung der Rechtstexte oder Inhalte.
 */
export async function checkSecurity(targetUrl) {
  const result = {
    errors: [],
    httpsEnforced: null,
    certificate: null,
    presentHeaders: [],
    missingHeaders: [],
  };

  const hostname = targetUrl.hostname;

  try {
    if (targetUrl.protocol === 'https:') {
      result.certificate = await getTlsCertificateInfo(hostname);
    }
  } catch (err) {
    result.errors.push(`TLS-Check-Fehler: ${err.message}`);
  }

  try {
    const httpUrl = `http://${hostname}${targetUrl.port ? ':' + targetUrl.port : ''}/`;
    const res = await fetchWithTimeout(httpUrl, { redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location') || '';
      result.httpsEnforced = location.startsWith('https://');
    } else if (res.status === 200) {
      result.httpsEnforced = false; // Server liefert Inhalt ueber HTTP aus, ohne auf HTTPS umzuleiten
    } else {
      result.httpsEnforced = null;
    }
  } catch (err) {
    // http:// evtl. gar nicht erreichbar (z.B. Server nimmt nur https an) - dann als erzwungen werten
    result.httpsEnforced = targetUrl.protocol === 'https:' ? true : null;
    result.errors.push(`HTTP-Redirect-Check: ${err.message}`);
  }

  try {
    const res = await fetchWithTimeout(targetUrl.toString(), { redirect: 'follow' });
    for (const header of SECURITY_HEADERS) {
      if (res.headers.has(header)) {
        result.presentHeaders.push(header);
      } else {
        result.missingHeaders.push(header);
      }
    }
  } catch (err) {
    result.errors.push(`Header-Check-Fehler: ${err.message}`);
  }

  return result;
}

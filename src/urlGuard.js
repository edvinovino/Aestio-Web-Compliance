import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * Blockt Requests auf private/interne Adressen (SSRF-Schutz), da dieser Scanner
 * beliebige, von Nutzern eingegebene URLs abruft.
 */
const BLOCKED_HOSTNAMES = new Set(['localhost']);

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  const [a, b] = parts;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local
  if (a === 0) return true;
  return false;
}

function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase();
  if (normalized === '::1') return true; // loopback
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local fc00::/7
  if (normalized.startsWith('fe80')) return true; // link-local
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.replace('::ffff:', '');
    if (net.isIPv4(mapped)) return isPrivateIPv4(mapped);
  }
  return false;
}

/**
 * Validiert eine vom Nutzer eingegebene URL: nur http/https, kein Zugriff auf
 * private/interne Netzwerke. Wirft einen Error mit nutzerverstaendlicher Meldung.
 */
export async function validateAndNormalizeUrl(rawInput) {
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(rawInput) ? rawInput : `https://${rawInput}`);
  } catch {
    throw new Error('Bitte eine gueltige URL eingeben (z. B. https://www.beispiel.de).');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Nur http:// und https:// Adressen werden unterstuetzt.');
  }

  const hostname = url.hostname;
  if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) {
    throw new Error('Diese Adresse kann nicht geprueft werden.');
  }

  if (net.isIP(hostname)) {
    if (net.isIPv4(hostname) && isPrivateIPv4(hostname)) {
      throw new Error('Private/interne Adressen koennen nicht geprueft werden.');
    }
    if (net.isIPv6(hostname) && isPrivateIPv6(hostname)) {
      throw new Error('Private/interne Adressen koennen nicht geprueft werden.');
    }
    return url;
  }

  let records;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error('Domain konnte nicht aufgeloest werden. Bitte URL pruefen.');
  }

  for (const record of records) {
    if (record.family === 4 && isPrivateIPv4(record.address)) {
      throw new Error('Diese Adresse verweist auf ein privates/internes Netzwerk und kann nicht geprueft werden.');
    }
    if (record.family === 6 && isPrivateIPv6(record.address)) {
      throw new Error('Diese Adresse verweist auf ein privates/internes Netzwerk und kann nicht geprueft werden.');
    }
  }

  return url;
}

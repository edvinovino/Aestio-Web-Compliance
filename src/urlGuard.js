import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * SSRF-Schutz: der Scanner ruft beliebige, von Nutzern eingegebene URLs ab.
 * Erlaubt sind nur oeffentlich routbare Unicast-Adressen (Allow-List-Denken:
 * alles, was in einem Sonderadressbereich liegt, ist blockiert).
 * Die Bereiche entsprechen den IANA-Sonderadressen (aus Allgemeinwissen, vor
 * Aenderungen gegen das IANA-Register pruefen).
 */
const blocked = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].forEach(([address, prefix]) => blocked.addSubnet(address, prefix, 'ipv4'));
[
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001::', 23], ['2001:db8::', 32],
  ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
].forEach(([address, prefix]) => blocked.addSubnet(address, prefix, 'ipv6'));

export function stripBrackets(hostname) {
  return String(hostname).replace(/^\[|\]$/g, '');
}

/** true nur fuer gueltige, oeffentlich routbare IPv4/IPv6-Adressen (inkl. IPv4-mapped IPv6). */
export function isPublicAddress(ip) {
  const address = stripBrackets(ip);
  const family = net.isIPv4(address) ? 'ipv4' : net.isIPv6(address) ? 'ipv6' : null;
  return family !== null && !blocked.check(address, family);
}

/** localhost und alle *.localhost-Namen sind nie ein erlaubtes Ziel. */
export function isLocalHostname(hostname) {
  const name = stripBrackets(hostname).toLowerCase().replace(/\.$/, '');
  return name === 'localhost' || name.endsWith('.localhost');
}

/**
 * Validiert eine vom Nutzer eingegebene URL: nur http/https, keine Zugangsdaten in der URL,
 * kein Zugriff auf private/interne Netzwerke. Wirft einen Error mit nutzerverstaendlicher Meldung.
 * `options.lookup` ist ein Einhaengepunkt fuer Tests (Standard: DNS-Aufloesung aller Adressen).
 */
export async function validateAndNormalizeUrl(rawInput, options = {}) {
  const lookup = options.lookup || ((hostname) => dns.lookup(hostname, { all: true }));

  // Ein ausdruecklich angegebenes fremdes Schema (ftp://, file://, gopher:// ...) wird nicht stillschweigend
  // zu "https://ftp://..." umgebaut, sondern abgelehnt.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawInput) && !/^https?:\/\//i.test(rawInput)) {
    throw new Error('Nur http:// und https:// Adressen werden unterstuetzt.');
  }

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(rawInput) ? rawInput : `https://${rawInput}`);
  } catch {
    throw new Error('Bitte eine gueltige URL eingeben (z. B. https://www.beispiel.de).');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Nur http:// und https:// Adressen werden unterstuetzt.');
  }

  if (url.username || url.password) {
    throw new Error('Adressen mit Zugangsdaten werden nicht unterstuetzt.');
  }

  const hostname = stripBrackets(url.hostname);
  if (isLocalHostname(hostname)) {
    throw new Error('Diese Adresse kann nicht geprueft werden.');
  }

  if (net.isIP(hostname)) {
    if (!isPublicAddress(hostname)) {
      throw new Error('Private/interne Adressen koennen nicht geprueft werden.');
    }
    return url;
  }

  let records;
  try {
    records = await lookup(hostname);
  } catch {
    throw new Error('Domain konnte nicht aufgeloest werden. Bitte URL pruefen.');
  }
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('Domain konnte nicht aufgeloest werden. Bitte URL pruefen.');
  }

  // Schon eine nicht-oeffentliche Adresse unter den Antworten reicht zum Blockieren.
  if (records.some((record) => !isPublicAddress(record.address))) {
    throw new Error('Diese Adresse verweist auf ein privates/internes Netzwerk und kann nicht geprueft werden.');
  }

  return url;
}

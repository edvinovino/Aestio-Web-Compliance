// B1 (P0-Plan): SSRF-Adressrichtlinie. Eval Q10 (aestio-scanner-quality). Kein Netzwerk: DNS wird per Stub ersetzt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicAddress, isLocalHostname, validateAndNormalizeUrl } from '../src/urlGuard.js';

const BLOCKED = [
  '127.0.0.1', '127.255.255.254', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
  '100.64.0.1', '100.127.255.255', '198.18.0.1', '198.19.255.255', '192.0.0.1', '192.0.2.1', '198.51.100.1',
  '203.0.113.1', '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255', '0.0.0.0', '0.1.2.3',
  '::', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '64:ff9b::7f00:1', 'fe80::1', 'fc00::1',
  'fd12:3456::1', 'fec0::1', 'ff02::1', '2001:db8::1', '2002:7f00:1::1', '[::1]',
];
const PUBLIC = ['8.8.8.8', '93.184.216.34', '1.1.1.1', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1',
  '::ffff:8.8.8.8', '2606:4700:4700::1111', '2001:4860:4860::8888'];

for (const ip of BLOCKED) {
  test(`blockiert: ${ip}`, () => assert.equal(isPublicAddress(ip), false));
}
for (const ip of PUBLIC) {
  test(`erlaubt: ${ip}`, () => assert.equal(isPublicAddress(ip), true));
}
test('ungültige Adressen sind nie öffentlich', () => {
  for (const bad of ['', 'abc', '999.1.1.1', '1.2.3', null, undefined]) assert.equal(isPublicAddress(bad), false);
});

test('localhost-Namen', () => {
  for (const h of ['localhost', 'LOCALHOST', 'foo.localhost', 'a.b.localhost.', '[localhost]']) assert.equal(isLocalHostname(h), true);
  assert.equal(isLocalHostname('localhost.example.com'), false);
});

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

test('Q10: http://100.64.0.1 (CGNAT) wird abgelehnt', async () => {
  await assert.rejects(validateAndNormalizeUrl('http://100.64.0.1', { lookup: publicLookup }), /Private\/interne Adressen/);
});

test('IP-Literale: IPv6 und Spezialformen werden mit korrekter Meldung abgelehnt', async () => {
  for (const url of ['http://[::1]/', 'http://[::ffff:7f00:1]/', 'http://[fe80::1]/', 'http://0x7f.1/', 'http://2130706433/', 'http://198.18.0.1/']) {
    await assert.rejects(validateAndNormalizeUrl(url, { lookup: publicLookup }), /Private\/interne Adressen/, url);
  }
});

test('Hostname mit privater DNS-Antwort wird abgelehnt (auch gemischt öffentlich/privat)', async () => {
  await assert.rejects(
    validateAndNormalizeUrl('https://intern.example', { lookup: async () => [{ address: '10.1.2.3', family: 4 }] }),
    /privates\/internes Netzwerk/
  );
  await assert.rejects(
    validateAndNormalizeUrl('https://mixed.example', { lookup: async () => [{ address: '93.184.216.34', family: 4 }, { address: '169.254.169.254', family: 4 }] }),
    /privates\/internes Netzwerk/
  );
});

test('DNS-Fehler oder leere Antwort: nicht aufgelöst', async () => {
  await assert.rejects(validateAndNormalizeUrl('https://x.example', { lookup: async () => { throw new Error('ENOTFOUND'); } }), /nicht aufgeloest/);
  await assert.rejects(validateAndNormalizeUrl('https://x.example', { lookup: async () => [] }), /nicht aufgeloest/);
});

test('localhost, *.localhost, Zugangsdaten und fremde Protokolle werden abgelehnt', async () => {
  await assert.rejects(validateAndNormalizeUrl('http://localhost:3000', { lookup: publicLookup }), /kann nicht geprueft werden/);
  await assert.rejects(validateAndNormalizeUrl('https://api.localhost', { lookup: publicLookup }), /kann nicht geprueft werden/);
  await assert.rejects(validateAndNormalizeUrl('https://user:pw@beispiel.example', { lookup: publicLookup }), /Zugangsdaten/);
  await assert.rejects(validateAndNormalizeUrl('ftp://beispiel.example', { lookup: publicLookup }));
});

test('öffentliche Ziele bleiben erlaubt (Domain, IPv4-Literal, IPv6-Literal, ohne Schema)', async () => {
  assert.equal((await validateAndNormalizeUrl('beispiel.example', { lookup: publicLookup })).hostname, 'beispiel.example');
  assert.equal((await validateAndNormalizeUrl('https://www.beispiel.example/pfad?x=1', { lookup: publicLookup })).pathname, '/pfad');
  assert.ok(await validateAndNormalizeUrl('http://8.8.8.8/', { lookup: publicLookup }));
  assert.ok(await validateAndNormalizeUrl('http://[2606:4700:4700::1111]/', { lookup: publicLookup }));
});

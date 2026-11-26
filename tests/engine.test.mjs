// Engine-, Summary- und Navigationstests mit Browser-Stub (kein Netzwerk, kein Chromium).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScan } from '../src/scanEngine.js';
import { buildPublicSummary } from '../src/publicSummary.js';
import { assertUsableResponse } from '../src/checks/navigation.js';

function stubBrowser(gotoImpl) {
  const page = {
    on() {},
    goto: gotoImpl,
    url: () => 'https://beispiel.example/',
    async waitForTimeout() {},
  };
  const context = { newPage: async () => page, close: async () => {} };
  return { newContext: async () => context, close: async () => {} };
}

const incompleteSecurity = async () => ({
  errors: ['TLS-Check-Fehler: ENOTFOUND'], completed: false, httpsEnforced: null, httpsEnforcedBasis: null,
  certificate: { valid: null, error: 'getaddrinfo ENOTFOUND' }, presentHeaders: [], missingHeaders: [],
});

const url = new URL('https://beispiel.example/');

test('Navigationsfehler: kein Bereich ist green, Gesamtstatus unknown, Abdeckung 0', async () => {
  const report = await runScan(url, {
    launch: async () => stubBrowser(async () => { throw new Error('net::ERR_NAME_NOT_RESOLVED'); }),
    securityCheck: incompleteSecurity,
  });
  for (const [key, cat] of Object.entries(report.categories)) {
    assert.equal(cat.status, 'unknown', `${key} darf nicht ${cat.status} sein`);
  }
  assert.equal(report.overallStatus, 'unknown');
  assert.equal(report.incomplete, true);
  assert.equal(report.coverage.completed, 0);
  assert.ok(report.categories.shopCompliance, 'Shop-Bereich erscheint als "nicht geprüft"');
});

test('Q6: HTTP 403 (Bot-Schutz) wird wie ein Fehler behandelt, nicht als Seite ausgewertet', async () => {
  const report = await runScan(url, {
    launch: async () => stubBrowser(async () => ({ status: () => 403 })),
    securityCheck: incompleteSecurity,
  });
  assert.equal(report.categories.legalTexts.status, 'unknown');
  assert.notEqual(report.categories.legalTexts.status, 'red');
  assert.ok(report.errors.some((e) => /HTTP 403/.test(e)));
});

test('Teilweise geprüft: Security vollständig, Browser-Bereiche unknown → Abdeckung 1 von 6', async () => {
  const report = await runScan(url, {
    launch: async () => stubBrowser(async () => { throw new Error('Timeout'); }),
    securityCheck: async () => ({
      errors: [], completed: true, httpsEnforced: true, httpsEnforcedBasis: 'redirect',
      certificate: { valid: true, daysRemaining: 90 },
      presentHeaders: ['strict-transport-security', 'content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy'],
      missingHeaders: [],
    }),
  });
  assert.equal(report.categories.security.status, 'green');
  assert.deepEqual(report.coverage, { total: 6, completed: 1, unknown: 5 });
  assert.equal(report.overallStatus, 'unknown');
});

test('Kunden-Zusammenfassung: unknown liefert issueCount null (nie 0) und kennzeichnet unvollständig', async () => {
  const report = await runScan(url, {
    launch: async () => stubBrowser(async () => { throw new Error('Timeout'); }),
    securityCheck: incompleteSecurity,
  });
  const summary = buildPublicSummary(report);
  assert.equal(summary.incomplete, true);
  for (const cat of Object.values(summary.categories)) {
    assert.equal(cat.status, 'unknown');
    assert.equal(cat.issueCount, null);
  }
});

test('assertUsableResponse: HTTP >= 400 wirft, 2xx/3xx und fehlende Antwort nicht', () => {
  assert.throws(() => assertUsableResponse({ status: () => 403 }), /HTTP 403/);
  assert.throws(() => assertUsableResponse({ status: () => 500 }), /HTTP 500/);
  assert.doesNotThrow(() => assertUsableResponse({ status: () => 200 }));
  assert.doesNotThrow(() => assertUsableResponse({ status: () => 304 }));
  assert.doesNotThrow(() => assertUsableResponse(null));
});

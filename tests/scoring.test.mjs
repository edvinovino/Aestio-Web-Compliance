// Tests für scoring.js: Fehler und Timeouts dürfen nie green sein (Schritt A, P0-Plan).
// Fälle stammen aus den Skill-Evals: Q4, Q6, Q11 (aestio-scanner-quality), A6 (accessibility), P6 (privacy).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreTrackers,
  scoreAccessibility,
  scoreLegalTexts,
  scoreSecurity,
  scoreAiTransparency,
  scoreShopCompliance,
  buildOverallStatus,
  buildCoverage,
} from '../src/scoring.js';

const ERR = ['Seitenaufruf fehlgeschlagen: Timeout'];

test('Q4/A6: Accessibility bei Timeout ist unknown, nie green', () => {
  const r = scoreAccessibility({ completed: false, errors: ERR, violationsByImpact: {}, violations: [] });
  assert.equal(r.status, 'unknown');
  assert.match(r.summary, /Nicht vollständig geprüft/);
});

test('Q4: Cookies/Tracker bei Crawl-Fehler ist unknown', () => {
  const r = scoreTrackers({
    completed: false, rejectTest: 'not_run', errors: ['Crawl-Fehler: Timeout'], preConsentExternalDomains: [],
    cookieBannerFound: false, cookieBannerRejectWorked: null, newExternalRequestsAfterReject: [],
  });
  assert.equal(r.status, 'unknown');
});

test('Q6: Rechtstexte bei blockiertem Zugriff sind unknown, nicht red ("Impressum fehlt")', () => {
  const r = scoreLegalTexts({ completed: false, errors: ['Seite lieferte HTTP 403'], impressumFound: false, datenschutzFound: false });
  assert.equal(r.status, 'unknown');
});

test('KI-Transparenz und Shop bei Fehler sind unknown', () => {
  assert.equal(scoreAiTransparency({ completed: false, errors: ERR, chatbotDetected: false }).status, 'unknown');
  const shop = scoreShopCompliance({ completed: false, errors: ERR, shopDetected: false });
  assert.equal(shop.status, 'unknown');
  assert.match(shop.summary, /Shop-Erkennung nicht durchgeführt/);
});

test('P6: Klick auf Ablehnen scheitert → Trackers unknown (Wirkung nicht geprüft)', () => {
  const r = scoreTrackers({
    completed: true, rejectTest: 'check_failed', errors: ['Klick auf Ablehnen-Steuerelement fehlgeschlagen'],
    preConsentExternalDomains: [], cookieBannerFound: true, cookieBannerRejectWorked: null, newExternalRequestsAfterReject: [],
  });
  assert.equal(r.status, 'unknown');
  assert.match(r.summary, /Wirkung des Ablehnens wurde nicht geprüft/);
});

test('Security: TLS-Verbindungsfehler ist unknown und nicht "Zertifikat ungültig"', () => {
  const r = scoreSecurity({
    completed: false, errors: ['TLS'], httpsEnforced: null, certificate: { valid: null, error: 'connect ECONNREFUSED' },
    presentHeaders: [], missingHeaders: [],
  });
  assert.equal(r.status, 'unknown');
  assert.doesNotMatch(r.summary, /ungültig/);
});

test('Konkreter Befund schlägt unvollständige Prüfung: Security red trotz fehlgeschlagenem Header-Abruf', () => {
  const r = scoreSecurity({
    completed: false, errors: ['Header-Check-Fehler'], httpsEnforced: false, httpsEnforcedBasis: 'content',
    certificate: { valid: true, daysRemaining: 90 }, presentHeaders: [], missingHeaders: [],
  });
  assert.equal(r.status, 'red');
});

test('Security: abgelaufenes/ungültiges Zertifikat bleibt red', () => {
  const r = scoreSecurity({
    completed: true, errors: [], httpsEnforced: true, certificate: { valid: false, reason: 'certificate has expired' },
    presentHeaders: [], missingHeaders: [],
  });
  assert.equal(r.status, 'red');
});

test('Security: HTTP-Port nicht erreichbar wird nicht als beobachtete Weiterleitung ausgegeben', () => {
  const r = scoreSecurity({
    completed: true, errors: ['HTTP-Redirect-Check: timeout'], httpsEnforced: true, httpsEnforcedBasis: 'unreachable',
    certificate: { valid: true, daysRemaining: 90 },
    presentHeaders: ['strict-transport-security', 'x-content-type-options', 'referrer-policy', 'x-frame-options'],
    missingHeaders: ['content-security-policy', 'permissions-policy'],
  });
  assert.equal(r.status, 'green');
  assert.match(r.summary, /Weiterleitung nicht beobachtet/);
});

test('Q11: Gesamtstatus ist nicht green, wenn ein Bereich nicht geprüft werden konnte', () => {
  const security = scoreSecurity({ completed: false, errors: ['x'], httpsEnforced: null, certificate: null, presentHeaders: [], missingHeaders: [] });
  const scores = [{ status: 'green' }, { status: 'green' }, security];
  assert.equal(buildOverallStatus(scores), 'unknown');
  assert.deepEqual(buildCoverage(scores), { total: 3, completed: 2, unknown: 1 });
});

test('Gesamtstatus: red schlägt unknown, unknown schlägt yellow und green', () => {
  assert.equal(buildOverallStatus([{ status: 'red' }, { status: 'unknown' }]), 'red');
  assert.equal(buildOverallStatus([{ status: 'yellow' }, { status: 'unknown' }]), 'unknown');
  assert.equal(buildOverallStatus([{ status: 'green' }, { status: 'yellow' }]), 'yellow');
  assert.equal(buildOverallStatus([{ status: 'green' }, { status: 'green' }]), 'green');
});

test('Altformat ohne completed-Flag wird wie bisher bewertet (Rückwärtskompatibilität)', () => {
  assert.equal(scoreAccessibility({ violationsByImpact: { critical: 1 } }).status, 'red');
  assert.equal(scoreAccessibility({ violationsByImpact: { serious: 2 } }).status, 'yellow');
  assert.equal(scoreAccessibility({ violationsByImpact: {} }).status, 'green');
  assert.equal(scoreLegalTexts({ impressumFound: true, datenschutzFound: true }).status, 'green');
  assert.equal(scoreSecurity({ httpsEnforced: false }).status, 'red');
  assert.equal(
    scoreAiTransparency({ chatbotDetected: false, chatbotDomains: [], disclosureFound: false }).status,
    'green'
  );
});

// Charakterisierungs- und Zieltests für scoring.js.
// Fälle stammen aus den Skill-Evals: Q4, Q6, Q11 (aestio-scanner-quality), A6 (accessibility), P6 (privacy).
// Die mit `todo` markierten Tests beschreiben das Zielverhalten aus Schritt A (P0-Plan: Fehler ≠ grün).
// Sie schlagen heute fehl (belegtes P0-Problem), zählen aber nicht als Testfehler, bis Schritt A umgesetzt ist.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreTrackers,
  scoreAccessibility,
  scoreLegalTexts,
  scoreSecurity,
  scoreAiTransparency,
  buildOverallStatus,
} from '../src/scoring.js';

const ERR = ['Seitenaufruf fehlgeschlagen: Timeout'];

// ---- Charakterisierung des heutigen Verhaltens (soll sich mit Schritt A bewusst ändern) ----
test('IST: Accessibility mit Seitenaufruf-Fehler liefert heute green (bekanntes P0-Problem)', () => {
  const r = scoreAccessibility({ errors: ERR, violationsByImpact: {}, violations: [] });
  assert.equal(r.status, 'green');
});

test('IST: Rechtstexte bei Fehler liefern heute red', () => {
  const r = scoreLegalTexts({ errors: ERR, impressumFound: false, datenschutzFound: false });
  assert.equal(r.status, 'red');
});

test('Normalfälle bleiben unverändert', () => {
  assert.equal(scoreAccessibility({ violationsByImpact: { critical: 1 } }).status, 'red');
  assert.equal(scoreAccessibility({ violationsByImpact: { serious: 2 } }).status, 'yellow');
  assert.equal(scoreAccessibility({ violationsByImpact: {} }).status, 'green');
  assert.equal(scoreLegalTexts({ impressumFound: true, datenschutzFound: true }).status, 'green');
  assert.equal(scoreSecurity({ httpsEnforced: false }).status, 'red');
  assert.equal(buildOverallStatus([{ status: 'green' }, { status: 'yellow' }]), 'yellow');
  assert.equal(buildOverallStatus([{ status: 'green' }, { status: 'red' }]), 'red');
  assert.equal(
    scoreAiTransparency({ chatbotDetected: false, chatbotDomains: [], disclosureFound: false }).status,
    'green'
  );
});

// ---- Zielverhalten Schritt A ----
const TODO_A = 'Schritt A (P0-Plan): Fehler und Timeouts dürfen nie green sein';

test('ZIEL Q4/A6: Accessibility bei Timeout ist nicht green', { todo: TODO_A }, () => {
  const r = scoreAccessibility({ errors: ERR, violationsByImpact: {}, violations: [] });
  assert.notEqual(r.status, 'green');
});

test('ZIEL Q4: Cookies/Tracker bei Crawl-Fehler ist nicht green', { todo: TODO_A }, () => {
  const r = scoreTrackers({
    errors: ['Crawl-Fehler: Timeout'], preConsentExternalDomains: [], cookieBannerFound: false,
    cookieBannerRejectWorked: null, newExternalRequestsAfterReject: [],
  });
  assert.notEqual(r.status, 'green');
});

test('ZIEL Q6: Rechtstexte bei blockiertem Zugriff sind nicht red ("Impressum fehlt")', { todo: TODO_A }, () => {
  const r = scoreLegalTexts({ errors: ERR, impressumFound: false, datenschutzFound: false });
  assert.notEqual(r.status, 'red');
});

test('ZIEL Q11: Gesamtstatus ist nicht green, wenn ein Bereich nicht geprüft werden konnte', { todo: TODO_A }, () => {
  const security = scoreSecurity({ errors: ['x'], httpsEnforced: null, certificate: null, presentHeaders: [], missingHeaders: [] });
  assert.notEqual(buildOverallStatus([{ status: 'green' }, { status: 'green' }, security]), 'green');
});

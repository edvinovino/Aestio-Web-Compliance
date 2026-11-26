// Schritt C (P0-Plan): Befundtexte beschreiben Beobachtungen, keine Rechtsurteile.
// Siehe .claude/skills/aestio-scanner-quality/references/report-wording.md
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  scoreTrackers,
  scoreSecurity,
  scoreAiTransparency,
  scoreShopCompliance,
} from '../src/scoring.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORBIDDEN = /verstö(ß|ss)t|rechtswidrig|rechtssicher|illegal|abmahnsicher|Pflicht seit|verlangt eine|erfahrungsgemäß nur ca\.|30[–-]40/i;

const cases = {
  'Trackers: externe Domains ohne Ablehnen-Element': scoreTrackers({
    errors: [], preConsentExternalDomains: ['a.example', 'b.example'], cookieBannerFound: false,
    cookieBannerRejectWorked: null, newExternalRequestsAfterReject: [],
  }),
  'Security: grün': scoreSecurity({
    errors: [], httpsEnforced: true, certificate: { valid: true, daysRemaining: 90 },
    presentHeaders: ['strict-transport-security', 'x-content-type-options', 'referrer-policy', 'x-frame-options'],
    missingHeaders: ['content-security-policy', 'permissions-policy'],
  }),
  'KI-Hinweis nur im Footer': scoreAiTransparency({
    errors: [], chatbotDetected: true, chatbotDomains: ['x'], disclosureFound: true, disclosureOnlyInFooter: true,
  }),
  'Shop: Button fehlt': scoreShopCompliance({
    errors: [], shopDetected: true, widerrufsbelehrungFound: true, widerrufsButtonFound: false,
  }),
};

for (const [name, result] of Object.entries(cases)) {
  test(`Befundtext ohne Rechtsurteil: ${name}`, () => {
    assert.doesNotMatch(result.summary, FORBIDDEN);
  });
}

test('Trackers: "kein Banner" wird nicht behauptet, wenn nur das Ablehnen-Element fehlt', () => {
  assert.doesNotMatch(cases['Trackers: externe Domains ohne Ablehnen-Element'].summary, /kein Cookie-Banner/i);
  assert.match(cases['Trackers: externe Domains ohne Ablehnen-Element'].summary, /Ablehnen-Element wurde nicht gefunden/);
});

test('Security: Zähler statt Pauschalaussage', () => {
  const { summary } = cases['Security: grün'];
  assert.match(summary, /4 von 6 geprüften Sicherheits-Headern gesetzt/);
  assert.doesNotMatch(summary, /größtenteils|erzwungen/);
});

test('Security: nicht ermittelte Weiterleitung wird nicht als beobachtet ausgegeben', () => {
  const { summary } = scoreSecurity({
    errors: [], httpsEnforced: null, certificate: null, presentHeaders: [], missingHeaders: [],
  });
  assert.match(summary, /nicht ermittelt/);
  assert.doesNotMatch(summary, /Sicherheits-Headern/);
});

test('Shop: Rechtsbezug ist informativ und ohne Stichtagsbehauptung', () => {
  const { summary } = cases['Shop: Button fehlt'];
  assert.match(summary, /§ 356a BGB/);
  assert.match(summary, /informativ/);
});

test('Quelltexte (src/, report-render.js, README) enthalten keine verbotenen Formulierungen', () => {
  const files = [
    'src/scoring.js', 'src/checks/accessibility.js', 'src/checks/legalTexts.js', 'src/checks/shopCompliance.js',
    'public/report-render.js', 'README.md',
  ];
  const hits = [];
  for (const f of files) {
    readFileSync(path.join(root, f), 'utf8').split('\n').forEach((line, i) => {
      // Die README nennt die verbotenen Beispiele bewusst im "Rechtlichen Hinweis zur Nutzung".
      if (f === 'README.md' && /verstößt gegen DSGVO/.test(line)) return;
      if (FORBIDDEN.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(hits, []);
});

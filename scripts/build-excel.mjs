import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPublicSummary } from '../src/publicSummary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_PATH = path.join(__dirname, 'goeppingen-results.json');
const OUT_PATH = path.join(__dirname, '..', '..', 'Goeppingen-Compliance-Scan.xlsx');

const STATUS_LABEL = { green: 'Grün – unauffällig', yellow: 'Gelb – prüfen', red: 'Rot – kritisch', unbekannt: 'Nicht erreichbar' };
const STATUS_FILL = { green: 'FFDCEEDD', yellow: 'FFFCEFD0', red: 'FFF6D8D5', unbekannt: 'FFE5E5E5' };
const PRIORITY_FILL = { Hoch: 'FFF6D8D5', Mittel: 'FFFCEFD0', Niedrig: 'FFDCEEDD' };
const PRIORITY_RANK = { Hoch: 0, Mittel: 1, Niedrig: 2 };

function trackerDetails(details) {
  const parts = [`Cookie-Banner gefunden: ${details.cookieBannerFound ? 'Ja' : 'Nein'}`];
  if (details.preConsentExternalDomains.length) {
    parts.push(`Externe Domains vor Consent: ${details.preConsentExternalDomains.join(', ')}`);
  }
  if (details.newExternalRequestsAfterReject?.length) {
    parts.push(`Neue externe Anfragen nach Ablehnen: ${details.newExternalRequestsAfterReject.join(', ')}`);
  }
  return parts.join(' | ');
}

function accessibilityDetails(details) {
  if (!details.violations?.length) return 'Keine automatisiert erkannten Probleme.';
  return details.violations.map((v) => `${v.impactLabel || v.impact}: ${v.help} (${v.nodeCount}×)`).join(' | ');
}

function legalDetails(details) {
  return [
    `Impressum: ${details.impressumFound ? 'gefunden' : 'FEHLT'}`,
    `Datenschutz: ${details.datenschutzFound ? 'gefunden' : 'FEHLT'}`,
  ].join(' | ');
}

function securityDetails(details) {
  const parts = [`HTTPS erzwungen: ${details.httpsEnforced === null ? 'nicht ermittelbar' : details.httpsEnforced ? 'Ja' : 'Nein'}`];
  if (details.certificate) {
    parts.push(
      `TLS-Zertifikat: ${details.certificate.valid ? 'gültig' : 'ungültig'}${details.certificate.daysRemaining != null ? ` (läuft in ${details.certificate.daysRemaining} Tagen ab)` : ''}`
    );
  }
  if (details.missingHeaders?.length) {
    parts.push(`Fehlende Security-Header: ${details.missingHeaders.join(', ')}`);
  }
  return parts.join(' | ');
}

// Ordnet die BEFUNDART (nicht die einzelne Firma!) allgemein bekannten
// Risikokategorien zu - siehe Sheet "Rechtliche Einordnung" fuer Quellen.
// Dies ist eine technische Kategorisierung auf Basis oeffentlich bekannter
// Rechtsprechung/Statistik, KEINE rechtliche Bewertung des Einzelfalls.
function assessAcquisitionPriority(r) {
  if (r.scanFailed) {
    return { priority: 'Hoch', reasons: ['Website nicht erreichbar / technisch nicht funktionsfähig'] };
  }

  const legal = r.categories.legalTexts.details;
  const trackers = r.categories.trackers.details;

  const hoch = [];
  if (!legal.impressumFound) hoch.push('Kein Impressum auffindbar (§5 DDG, ex-§5 TMG)');
  if (trackers.preConsentExternalDomains.length > 0 && !trackers.cookieBannerFound) {
    hoch.push('Externe Dienste laden vor Consent, kein Cookie-Banner vorhanden (§25 TDDDG)');
  }
  if (trackers.newExternalRequestsAfterReject?.length > 0) {
    hoch.push('Cookie-Banner vorhanden, aber "Ablehnen" blockiert externe Dienste nicht (§25 TDDDG)');
  }
  if (hoch.length) return { priority: 'Hoch', reasons: hoch };

  const mittel = [];
  if (!legal.datenschutzFound) mittel.push('Keine Datenschutzerklärung auffindbar (Art. 13 DSGVO)');
  if (trackers.preConsentExternalDomains.length > 0) {
    mittel.push('Externe Dienste laden vor Consent (Banner vorhanden, Ablehnen-Funktion greift korrekt)');
  }
  if (mittel.length) return { priority: 'Mittel', reasons: mittel };

  return {
    priority: 'Niedrig',
    reasons: ['Nur Security-Header- und/oder Barrierefreiheits-Befunde (nach aktueller Rechtslage i.d.R. kein eigenständiger Abmahngrund)'],
  };
}

const raw = JSON.parse(await fs.readFile(RESULTS_PATH, 'utf-8'));

const rows = raw.map((r) => {
  const { priority, reasons } = assessAcquisitionPriority(r);

  if (r.scanFailed) {
    return {
      name: r.name,
      url: r.inputUrl,
      status: 'unbekannt',
      total: Number.POSITIVE_INFINITY,
      checkedAt: null,
      priority,
      priorityReasons: reasons.join(' | '),
      trackers: { count: 'n/a', details: `Scan fehlgeschlagen: ${r.error}` },
      accessibility: { count: 'n/a', details: '—' },
      legalTexts: { count: 'n/a', details: '—' },
      security: { count: 'n/a', details: '—' },
    };
  }

  const summary = buildPublicSummary(r);
  const total = Object.values(summary.categories).reduce((sum, c) => sum + c.issueCount, 0);

  return {
    name: r.name,
    url: r.url,
    status: summary.overallStatus,
    total,
    checkedAt: r.checkedAt,
    priority,
    priorityReasons: reasons.join(' | '),
    trackers: { count: summary.categories.trackers.issueCount, details: trackerDetails(r.categories.trackers.details) },
    accessibility: { count: summary.categories.accessibility.issueCount, details: accessibilityDetails(r.categories.accessibility.details) },
    legalTexts: { count: summary.categories.legalTexts.issueCount, details: legalDetails(r.categories.legalTexts.details) },
    security: { count: summary.categories.security.issueCount, details: securityDetails(r.categories.security.details) },
  };
});

// Sortierung: erst nach Akquise-Prioritaet (Hoch -> Mittel -> Niedrig), dann
// innerhalb der Prioritaet nach Gesamt-Befunden absteigend. Das entspricht
// direkter der Frage "wo lohnt sich eine Ansprache am ehesten", nicht nur der
// reinen Fehleranzahl.
rows.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.total - a.total);

const workbook = new ExcelJS.Workbook();
workbook.creator = 'Aestio Web Compliance Scanner';
workbook.created = new Date();

// ---------- Sheet 1: Firmen-Übersicht ----------
const sheet = workbook.addWorksheet('Göppingen Compliance-Scan');

sheet.columns = [
  { header: 'Rang', key: 'rank', width: 6 },
  { header: 'Firma', key: 'name', width: 32 },
  { header: 'Website', key: 'url', width: 36 },
  { header: 'Akquise-Priorität', key: 'priority', width: 16 },
  { header: 'Priorität – Begründung (allgemein, keine Rechtsberatung)', key: 'priorityReasons', width: 55 },
  { header: 'Gesamtstatus', key: 'status', width: 20 },
  { header: 'Gesamt Befunde', key: 'total', width: 14 },
  { header: 'Cookies & Tracking – Anzahl', key: 'trackersCount', width: 14 },
  { header: 'Cookies & Tracking – Details', key: 'trackersDetails', width: 50 },
  { header: 'Barrierefreiheit – Anzahl', key: 'a11yCount', width: 14 },
  { header: 'Barrierefreiheit – Details', key: 'a11yDetails', width: 65 },
  { header: 'Rechtstexte – Anzahl', key: 'legalCount', width: 12 },
  { header: 'Rechtstexte – Details', key: 'legalDetails', width: 32 },
  { header: 'Security – Anzahl', key: 'secCount', width: 12 },
  { header: 'Security – Details', key: 'secDetails', width: 45 },
  { header: 'Zuletzt geprüft', key: 'checkedAt', width: 20 },
];

const headerRow = sheet.getRow(1);
headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF121B2E' } };
headerRow.alignment = { vertical: 'middle', wrapText: true };
sheet.views = [{ state: 'frozen', ySplit: 1 }];

const wrapCols = ['priorityReasons', 'trackersDetails', 'a11yDetails', 'legalDetails', 'secDetails'];

rows.forEach((r, i) => {
  const row = sheet.addRow({
    rank: i + 1,
    name: r.name,
    url: r.url,
    priority: r.priority,
    priorityReasons: r.priorityReasons,
    status: STATUS_LABEL[r.status] || r.status,
    total: Number.isFinite(r.total) ? r.total : 'n/a',
    trackersCount: r.trackers.count,
    trackersDetails: r.trackers.details,
    a11yCount: r.accessibility.count,
    a11yDetails: r.accessibility.details,
    legalCount: r.legalTexts.count,
    legalDetails: r.legalTexts.details,
    secCount: r.security.count,
    secDetails: r.security.details,
    checkedAt: r.checkedAt ? new Date(r.checkedAt).toLocaleString('de-DE') : '—',
  });

  row.getCell('priority').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PRIORITY_FILL[r.priority] } };
  row.getCell('priority').font = { bold: true };
  row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATUS_FILL[r.status] || STATUS_FILL.unbekannt } };
  wrapCols.forEach((key) => {
    row.getCell(key).alignment = { vertical: 'top', wrapText: true };
  });
});

sheet.autoFilter = { from: 'A1', to: 'P1' };

// ---------- Sheet 2: Rechtliche Einordnung (allgemein) ----------
const legalSheet = workbook.addWorksheet('Rechtliche Einordnung');

legalSheet.columns = [
  { header: 'Befundart', key: 'befund', width: 34 },
  { header: 'Rechtsgrundlage', key: 'grundlage', width: 28 },
  { header: 'Abmahnrisiko (allgemein)', key: 'risiko', width: 20 },
  { header: 'Begründung / Quellen', key: 'quelle', width: 70 },
  { header: 'Wer kann vorgehen', key: 'wer', width: 40 },
];

const legalHeader = legalSheet.getRow(1);
legalHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
legalHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF121B2E' } };
legalHeader.alignment = { vertical: 'middle', wrapText: true };
legalSheet.views = [{ state: 'frozen', ySplit: 1 }];

const legalRows = [
  {
    befund: 'Fehlendes/unvollständiges Impressum',
    grundlage: '§5 DDG (Digitale-Dienste-Gesetz, ex-§5 TMG)',
    risiko: 'Hoch',
    quelle:
      'Einer der historisch häufigsten Abmahngründe im deutschen Online-Recht überhaupt; ständige Rechtsprechung seit BGH, Urt. v. 20.07.2006 - I ZR 228/03 (Anbieterkennzeichnung als Marktverhaltensregel). Wird seit Jahrzehnten routinemäßig von Wettbewerbsverbänden geprüft.',
    wer: 'Mitbewerber, Wettbewerbsverbände (z.B. Wettbewerbszentrale, IDO Verband), qualifizierte Einrichtungen',
  },
  {
    befund: 'Tracker/externe Dienste vor Consent, kein Cookie-Banner',
    grundlage: '§25 TDDDG (ex-TTDSG) i.V.m. DSGVO Art. 6/7',
    risiko: 'Hoch',
    quelle:
      'EuGH "Planet49", Urt. v. 01.10.2019 - C-673/17 (Opt-in-Pflicht für nicht-notwendige Cookies); BGH "Cookie-Einwilligung II", Urt. v. 28.05.2020 - I ZR 7/16. Große Abmahnwelle 2022 ausgelöst durch LG München I, Urt. v. 20.01.2022 - 3 O 17493/20 (externe Google Fonts, 100€ Schadensersatz zugesprochen). Hinweis: Gerichte haben serienmäßige Massenabmahnungen einzelner Akteure z.T. als rechtsmissbräuchlich eingestuft (§8c UWG) - das Grundrisiko ist real, die tatsächliche Abmahnpraxis schwankt aber je nach Akteur.',
    wer: 'Betroffene Nutzer (Schadensersatz), Mitbewerber, z.T. Verbraucherschutzverbände',
  },
  {
    befund: 'Cookie-Banner vorhanden, "Ablehnen" wirkt nicht',
    grundlage: '§25 TDDDG i.V.m. DSGVO Art. 6/7',
    risiko: 'Hoch',
    quelle:
      'Rechtlich wie "kein wirksamer Consent eingeholt" zu behandeln - z.T. sogar gravierender bewertet als gar kein Banner, da ein funktionsloser Banner den Anschein von Compliance erweckt (venire contra factum proprium-Argumentation in einzelnen Entscheidungen zu Dark Patterns).',
    wer: 'wie oben',
  },
  {
    befund: 'Fehlende Datenschutzerklärung',
    grundlage: 'Art. 13 DSGVO',
    risiko: 'Mittel',
    quelle:
      'Vollzug erfolgt primär durch die Landesdatenschutzbehörden (Bußgeldverfahren). Eine UWG-Klagebefugnis von Mitbewerbern bei DSGVO-Verstößen ist höchstrichterlich grundsätzlich anerkannt (BGH-Rechtsprechungslinie zu Datenschutz als Marktverhaltensregel), in der Praxis aber seltener alleiniger Abmahngrund als das fehlende Impressum.',
    wer: 'Landesdatenschutzbehörden, z.T. Mitbewerber',
  },
  {
    befund: 'Barrierefreiheit / WCAG-Verstöße',
    grundlage: 'BFSG (in Kraft seit 28.06.2025), Anlage 3',
    risiko: 'Mittel bis Gering (stark vom Geschäftsmodell abhängig)',
    quelle:
      'Das BFSG gilt verpflichtend nur für die in Anlage 3 gelisteten Dienstleistungen (u.a. E-Commerce/Online-Shops, Bankdienstleistungen, E-Books, Telekommunikationsdienste, Personenverkehr-Infodienste). Eine reine Informations-Website ohne Online-Verkauf/-Buchung fällt nach aktuellem Wortlaut i.d.R. NICHT in den verpflichtenden Anwendungsbereich. Durchsetzung erfolgt über die Marktüberwachungsbehörden der Länder, nicht primär über Wettbewerber-Abmahnungen. Da das Gesetz erst seit Mitte 2025 gilt, existiert noch kaum einschlägige Rechtsprechung.',
    wer: 'Marktüberwachungsbehörden der Länder; klassische Abmahnpraxis noch nicht etabliert',
  },
  {
    befund: 'Fehlende Security-Header (CSP, HSTS, X-Frame-Options etc.)',
    grundlage: 'Kein eigener Straftatbestand; ggf. Art. 32 DSGVO (TOM)',
    risiko: 'Gering',
    quelle:
      'Kein deutsches Gesetz schreibt konkrete HTTP-Security-Header vor. Relevanz ergibt sich allenfalls indirekt über Art. 32 DSGVO ("geeignete technische und organisatorische Maßnahmen") - typischerweise erst rückwirkend relevant, wenn tatsächlich ein Datenvorfall eintritt und die Angemessenheit der Maßnahmen geprüft wird. In der Praxis nahezu nie eigenständiger Abmahngrund.',
    wer: 'i.d.R. kein eigenständiger Klage-/Abmahngrund; Aufsichtsbehörden nur im Schadensfall',
  },
];

for (const lr of legalRows) {
  const row = legalSheet.addRow(lr);
  row.alignment = { vertical: 'top', wrapText: true };
  const fill = lr.risiko.startsWith('Hoch') ? 'FFF6D8D5' : lr.risiko.startsWith('Gering') ? 'FFDCEEDD' : 'FFFCEFD0';
  row.getCell('risiko').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  row.getCell('risiko').font = { bold: true };
}

legalSheet.addRow([]);
const disclaimerRow = legalSheet.addRow([
  'Wichtiger Hinweis (RDG): Diese Tabelle beschreibt allgemeine, öffentlich bekannte rechtliche Einordnungen von BEFUNDARTEN auf Basis von Gesetzestext, Rechtsprechung und Fachliteratur. Sie stellt keine rechtliche Bewertung eines Einzelfalls und keine Rechtsberatung im Sinne des Rechtsdienstleistungsgesetzes (RDG) dar. Ob im konkreten Einzelfall tatsächlich ein Rechtsverstoß vorliegt und abmahnfähig ist, hängt von zahlreichen Einzelumständen ab und kann verbindlich nur durch einen Rechtsanwalt beurteilt werden. Für die Akquise-Kommunikation empfiehlt sich eine Formulierung wie "technischer Befund X festgestellt" statt "Verstoß gegen DSGVO" - siehe bestehende Formulierungspraxis in den Scan-Reports.',
]);
disclaimerRow.getCell(1).alignment = { wrapText: true, vertical: 'top' };
disclaimerRow.getCell(1).font = { italic: true, color: { argb: 'FF5C6578' } };
legalSheet.mergeCells(`A${disclaimerRow.number}:E${disclaimerRow.number}`);
legalSheet.getRow(disclaimerRow.number).height = 90;

await workbook.xlsx.writeFile(OUT_PATH);
console.log(`Excel gespeichert: ${OUT_PATH}`);

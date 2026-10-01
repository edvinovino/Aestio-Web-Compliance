// Rendert den VOLLSTAENDIGEN technischen Bericht inkl. aller Details
// (Domains, Regel-Verstoesse, Header-Namen, URLs). Nur fuer den
// token-geschuetzten Admin-Bereich gedacht - siehe public/app.js fuer die
// gekuerzte Kunden-Ansicht.

const CATEGORY_META = {
  trackers: { name: 'Cookies & Tracking' },
  accessibility: { name: 'Barrierefreiheit' },
  legalTexts: { name: 'Rechtstexte' },
  security: { name: 'TLS & Security-Header' },
  aiTransparency: { name: 'KI-Transparenz' },
  shopCompliance: { name: 'Shop-Compliance' },
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function renderCategoryDetails(key, details) {
  switch (key) {
    case 'trackers':
      return `
        <dl>
          <dt>Cookie-Banner gefunden</dt><dd>${details.cookieBannerFound ? 'Ja' : 'Nein'}</dd>
          <dt>Externe Domains vor Consent</dt><dd>${details.preConsentExternalDomains.length}</dd>
          <dt>Neue externe Anfragen nach Ablehnen</dt><dd>${details.newExternalRequestsAfterReject?.length ?? '—'}</dd>
        </dl>
        ${details.preConsentExternalDomains.length ? `<ul>${details.preConsentExternalDomains.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>` : ''}
      `;
    case 'accessibility': {
      const v = details.violationsByImpact || {};
      return `
        <dl>
          <dt>Kritisch</dt><dd>${v.critical || 0}</dd>
          <dt>Schwerwiegend</dt><dd>${v.serious || 0}</dd>
          <dt>Moderat</dt><dd>${v.moderate || 0}</dd>
          <dt>Gering</dt><dd>${v.minor || 0}</dd>
        </dl>
        ${(details.violations || []).length ? `<ul>${details.violations.map((viol) => `<li><strong>${escapeHtml(viol.impactLabel || viol.impact)}</strong>: ${escapeHtml(viol.help)} (${viol.nodeCount}× betroffen) — <a href="${escapeHtml(viol.helpUrl)}" target="_blank" rel="noopener">Regel-Doku</a></li>`).join('')}</ul>` : ''}
        <div class="note">Automatisierte Scans decken erfahrungsgemäß nur ca. 30–40 % aller WCAG-Kriterien ab.</div>
      `;
    }
    case 'legalTexts':
      return `
        <dl>
          <dt>Impressum</dt><dd>${details.impressumFound ? `gefunden (${escapeHtml(details.impressumUrl)})` : 'nicht gefunden'}</dd>
          <dt>Datenschutzerklärung</dt><dd>${details.datenschutzFound ? `gefunden (${escapeHtml(details.datenschutzUrl)})` : 'nicht gefunden'}</dd>
        </dl>
      `;
    case 'security': {
      const cert = details.certificate;
      return `
        <dl>
          <dt>HTTPS erzwungen</dt><dd>${details.httpsEnforced === null ? 'nicht ermittelbar' : details.httpsEnforced ? 'Ja' : 'Nein'}</dd>
          ${cert ? `<dt>TLS-Zertifikat</dt><dd>${cert.valid ? 'gültig' : `ungültig (${escapeHtml(cert.reason || 'unbekannt')})`}${cert.daysRemaining != null ? ` · läuft in ${cert.daysRemaining} Tagen ab` : ''}${cert.issuer ? ` · Aussteller: ${escapeHtml(cert.issuer)}` : ''}</dd>` : ''}
          <dt>Security-Header gesetzt</dt><dd>${details.presentHeaders.length} / ${details.presentHeaders.length + details.missingHeaders.length}</dd>
        </dl>
        ${details.missingHeaders.length ? `<ul>${details.missingHeaders.map((h) => `<li>fehlt: ${escapeHtml(h)}</li>`).join('')}</ul>` : ''}
      `;
    }
    case 'aiTransparency':
      return `
        <dl>
          <dt>Chatbot-/Assistenten-Widget gefunden</dt><dd>${details.chatbotDetected ? 'Ja' : 'Nein'}</dd>
          <dt>KI-Hinweis im Seitentext gefunden</dt><dd>${details.disclosureFound ? 'Ja' : 'Nein'}</dd>
          <dt>Hinweis nur im Footer/Kleingedruckten</dt><dd>${details.disclosureOnlyInFooter ? 'Ja — nicht ausreichend prominent' : 'Nein'}</dd>
        </dl>
        ${details.chatbotDomains?.length ? `<ul>${details.chatbotDomains.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>` : ''}
        <div class="note">Erkennt nur bekannte Chatbot-Anbieter über Domains plus eine Text-Heuristik für die KI-Kennzeichnung (Art. 50 EU AI Act) und ob sie außerhalb von Footer/Impressum/AGB auffindbar ist — kein Nachweis über eingesetzte KI-Modelle oder KI-generierte Inhalte.</div>
      `;
    case 'shopCompliance':
      return `
        <dl>
          <dt>Widerrufsbelehrung verlinkt</dt><dd>${details.widerrufsbelehrungFound ? `gefunden (${escapeHtml(details.widerrufsbelehrungUrl)})` : 'nicht gefunden'}</dd>
          <dt>Echter Widerrufs-Button gefunden</dt><dd>${details.widerrufsButtonFound ? 'Ja' : 'Nein'}</dd>
          <dt>Grundpreis-Hinweis im Text erkannt</dt><dd>${details.grundpreisHinweisGefunden ? 'Ja' : 'Nein'}</dd>
        </dl>
        <div class="note">Shop/Checkout automatisiert erkannt. Prüft nur Vorhandensein einer Widerrufsbelehrung und eines eigenständigen Widerrufs-Buttons (Pflicht seit 19.6.2026) sowie einen groben Grundpreis-Texthinweis. Streichpreis-Korrektheit (30-Tage-Tiefstpreis) und exakte Grundpreis-Platzierung lassen sich aus einem einzelnen Seitenaufruf nicht verlässlich prüfen und sind hier nicht bewertet.</div>
      `;
    default:
      return '';
  }
}

export function renderReport(data) {
  const overallLabel = {
    green: 'Keine kritischen technischen Befunde',
    yellow: 'Einzelne Punkte sollten geprüft werden',
    red: 'Kritische technische Befunde festgestellt',
  }[data.overallStatus];

  let html = `
    <div class="report">
      <div class="overall-banner">
        <div class="dot ${data.overallStatus}"></div>
        <div>
          <div class="title">${overallLabel}</div>
          <div class="sub">Geprüft: ${escapeHtml(data.url)} · ${new Date(data.checkedAt).toLocaleString('de-DE')}</div>
        </div>
      </div>
  `;

  for (const [key, meta] of Object.entries(CATEGORY_META)) {
    const cat = data.categories[key];
    if (!cat) continue;
    html += `
      <details class="category">
        <summary>
          <div class="dot ${cat.status}"></div>
          <span class="cat-name">${meta.name}</span>
          <span class="cat-summary">${escapeHtml(cat.summary)}</span>
          <span class="chevron">▸</span>
        </summary>
        <div class="cat-body">${renderCategoryDetails(key, cat.details)}</div>
      </details>
    `;
  }

  if (data.errors?.length) {
    html += `<div class="note" style="margin-top:16px;">Hinweise beim Scan: ${data.errors.map(escapeHtml).join(' · ')}</div>`;
  }

  html += `</div>`;
  return html;
}

export { escapeHtml, CATEGORY_META };

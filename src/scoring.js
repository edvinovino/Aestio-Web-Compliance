// Bewertungsregeln. Grundsatz (siehe .claude/skills/aestio-scanner-quality): Eine Prüfung, die
// nicht vollständig durchgeführt werden konnte (Timeout, HTTP-Fehler, Exception), ergibt
// niemals green. Sie ergibt 'unknown' ("nicht vollständig geprüft"). Konkrete Befunde (red)
// bleiben dennoch sichtbar, auch wenn andere Teilprüfungen fehlgeschlagen sind.
//
// `completed === false` markiert eine unvollständige Prüfung. `undefined` (Altformat oder
// Testdaten ohne Flag) wird wie bisher bewertet.

function unknown(reason) {
  return { status: 'unknown', summary: `Nicht vollständig geprüft: ${reason}` };
}

function isIncomplete(details) {
  return details?.completed === false;
}

function reasonOf(details, fallback = 'Prüfung nicht abgeschlossen.') {
  return details?.errors?.[0] || fallback;
}

export function scoreTrackers(cc) {
  if (isIncomplete(cc)) return unknown(reasonOf(cc));
  if (cc.newExternalRequestsAfterReject?.length > 0) {
    return {
      status: 'red',
      summary: `${cc.newExternalRequestsAfterReject.length} externe Anfrage(n) feuern trotz Ablehnen-Klick weiter.`,
    };
  }
  if (cc.preConsentExternalDomains.length > 0 && !cc.cookieBannerFound) {
    return {
      status: 'red',
      summary: `Vor einer Consent-Entscheidung wurden Verbindungen zu ${cc.preConsentExternalDomains.length} externen Domain(s) beobachtet. Ein Ablehnen-Element wurde nicht gefunden.`,
    };
  }
  if (cc.cookieBannerFound && cc.rejectTest === 'check_failed') {
    return unknown('Der Klick auf das Ablehnen-Element ist fehlgeschlagen; die Wirkung des Ablehnens wurde nicht geprüft.');
  }
  if (cc.preConsentExternalDomains.length > 0) {
    return {
      status: 'yellow',
      summary: `${cc.preConsentExternalDomains.length} externe Domain(s) laden vor der Consent-Entscheidung. Banner vorhanden und Ablehnen-Funktion blockiert weitere externe Anfragen korrekt.`,
    };
  }
  if (!cc.cookieBannerFound) {
    return { status: 'green', summary: 'Keine externen Anfragen vor einer Consent-Entscheidung festgestellt.' };
  }
  return {
    status: 'green',
    summary: 'Cookie-Banner gefunden, keine externen Anfragen vor Consent-Entscheidung, Ablehnen-Funktion greift.',
  };
}

export function scoreAccessibility(axe) {
  if (isIncomplete(axe)) return unknown(reasonOf(axe));
  const { critical = 0, serious = 0, moderate = 0 } = axe.violationsByImpact || {};
  if (critical > 0) {
    return { status: 'red', summary: `${critical} kritische(s) automatisiert erkannte Barrierefreiheits-Problem(e).` };
  }
  if (serious > 0) {
    return { status: 'yellow', summary: `${serious} schwerwiegende(s) automatisiert erkannte Barrierefreiheits-Problem(e).` };
  }
  if (moderate > 0) {
    return { status: 'yellow', summary: `${moderate} mittlere automatisiert erkannte Barrierefreiheits-Problem(e).` };
  }
  return { status: 'green', summary: 'Keine automatisiert erkennbaren Barrierefreiheits-Probleme gefunden.' };
}

export function scoreLegalTexts(legal) {
  if (isIncomplete(legal)) return unknown(reasonOf(legal));
  if (!legal.impressumFound) {
    return { status: 'red', summary: 'Kein Impressum-Link auffindbar.' };
  }
  if (!legal.datenschutzFound) {
    return { status: 'yellow', summary: 'Impressum gefunden, aber kein Datenschutzerklärung-Link auffindbar.' };
  }
  return { status: 'green', summary: 'Impressum und Datenschutzerklärung sind verlinkt auffindbar.' };
}

export function scoreSecurity(security) {
  // Konkrete Befunde zuerst: sie bleiben auch bei fehlgeschlagenen Teilprüfungen gültig.
  if (security.httpsEnforced === false) {
    return { status: 'red', summary: 'HTTP wird nicht automatisch auf HTTPS umgeleitet.' };
  }
  if (security.certificate && security.certificate.valid === false) {
    return { status: 'red', summary: `TLS-Zertifikat ungültig: ${security.certificate.reason || 'abgelaufen/nicht vertrauenswürdig'}.` };
  }
  if (isIncomplete(security)) return unknown(security.certificate?.error || reasonOf(security));
  if (security.certificate && typeof security.certificate.daysRemaining === 'number' && security.certificate.daysRemaining < 14) {
    return { status: 'yellow', summary: `TLS-Zertifikat läuft in ${security.certificate.daysRemaining} Tag(en) ab.` };
  }
  if (security.missingHeaders?.length >= 4) {
    return { status: 'yellow', summary: `${security.missingHeaders.length} von ${security.missingHeaders.length + security.presentHeaders.length} sicherheitsrelevanten HTTP-Headern fehlen.` };
  }
  return { status: 'green', summary: describeSecurity(security) };
}

// Nur Beobachtungen mit Zaehlern, keine Pauschalaussage ("erzwungen", "größtenteils").
function describeSecurity(security) {
  const present = security.presentHeaders?.length ?? 0;
  const total = present + (security.missingHeaders?.length ?? 0);
  let https = 'HTTPS-Weiterleitung nicht ermittelt';
  if (security.httpsEnforced === true) {
    https = security.httpsEnforcedBasis === 'unreachable'
      ? 'HTTP-Port nicht erreichbar (Weiterleitung nicht beobachtet)'
      : 'HTTPS-Weiterleitung beobachtet';
  }
  const parts = [https];
  if (security.certificate?.valid === true) parts.push('gültiges Zertifikat beobachtet');
  if (total > 0) parts.push(`${present} von ${total} geprüften Sicherheits-Headern gesetzt`);
  return `${parts.join('; ')}.`;
}

export function scoreAiTransparency(ai) {
  if (isIncomplete(ai)) return unknown(reasonOf(ai));
  if (ai.chatbotDetected && !ai.disclosureFound) {
    return {
      status: 'yellow',
      summary: 'Chatbot-/Assistenten-Widget gefunden, aber kein sichtbarer KI-Hinweis im Seitentext gefunden.',
    };
  }
  if (ai.chatbotDetected && ai.disclosureOnlyInFooter) {
    return {
      status: 'yellow',
      summary: 'Ein KI-Hinweis wurde nur in Footer-, Impressum- oder AGB-Bereichen gefunden, nicht im übrigen sichtbaren Text. Manuelle Prüfung empfohlen.',
    };
  }
  if (ai.chatbotDetected) {
    return { status: 'green', summary: 'Chatbot-Widget gefunden, KI-Hinweis im Seitentext vorhanden.' };
  }
  return { status: 'green', summary: 'Kein bekanntes Chatbot-/KI-Assistenten-Widget erkannt.' };
}

export function scoreShopCompliance(shop) {
  if (isIncomplete(shop)) return unknown(`Shop-Erkennung nicht durchgeführt: ${reasonOf(shop)}`);
  if (!shop.widerrufsbelehrungFound) {
    return { status: 'red', summary: 'Shop/Checkout erkannt, aber keine Widerrufsbelehrung auffindbar.' };
  }
  if (!shop.widerrufsButtonFound) {
    return {
      status: 'yellow',
      summary: 'Widerrufsbelehrung verlinkt; ein Element mit Beschriftung wie „Vertrag widerrufen“ wurde per Textmuster nicht gefunden. Rechtsbezug (informativ): § 356a BGB.',
    };
  }
  return { status: 'green', summary: 'Widerrufsbelehrung und ein klar beschrifteter Widerrufs-Button sind auffindbar.' };
}

/**
 * Gesamtstatus: ein konkreter Befund (red) schlaegt "unvollstaendig"; sonst gilt
 * unknown vor yellow vor green. Nicht geprüfte Bereiche verbessern das Ergebnis nie.
 */
export function buildOverallStatus(categoryScores) {
  const statuses = categoryScores.map((c) => c.status);
  if (statuses.includes('red')) return 'red';
  if (statuses.includes('unknown')) return 'unknown';
  if (statuses.includes('yellow')) return 'yellow';
  return 'green';
}

/** Prüfumfang: wie viele Bereiche konnten vollständig geprüft werden. */
export function buildCoverage(categoryScores) {
  const total = categoryScores.length;
  const unknownCount = categoryScores.filter((c) => c.status === 'unknown').length;
  return { total, completed: total - unknownCount, unknown: unknownCount };
}

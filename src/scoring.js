const STATUS_RANK = { green: 0, yellow: 1, red: 2 };

function worstStatus(statuses) {
  return statuses.reduce((worst, s) => (STATUS_RANK[s] > STATUS_RANK[worst] ? s : worst), 'green');
}

export function scoreTrackers(cc) {
  if (cc.newExternalRequestsAfterReject?.length > 0) {
    return {
      status: 'red',
      summary: `${cc.newExternalRequestsAfterReject.length} externe Anfrage(n) feuern trotz Ablehnen-Klick weiter.`,
    };
  }
  if (cc.preConsentExternalDomains.length > 0 && !cc.cookieBannerFound) {
    return {
      status: 'red',
      summary: `${cc.preConsentExternalDomains.length} externe Domain(s) laden vor jeglicher Consent-Entscheidung, kein Cookie-Banner gefunden.`,
    };
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
  if (!legal.impressumFound) {
    return { status: 'red', summary: 'Kein Impressum-Link auffindbar.' };
  }
  if (!legal.datenschutzFound) {
    return { status: 'yellow', summary: 'Impressum gefunden, aber kein Datenschutzerklärung-Link auffindbar.' };
  }
  return { status: 'green', summary: 'Impressum und Datenschutzerklärung sind verlinkt auffindbar.' };
}

export function scoreSecurity(security) {
  if (security.httpsEnforced === false) {
    return { status: 'red', summary: 'HTTP wird nicht automatisch auf HTTPS umgeleitet.' };
  }
  if (security.certificate && security.certificate.valid === false) {
    return { status: 'red', summary: `TLS-Zertifikat ungültig: ${security.certificate.reason || 'abgelaufen/nicht vertrauenswürdig'}.` };
  }
  if (security.certificate && typeof security.certificate.daysRemaining === 'number' && security.certificate.daysRemaining < 14) {
    return { status: 'yellow', summary: `TLS-Zertifikat läuft in ${security.certificate.daysRemaining} Tag(en) ab.` };
  }
  if (security.missingHeaders?.length >= 4) {
    return { status: 'yellow', summary: `${security.missingHeaders.length} von ${security.missingHeaders.length + security.presentHeaders.length} sicherheitsrelevanten HTTP-Headern fehlen.` };
  }
  return { status: 'green', summary: 'HTTPS wird erzwungen, Zertifikat gültig, sicherheitsrelevante Header größtenteils gesetzt.' };
}

export function scoreAiTransparency(ai) {
  if (ai.chatbotDetected && !ai.disclosureFound) {
    return {
      status: 'yellow',
      summary: 'Chatbot-/Assistenten-Widget gefunden, aber kein sichtbarer KI-Hinweis im Seitentext gefunden.',
    };
  }
  if (ai.chatbotDetected) {
    return { status: 'green', summary: 'Chatbot-Widget gefunden, KI-Hinweis im Seitentext vorhanden.' };
  }
  return { status: 'green', summary: 'Kein bekanntes Chatbot-/KI-Assistenten-Widget erkannt.' };
}

export function buildOverallStatus(categoryScores) {
  return worstStatus(categoryScores.map((c) => c.status));
}

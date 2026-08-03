function countTrackerIssues(details) {
  return details.preConsentExternalDomains.length + (details.newExternalRequestsAfterReject?.length || 0);
}

function countAccessibilityIssues(details) {
  return Object.values(details.violationsByImpact || {}).reduce((sum, n) => sum + n, 0);
}

function countLegalTextIssues(details) {
  return (details.impressumFound ? 0 : 1) + (details.datenschutzFound ? 0 : 1);
}

function countSecurityIssues(details) {
  let count = details.missingHeaders?.length || 0;
  if (details.certificate && details.certificate.valid === false) count += 1;
  if (details.httpsEnforced === false) count += 1;
  return count;
}

function countAiTransparencyIssues(details) {
  return details.chatbotDetected && !details.disclosureFound ? 1 : 0;
}

const ISSUE_COUNTERS = {
  trackers: countTrackerIssues,
  accessibility: countAccessibilityIssues,
  legalTexts: countLegalTextIssues,
  security: countSecurityIssues,
  aiTransparency: countAiTransparencyIssues,
};

/**
 * Baut aus dem vollstaendigen technischen Bericht die Kunden-Ansicht: nur Ampel
 * und Anzahl der Befunde je Bereich, ohne Domains, Regel-Details, Header-Namen
 * oder URLs. Die vollstaendigen Details bleiben ausschliesslich im intern
 * gespeicherten Bericht (siehe reportStore.js).
 */
export function buildPublicSummary(fullReport) {
  const categories = {};
  for (const [key, category] of Object.entries(fullReport.categories)) {
    const counter = ISSUE_COUNTERS[key];
    categories[key] = {
      status: category.status,
      issueCount: counter ? counter(category.details) : 0,
    };
  }

  return {
    url: fullReport.url,
    checkedAt: fullReport.checkedAt,
    overallStatus: fullReport.overallStatus,
    categories,
  };
}

import { chromium } from 'playwright';
import { checkCookieConsent } from './checks/cookieConsent.js';
import { scanAccessibility } from './checks/accessibility.js';
import { checkLegalTexts } from './checks/legalTexts.js';
import { checkSecurity } from './checks/security.js';
import { isChatbotRequest, checkAiTransparency } from './checks/aiTransparency.js';
import { checkShopCompliance } from './checks/shopCompliance.js';
import { assertUsableResponse } from './checks/navigation.js';
import {
  scoreTrackers,
  scoreAccessibility,
  scoreLegalTexts,
  scoreSecurity,
  scoreAiTransparency,
  scoreShopCompliance,
  buildOverallStatus,
  buildCoverage,
} from './scoring.js';

async function runAccessibilityAndLegal(browser, targetUrl) {
  const context = await browser.newContext();
  const page = await context.newPage();

  const chatbotDomains = [];
  page.on('request', (req) => {
    const domain = isChatbotRequest(req.url());
    if (domain) chatbotDomains.push(domain);
  });

  try {
    // 'networkidle' haengt sich bei Seiten mit dauerhaftem Hintergrund-Traffic
    // (Live-Ticker, Tracking-Beacons, Ads) auf, bis der Timeout greift - 'load'
    // plus fester Wartezeit ist robuster fuer beliebige, unbekannte Websites.
    const response = await page.goto(targetUrl.toString(), { waitUntil: 'load', timeout: 20000 });
    assertUsableResponse(response);
    await page.waitForTimeout(2000);
    const [axeResult, legalResult, aiResult, shopResult] = await Promise.all([
      scanAccessibility(page),
      checkLegalTexts(page),
      checkAiTransparency(page, chatbotDomains),
      checkShopCompliance(page),
    ]);
    return { axeResult, legalResult, aiResult, shopResult };
  } catch (err) {
    // Fehlgeschlagene Prüfungen sind NICHT bestanden: completed:false => Status 'unknown'.
    const failure = [`Seitenaufruf fehlgeschlagen: ${err.message}`];
    return {
      axeResult: { completed: false, errors: failure, violationsByImpact: {}, violations: [] },
      legalResult: { completed: false, errors: failure, impressumFound: false, datenschutzFound: false },
      aiResult: { completed: false, errors: failure, chatbotDetected: false, chatbotDomains: [], disclosureFound: false },
      shopResult: { completed: false, errors: failure, shopDetected: false },
    };
  } finally {
    await context.close();
  }
}

/**
 * Fuehrt den vollstaendigen Compliance-Scan fuer eine validierte URL durch.
 * Startet Browser-Checks und den (browserlosen) Security-Check parallel.
 * `options.launch` / `options.securityCheck` sind Einhaengepunkte fuer Tests.
 */
export async function runScan(targetUrl, options = {}) {
  const launch = options.launch || (() => chromium.launch({ headless: true }));
  const securityCheck = options.securityCheck || checkSecurity;
  const browser = await launch();

  try {
    const [cookieResult, { axeResult, legalResult, aiResult, shopResult }, securityResult] = await Promise.all([
      checkCookieConsent(browser, targetUrl),
      runAccessibilityAndLegal(browser, targetUrl),
      securityCheck(targetUrl),
    ]);

    const categories = {
      trackers: { ...scoreTrackers(cookieResult), details: cookieResult },
      accessibility: { ...scoreAccessibility(axeResult), details: axeResult },
      legalTexts: { ...scoreLegalTexts(legalResult), details: legalResult },
      security: { ...scoreSecurity(securityResult), details: securityResult },
      aiTransparency: { ...scoreAiTransparency(aiResult), details: aiResult },
    };

    // Shop-Compliance ist ein optionales Modul: taucht im Bericht nur auf,
    // wenn ueberhaupt ein Shop/Checkout erkannt wurde, damit reine
    // Info-Seiten keinen irrelevanten Befund angezeigt bekommen. Konnte die Shop-
    // Erkennung selbst nicht laufen, erscheint der Bereich als "nicht geprüft".
    if (shopResult.shopDetected || shopResult.completed === false) {
      categories.shopCompliance = { ...scoreShopCompliance(shopResult), details: shopResult };
    }

    const scores = Object.values(categories);
    const overallStatus = buildOverallStatus(scores);
    const coverage = buildCoverage(scores);

    const errors = [
      ...cookieResult.errors,
      ...axeResult.errors,
      ...legalResult.errors,
      ...securityResult.errors,
      ...aiResult.errors,
      ...shopResult.errors,
    ];

    return {
      url: targetUrl.toString(),
      checkedAt: new Date().toISOString(),
      overallStatus,
      coverage,
      incomplete: coverage.unknown > 0,
      categories,
      errors,
    };
  } finally {
    await browser.close();
  }
}

// Bekannte Selektoren gaengiger Consent-Management-Plattformen (CMP) fuer den
// "Ablehnen / nur notwendige Cookies"-Button. Playwright durchdringt offenes
// Shadow DOM automatisch bei CSS-Selektoren, daher funktionieren diese auch
// fuer Tools wie Usercentrics, die ueber Shadow DOM rendern.
const KNOWN_REJECT_SELECTORS = [
  '#CybotCookiebotDialogBodyButtonDecline',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
  'button[data-testid="uc-deny-all-button"]',
  '#uc-btn-deny-banner',
  '#onetrust-reject-all-handler',
  'button[data-cookie-accept-type="essential"]',
  '._brlbs-btn-accept-only-essential',
  '.cmplz-btn.cmplz-deny',
  '.cmplz-deny',
  '#cmpwelcomebtnno',
  '.cmpboxbtnno',
  '#cookiescript_reject',
  '.t-declineAll',
  '.cm-btn-decline',
  '.iubenda-cs-reject-btn',
];

// Text-Heuristik als Fallback, falls kein bekanntes CMP-Tool erkannt wurde.
const REJECT_TEXT_PATTERN =
  /^(alle ablehnen|ablehnen|nur (technisch |funktional )?notwendige( akzeptieren)?|nur erforderliche( akzeptieren)?|reject all|decline all|reject|decline|necessary only)$/i;

// Domains der Consent-Management-Plattformen selbst: das Laden dieser Domains
// VOR einer Consent-Entscheidung ist kein Tracking-Befund, sondern die
// Consent-Infrastruktur, die den Banner erst anzeigt bzw. die Ablehnung
// protokolliert. Ohne diese Ausnahme wuerde jede Website, die pflichtgemaess
// ein CMP-Tool einsetzt, dafuer "bestraft".
const CMP_INFRASTRUCTURE_DOMAINS = [
  'cookiebot.com',
  'consensu.org',
  'usercentrics.eu',
  'usercentrics.com',
  'cookieyes.com',
  'onetrust.com',
  'cookielaw.org',
  'consentmanager.net',
  'consentmanager.mgr.consensu.org',
  'borlabs.io',
  'complianz.io',
  'termly.io',
  'iubenda.com',
  'trustarc.com',
  'didomi.io',
  'cookie-script.com',
];

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// "www." wird ignoriert, damit z.B. "beispiel.de" und "www.beispiel.de"
// als dieselbe (First-Party-)Domain gelten.
function stripWww(hostname) {
  return hostname.replace(/^www\./, '');
}

function matchesDomainList(domain, list) {
  const normalized = stripWww(domain);
  return list.some((d) => normalized === d || normalized.endsWith('.' + d));
}

function isExternal(domain, firstPartyDomains) {
  if (!domain) return false;
  if (matchesDomainList(domain, CMP_INFRASTRUCTURE_DOMAINS)) return false;
  return !matchesDomainList(domain, firstPartyDomains.map(stripWww));
}

async function findRejectControl(page) {
  for (const selector of KNOWN_REJECT_SELECTORS) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }

  const candidates = page.locator('button, a, [role="button"], input[type="button"], input[type="submit"]');
  const count = await candidates.count().catch(() => 0);
  for (let i = 0; i < Math.min(count, 200); i++) {
    const el = candidates.nth(i);
    const visible = await el.isVisible().catch(() => false);
    if (!visible) continue;
    const text = (await el.innerText().catch(() => '')).trim();
    if (text && REJECT_TEXT_PATTERN.test(text)) {
      return el;
    }
  }
  return null;
}

/**
 * Prueft Tracker-Verhalten vor Consent und die tatsaechliche Blockierwirkung
 * eines erkannten Cookie-Banners (generisch, ohne Website-spezifische Konfiguration).
 */
export async function checkCookieConsent(browser, targetUrl) {
  const context = await browser.newContext();
  const page = await context.newPage();

  const preConsentRequests = [];
  const postRejectRequests = [];
  let phase = 'pre-consent';

  page.on('request', (req) => {
    const entry = { url: req.url(), domain: getDomain(req.url()) };
    if (phase === 'pre-consent') preConsentRequests.push(entry);
    else postRejectRequests.push(entry);
  });

  const result = {
    errors: [],
    preConsentExternalDomains: [],
    cookieBannerFound: false,
    cookieBannerRejectWorked: null,
    newExternalRequestsAfterReject: [],
  };

  try {
    // 'networkidle' haengt sich bei Seiten mit dauerhaftem Hintergrund-Traffic
    // (Live-Ticker, Tracking-Beacons, Ads) auf, bis der Timeout greift - 'load'
    // plus fester Wartezeit ist robuster fuer beliebige, unbekannte Websites.
    await page.goto(targetUrl.toString(), { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(3000);

    // Nach etwaigen Weiterleitungen (z.B. alte Domain -> neue Domain) gilt auch
    // die tatsaechlich geladene Domain als First-Party, nicht nur die
    // urspruenglich eingegebene.
    const finalHostname = getDomain(page.url());
    const firstPartyDomains = [targetUrl.hostname, ...(finalHostname ? [finalHostname] : [])];
    result.preConsentExternalDomains = [
      ...new Set(preConsentRequests.map((r) => r.domain).filter((d) => isExternal(d, firstPartyDomains))),
    ];

    const rejectControl = await findRejectControl(page);
    result.cookieBannerFound = !!rejectControl;

    if (rejectControl) {
      phase = 'post-reject';
      await rejectControl.click({ timeout: 5000 }).catch((e) => {
        result.errors.push(`Klick auf Ablehnen-Steuerelement fehlgeschlagen: ${e.message}`);
      });
      await page.waitForTimeout(4000);

      result.newExternalRequestsAfterReject = [
        ...new Set(
          postRejectRequests
            .map((r) => r.domain)
            .filter((d) => isExternal(d, firstPartyDomains))
            .filter((d) => !result.preConsentExternalDomains.includes(d))
        ),
      ];
      result.cookieBannerRejectWorked = result.newExternalRequestsAfterReject.length === 0;
    }
  } catch (err) {
    result.errors.push(`Crawl-Fehler: ${err.message}`);
  } finally {
    await context.close();
  }

  return result;
}

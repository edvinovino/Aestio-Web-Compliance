// Bekannte Chatbot-/KI-Assistenten-Anbieter, die haeufig auf Websites eingebunden
// werden. Erkennung ueber Skript-/Iframe-Domains, analog zu den bekannten
// CMP-Domains in cookieConsent.js.
const KNOWN_CHATBOT_DOMAINS = [
  'intercom.io',
  'intercomcdn.com',
  'drift.com',
  'tidio.co',
  'crisp.chat',
  'chatbase.co',
  'voiceflow.com',
  'tawk.to',
  'hubspot.com',
  'zendesk.com',
  'livechatinc.com',
  'chatgpt.com',
  'chatling.ai',
  'landbot.io',
  'botpress.cloud',
];

// Typische Formulierungen, mit denen Websites offenlegen, dass ein Chat/Assistent
// KI-gestuetzt ist (Art. 50 Abs. 1 AI Act: Nutzer muessen erkennen koennen, dass
// sie mit einem KI-System interagieren).
const DISCLOSURE_PATTERN =
  /(künstlich(e|er)?\s+intelligenz|ki[- ]?(gestützt|basiert|assistent|chatbot)|virtuelle(r)?\s+assistent|automatisiert(er)?\s+chat|ai[- ]?(assistant|powered|chatbot)|you'?re\s+chatting\s+with\s+an?\s+ai|this\s+is\s+an?\s+ai)/i;

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Prueft, ob eine Request-URL zu einem bekannten Chatbot-/Assistenten-Anbieter
 * gehoert. Muss VOR dem Seitenaufruf per page.on('request', ...) beobachtet
 * werden, da Widgets oft schon beim Laden nachladen.
 */
export function isChatbotRequest(url) {
  const domain = getDomain(url);
  if (!domain) return null;
  const match = KNOWN_CHATBOT_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d));
  return match ? domain : null;
}

/**
 * Prueft rein technisch, ob ein bekanntes Chatbot-Widget geladen wurde (per
 * vorab gesammelten Request-Domains) und ob im sichtbaren Seitentext eine
 * KI-Kennzeichnung auffindbar ist (Transparenzpflicht nach Art. 50 Abs. 1
 * EU AI Act, seit 2. August 2026 durchsetzbar). Erkennt nur bekannte Anbieter
 * plus eine Text-Heuristik - kein Nachweis ueber tatsaechlich eingesetzte
 * KI-Modelle, kein Erkennen von KI-generierten Inhalten/Deepfakes.
 *
 * Prueft zusaetzlich, ob jeder gefundene Hinweis nur innerhalb von Footer-
 * bzw. Impressum/AGB-Bereichen liegt. Die finalen EU-Guidelines zu Art. 50
 * (20. Juli 2026) verlangen eine "klar und eindeutig" wahrnehmbare
 * Kennzeichnung, die nicht im Kleingedruckten versteckt werden darf - ein nur
 * dort auffindbarer Hinweis erfuellt die Form-Anforderung nicht.
 */
export async function checkAiTransparency(page, chatbotDomains) {
  const result = {
    errors: [],
    chatbotDetected: chatbotDomains.length > 0,
    chatbotDomains: [...new Set(chatbotDomains)],
    disclosureFound: false,
    disclosureOnlyInFooter: false,
  };

  try {
    const { disclosureFound, disclosureOnlyInFooter } = await page.evaluate((patternSource) => {
      const pattern = new RegExp(patternSource, 'i');
      const BURIED_SELECTOR =
        'footer, [class*="impressum" i], [id*="impressum" i], [class*="agb" i], [id*="agb" i]';
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let found = false;
      let foundOutsideBuried = false;
      let node;
      while ((node = walker.nextNode())) {
        if (!pattern.test(node.textContent)) continue;
        found = true;
        const el = node.parentElement;
        if (!el?.closest(BURIED_SELECTOR)) {
          foundOutsideBuried = true;
          break;
        }
      }
      return { disclosureFound: found, disclosureOnlyInFooter: found && !foundOutsideBuried };
    }, DISCLOSURE_PATTERN.source);

    result.disclosureFound = disclosureFound;
    result.disclosureOnlyInFooter = disclosureOnlyInFooter;
  } catch (err) {
    result.errors.push(`KI-Transparenz-Check-Fehler: ${err.message}`);
  }

  return result;
}

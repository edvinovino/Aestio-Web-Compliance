// Prueft rein technisch, ob die Seite ueberhaupt einen Shop/Checkout hat, und
// falls ja, ob die zentralen Fernabsatz-Pflichten auffindbar sind: Widerruf
// als echter, klar beschrifteter Button (Pflicht seit 19. Juni 2026 fuer
// B2C-Online-Shops), nicht nur als Text-Link zu einer Belehrungs-Seite.
// Streichpreis-/Grundpreis-Korrektheit laesst sich aus einem einzelnen
// Seitenaufruf heraus nicht verlaesslich pruefen (benoetigt Preis-Historie
// bzw. Produktseiten-Kontext) - Grundpreis-Hinweise werden daher nur als
// Information gezeigt, nicht bewertet.

const SHOP_SIGNAL_PATTERN = /warenkorb|in den warenkorb|zur kasse|checkout|jetzt kaufen|add to cart|zum warenkorb/i;
const SHOP_PLATFORM_PATTERN = /cdn\.shopify\.com|woocommerce|shopware|\/wp-content\/plugins\/woocommerce/i;
const WIDERRUF_LINK_PATTERN = /widerruf/i;
const WIDERRUF_BUTTON_PATTERN = /vertrag\s+widerrufen|widerruf(ung)?\s+erkl(ä|ae)ren|jetzt\s+widerrufen/i;
const GRUNDPREIS_PATTERN = /€\s*\/\s*(kg|g|l|ml|m²|m\b)|je\s+(kg|liter|100\s*g|100\s*ml)/i;

export async function checkShopCompliance(page) {
  const result = {
    errors: [],
    shopDetected: false,
    widerrufsbelehrungFound: false,
    widerrufsbelehrungUrl: null,
    widerrufsButtonFound: false,
    grundpreisHinweisGefunden: false,
  };

  try {
    const [bodyText, links, buttonTexts] = await Promise.all([
      page.evaluate(() => document.body?.innerText || ''),
      page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]')).map((a) => ({
          href: a.href,
          text: (a.innerText || a.textContent || '').trim(),
        }))
      ),
      page.evaluate(() =>
        Array.from(document.querySelectorAll('button, a[role="button"], input[type="submit"]')).map(
          (el) => (el.innerText || el.textContent || el.value || '').trim()
        )
      ),
    ]);

    const html = await page.content();

    result.shopDetected =
      SHOP_SIGNAL_PATTERN.test(bodyText) ||
      SHOP_PLATFORM_PATTERN.test(html) ||
      links.some((l) => SHOP_SIGNAL_PATTERN.test(l.text) || SHOP_SIGNAL_PATTERN.test(l.href));

    if (!result.shopDetected) return result;

    for (const link of links) {
      if (!result.widerrufsbelehrungFound && WIDERRUF_LINK_PATTERN.test(`${link.text} ${link.href}`)) {
        result.widerrufsbelehrungFound = true;
        result.widerrufsbelehrungUrl = link.href;
      }
    }

    result.widerrufsButtonFound = buttonTexts.some((t) => WIDERRUF_BUTTON_PATTERN.test(t));
    result.grundpreisHinweisGefunden = GRUNDPREIS_PATTERN.test(bodyText);
  } catch (err) {
    result.errors.push(`Shop-Compliance-Check-Fehler: ${err.message}`);
  }

  return result;
}

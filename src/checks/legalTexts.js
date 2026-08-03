const IMPRESSUM_PATTERN = /impressum|imprint|legal notice/i;
const DATENSCHUTZ_PATTERN = /datenschutz|privacy( policy)?/i;

/**
 * Prueft rein technisch, ob Links zu Impressum und Datenschutzerklaerung auf
 * der Seite auffindbar sind (Pflicht nach TMG/DSGVO). Keine inhaltliche
 * Bewertung der Texte selbst.
 */
export async function checkLegalTexts(page) {
  const result = {
    errors: [],
    impressumFound: false,
    impressumUrl: null,
    datenschutzFound: false,
    datenschutzUrl: null,
  };

  try {
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]')).map((a) => ({
        href: a.href,
        text: (a.innerText || a.textContent || '').trim(),
      }))
    );

    for (const link of links) {
      const combined = `${link.text} ${link.href}`;
      if (!result.impressumFound && IMPRESSUM_PATTERN.test(combined)) {
        result.impressumFound = true;
        result.impressumUrl = link.href;
      }
      if (!result.datenschutzFound && DATENSCHUTZ_PATTERN.test(combined)) {
        result.datenschutzFound = true;
        result.datenschutzUrl = link.href;
      }
    }
  } catch (err) {
    result.errors.push(`Rechtstexte-Check-Fehler: ${err.message}`);
  }

  return result;
}

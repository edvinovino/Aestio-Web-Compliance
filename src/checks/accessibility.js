import AxeBuilder from '@axe-core/playwright';
import { createRequire } from 'node:module';

// axe-core liefert eine offiziell gepflegte deutsche Uebersetzung fuer
// Regel-Beschreibungen mit ("de.json"). Ueber createRequire geladen, da JSON-Imports
// in ESM je nach Node-Version unterschiedliche Syntax verlangen.
const require = createRequire(import.meta.url);
const deLocale = require('axe-core/locales/de.json');

const IMPACT_LABELS_DE = {
  critical: 'Kritisch',
  serious: 'Schwerwiegend',
  moderate: 'Moderat',
  minor: 'Gering',
};

/**
 * Automatisierter Barrierefreiheits-Scan (WCAG 2.1 AA) via axe-core.
 * Wichtig: automatisierte Scans finden erfahrungsgemaess nur ca. 30-40% aller
 * WCAG-Probleme. Das ersetzt keinen manuellen Test, ist aber ein zuverlaessiger
 * Frueh-Indikator.
 */
export async function scanAccessibility(page) {
  const result = {
    errors: [],
    violationsByImpact: { critical: 0, serious: 0, moderate: 0, minor: 0 },
    violations: [],
  };

  try {
    const axeResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();

    for (const v of axeResults.violations) {
      result.violationsByImpact[v.impact] = (result.violationsByImpact[v.impact] || 0) + 1;
      const localeEntry = deLocale.rules?.[v.id];
      result.violations.push({
        id: v.id,
        impact: v.impact,
        impactLabel: IMPACT_LABELS_DE[v.impact] || v.impact,
        description: localeEntry?.description || v.description,
        help: localeEntry?.help || v.help,
        helpUrl: v.helpUrl,
        nodeCount: v.nodes.length,
      });
    }
  } catch (err) {
    result.errors.push(`Accessibility-Scan-Fehler: ${err.message}`);
  }

  return result;
}

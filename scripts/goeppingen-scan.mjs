import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAndNormalizeUrl } from '../src/urlGuard.js';
import { runScan } from '../src/scanEngine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, 'goeppingen-results.json');
const CONCURRENCY = 3;

// Lokale/kleine mittelstaendische Unternehmen in Goeppingen, 73033, recherchiert
// per Websuche (Restaurants, Baeckerei/Cafe, Friseure, Kfz-Werkstaetten,
// Physiotherapie-Praxen, Steuerberater/Kanzleien, Blumenladen, Fitnessstudio).
const companies = [
  { name: 'Restaurant Kastell', url: 'https://www.kastell-restaurant.com/' },
  { name: 'Crown Indisches Restaurant', url: 'https://crown-indisches-restaurant.de/' },
  { name: 'Ristorante Corona', url: 'https://ristorante-corona.de/' },
  { name: 'Cafe Berner', url: 'https://www.cafe-berner.de/' },
  { name: 'Bäckerei Kauderer', url: 'https://www.baeckerei-kauderer.de/' },
  { name: "MayerS Bäckerei & Konditorei", url: 'https://www.mayer-s.de/' },
  { name: 'Friseur Dreher', url: 'https://www.friseur-dreher.de/' },
  { name: 'Daniel Steinmacher (Friseur)', url: 'https://www.daniel-steinmacher.de/' },
  { name: 'Friseurkunst', url: 'https://www.friseurkunst.com/' },
  { name: 'KFZ Werkstatt Terihaj', url: 'https://kfz-terihaj.de/' },
  { name: 'AUTO CHECK Mayer & Köhler', url: 'https://www.ac-goeppingen.de/' },
  { name: 'PhysioFit Hock', url: 'https://www.physiofithock-gp.de/' },
  { name: 'PhysioMitte Göppingen', url: 'https://www.physiomitte-gp.de/' },
  { name: 'Therapie am Stadtpark (Thomas Hummel)', url: 'https://www.therapie-hummel.de/' },
  { name: 'Thiess Gesundheitszentrum', url: 'https://thiess-physiotherapie.de/' },
  { name: 'Medicus Physiotherapie', url: 'https://medicus-physiotherapie.de/' },
  { name: 'sano Physiotherapie', url: 'https://www.sano-gp.de/' },
  { name: 'B-Physio', url: 'https://b-physio.de/goeppingen/' },
  { name: 'Physioconcept Göppingen', url: 'https://www.ziegler-physiotherapie.de/physioconcept-goeppingen/' },
  { name: 'Blumen Krätzer', url: 'https://www.blumen-kraetzer.de/' },
  { name: 'RKC Steuerberater', url: 'https://www.rkc-steuerberater.de/' },
  { name: 'Hauptmann-Uhl & Kollegen', url: 'https://steuer-goeppingen.de/' },
  { name: 'EHNI HÖSS WAGNER Steuerberater', url: 'https://www.steuerberater-gp.de/' },
  { name: 'Kanzlei Behrendt', url: 'https://www.behrendt-anwaelte.de/' },
  { name: 'ALEX MEDICAL FITNESS', url: 'https://alex-medical-fitness.de/' },
];

async function scanOne(company) {
  console.log(`▶ ${company.name} (${company.url})`);
  try {
    const targetUrl = await validateAndNormalizeUrl(company.url);
    const report = await runScan(targetUrl);
    console.log(`  ✓ ${company.name}: ${report.overallStatus}`);
    return { name: company.name, inputUrl: company.url, ...report };
  } catch (err) {
    console.log(`  ✗ ${company.name}: ${err.message}`);
    return { name: company.name, inputUrl: company.url, url: company.url, scanFailed: true, error: err.message };
  }
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runNext() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await worker(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, runNext));
  return results;
}

const results = await runPool(companies, CONCURRENCY, scanOne);
await fs.writeFile(OUT_FILE, JSON.stringify(results, null, 2), 'utf-8');
console.log(`\nFertig. ${results.length} Ergebnisse gespeichert unter ${OUT_FILE}`);

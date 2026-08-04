import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
// Lokal (kein DATA_DIR gesetzt): alles wie bisher relativ zum Projektordner.
// In Produktion (z.B. Render) zeigt DATA_DIR auf eine persistente Disk, damit
// Berichte, Anfragen und das Admin-Token Deploys und Neustarts ueberleben.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : PROJECT_ROOT;
const REPORTS_DIR = path.join(DATA_DIR, 'reports');
const ADMIN_TOKEN_FILE = path.join(DATA_DIR, 'admin-token.txt');
// Aestio Web Compliance/aestio-scanner -> Aestio Web Compliance -> Aestio
const KUNDEN_ANFRAGEN_DIR = process.env.DATA_DIR
  ? path.join(DATA_DIR, 'Kunden-Anfragen')
  : path.join(PROJECT_ROOT, '..', '..', 'Kunden-Anfragen');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let cachedAdminToken = null;

/**
 * Liest das Admin-Token aus admin-token.txt oder generiert beim ersten Start
 * eines. So bleibt der Zugriff auf volle Berichte stabil ueber Neustarts hinweg,
 * ohne dass ein Token manuell konfiguriert werden muss.
 */
export async function getAdminToken() {
  if (cachedAdminToken) return cachedAdminToken;

  try {
    cachedAdminToken = (await fs.readFile(ADMIN_TOKEN_FILE, 'utf-8')).trim();
  } catch {
    cachedAdminToken = crypto.randomBytes(24).toString('hex');
    await fs.writeFile(ADMIN_TOKEN_FILE, cachedAdminToken, 'utf-8');
  }
  return cachedAdminToken;
}

/**
 * Speichert den vollstaendigen technischen Bericht serverseitig (nicht fuer
 * den scannenden Kunden sichtbar) und gibt eine zufaellige ID zurueck.
 */
export async function saveReport(fullReport) {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const id = crypto.randomUUID();
  const record = { id, ...fullReport };
  await fs.writeFile(path.join(REPORTS_DIR, `${id}.json`), JSON.stringify(record, null, 2), 'utf-8');
  return id;
}

/**
 * Liste aller gespeicherten Berichte (neueste zuerst), nur mit den Feldern,
 * die fuer eine Uebersicht noetig sind.
 */
export async function listReports() {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const files = (await fs.readdir(REPORTS_DIR)).filter((f) => f.endsWith('.json'));

  const entries = await Promise.all(
    files.map(async (file) => {
      try {
        const raw = await fs.readFile(path.join(REPORTS_DIR, file), 'utf-8');
        const data = JSON.parse(raw);
        return { id: data.id, url: data.url, checkedAt: data.checkedAt, overallStatus: data.overallStatus };
      } catch {
        return null;
      }
    })
  );

  return entries.filter(Boolean).sort((a, b) => new Date(b.checkedAt) - new Date(a.checkedAt));
}

/**
 * Laedt einen vollstaendigen Bericht anhand seiner ID. Validiert das ID-Format,
 * um Path-Traversal ueber den Dateinamen auszuschliessen.
 */
export async function getReport(id) {
  if (!UUID_PATTERN.test(id)) return null;
  try {
    const raw = await fs.readFile(path.join(REPORTS_DIR, `${id}.json`), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function slugify(input) {
  return (
    input
      .toLowerCase()
      .replace(/https?:\/\//, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-+|-+$)/g, '')
      .slice(0, 60) || 'unbekannt'
  );
}

/**
 * Legt jede eingehende Anfrage (Scan oder Kontaktformular) automatisch in
 * Kunden-Anfragen/<Monat>/<Datum_Firma>/ ab, mit einer notizen.txt zum
 * manuellen Abhaken. Das ersetzt kein CRM, aber sorgt dafuer, dass nichts
 * verloren geht, bevor eines eingerichtet ist.
 */
export async function archiveInquiry({ type, label, payload }) {
  const now = new Date();
  const monthDir = now.toISOString().slice(0, 7);
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
  const folderName = `${dateStr}_${timeStr}_${slugify(label || 'anfrage')}`;
  const dir = path.join(KUNDEN_ANFRAGEN_DIR, monthDir, folderName);
  await fs.mkdir(dir, { recursive: true });

  const record = { type, receivedAt: now.toISOString(), ...payload };
  const filename = type === 'scan' ? 'scan-ergebnis.json' : 'anfrage.json';
  await fs.writeFile(path.join(dir, filename), JSON.stringify(record, null, 2), 'utf-8');

  const notePath = path.join(dir, 'notizen.txt');
  await fs.writeFile(notePath, 'Status: NEU\nKontaktiert am: \nNotizen:\n', { flag: 'wx' }).catch(() => {});

  return dir;
}

const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const FOLDER_PATTERN = /^[0-9a-z_-]+$/;

function firstLineStatus(notes) {
  const match = /^Status:\s*(.*)$/m.exec(notes || '');
  return match ? match[1].trim() || 'NEU' : 'NEU';
}

/**
 * Liste aller archivierten Kunden-Anfragen (neueste zuerst), fuers Admin-Panel
 * und den lokalen Sync. Liest pro Ordner die record-Datei + notizen.txt.
 */
export async function listInquiries() {
  await fs.mkdir(KUNDEN_ANFRAGEN_DIR, { recursive: true });
  const months = (await fs.readdir(KUNDEN_ANFRAGEN_DIR)).filter((m) => MONTH_PATTERN.test(m));

  const entries = [];
  for (const month of months) {
    const monthPath = path.join(KUNDEN_ANFRAGEN_DIR, month);
    const folders = (await fs.readdir(monthPath).catch(() => [])).filter((f) => FOLDER_PATTERN.test(f));

    for (const folder of folders) {
      const dir = path.join(monthPath, folder);
      try {
        const files = await fs.readdir(dir);
        const recordFile = files.find((f) => f === 'scan-ergebnis.json' || f === 'anfrage.json');
        if (!recordFile) continue;
        const record = JSON.parse(await fs.readFile(path.join(dir, recordFile), 'utf-8'));
        const notes = await fs.readFile(path.join(dir, 'notizen.txt'), 'utf-8').catch(() => '');
        entries.push({
          month,
          folder,
          type: record.type,
          label: record.url || record.company || record.name || folder,
          receivedAt: record.receivedAt,
          status: firstLineStatus(notes),
        });
      } catch {
        // einzelner defekter Ordner soll die restliche Liste nicht blockieren
      }
    }
  }

  return entries.sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
}

/**
 * Voller Inhalt einer einzelnen Anfrage (Record + Notizen-Text) fuer
 * Admin-Detailansicht und lokalen Sync.
 */
export async function getInquiry(month, folder) {
  if (!MONTH_PATTERN.test(month) || !FOLDER_PATTERN.test(folder)) return null;
  const dir = path.join(KUNDEN_ANFRAGEN_DIR, month, folder);
  try {
    const files = await fs.readdir(dir);
    const recordFile = files.find((f) => f === 'scan-ergebnis.json' || f === 'anfrage.json');
    if (!recordFile) return null;
    const record = JSON.parse(await fs.readFile(path.join(dir, recordFile), 'utf-8'));
    const notes = await fs.readFile(path.join(dir, 'notizen.txt'), 'utf-8').catch(() => '');
    return { record, notes, recordFile };
  } catch {
    return null;
  }
}

/**
 * Ueberschreibt die notizen.txt einer Anfrage (Status/Notizen manuell
 * abhaken, direkt aus dem Admin-Panel).
 */
export async function updateInquiryNotes(month, folder, notes) {
  if (!MONTH_PATTERN.test(month) || !FOLDER_PATTERN.test(folder)) throw new Error('Ungueltige ID.');
  const dir = path.join(KUNDEN_ANFRAGEN_DIR, month, folder);
  await fs.access(dir);
  await fs.writeFile(path.join(dir, 'notizen.txt'), notes, 'utf-8');
}

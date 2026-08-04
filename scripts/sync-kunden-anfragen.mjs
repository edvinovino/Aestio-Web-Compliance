#!/usr/bin/env node
// Spiegelt die Kunden-Anfragen von der Live-Seite (Render) in den lokalen
// Aestio/Kunden-Anfragen-Ordner. Gedacht zum wiederholten Ausfuehren (z.B. per
// Cronjob) -- ueberschreibt lokale Dateien immer mit dem aktuellen Serverstand.

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const BASE_URL = process.env.AESTIO_BASE_URL || 'https://compliance.aestio.de';
const TOKEN_FILE = process.env.AESTIO_TOKEN_FILE || path.join(os.homedir(), '.aestio-admin-token');
const LOCAL_DIR = process.env.AESTIO_LOCAL_DIR || path.join(os.homedir(), 'Desktop', 'Aestio', 'Kunden-Anfragen');

async function readToken() {
  try {
    return (await fs.readFile(TOKEN_FILE, 'utf-8')).trim();
  } catch {
    console.error(`Kein Token gefunden unter ${TOKEN_FILE}. Siehe README fuer Einrichtung.`);
    process.exit(1);
  }
}

async function main() {
  const token = await readToken();
  if (!token) {
    console.error('Token-Datei ist leer.');
    process.exit(1);
  }

  const listRes = await fetch(`${BASE_URL}/admin/api/inquiries?token=${encodeURIComponent(token)}`);
  if (!listRes.ok) {
    console.error(`Liste konnte nicht geladen werden (HTTP ${listRes.status}).`);
    process.exit(1);
  }
  const inquiries = await listRes.json();

  let synced = 0;
  for (const { month, folder } of inquiries) {
    const detailRes = await fetch(
      `${BASE_URL}/admin/api/inquiries/${month}/${folder}?token=${encodeURIComponent(token)}`
    );
    if (!detailRes.ok) continue;
    const { record, notes, recordFile } = await detailRes.json();

    const dir = path.join(LOCAL_DIR, month, folder);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, recordFile), JSON.stringify(record, null, 2), 'utf-8');
    await fs.writeFile(path.join(dir, 'notizen.txt'), notes, 'utf-8');
    synced++;
  }

  console.log(`[${new Date().toLocaleString('de-DE')}] ${synced}/${inquiries.length} Anfragen synchronisiert nach ${LOCAL_DIR}`);
}

main().catch((err) => {
  console.error('Sync fehlgeschlagen:', err.message);
  process.exit(1);
});

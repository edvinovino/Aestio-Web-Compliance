import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAndNormalizeUrl } from './src/urlGuard.js';
import { runScan } from './src/scanEngine.js';
import { getAdminToken, saveReport, listReports, getReport, archiveInquiry } from './src/reportStore.js';
import { buildPublicSummary } from './src/publicSummary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Einfacher In-Memory-Rate-Limiter: verhindert, dass der Scanner als offener
// Proxy fuer beliebige Ziel-Websites missbraucht wird (max. 5 Scans / 10 Min / IP).
const rateLimitWindowMs = 10 * 60 * 1000;
const rateLimitMax = 5;
const requestLog = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (requestLog.get(ip) || []).filter((t) => now - t < rateLimitWindowMs);
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return timestamps.length > rateLimitMax;
}

// Verhindert parallele Scans desselben Ziels und begrenzt die Gesamtlast
// (Playwright-Scans sind ressourcenintensiv).
let activeScans = 0;
const MAX_CONCURRENT_SCANS = 3;

app.post('/api/scan', async (req, res) => {
  const ip = req.ip;
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Zu viele Anfragen. Bitte in ein paar Minuten erneut versuchen.' });
  }

  const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!rawUrl) {
    return res.status(400).json({ error: 'Bitte eine URL angeben.' });
  }

  let targetUrl;
  try {
    targetUrl = await validateAndNormalizeUrl(rawUrl);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (activeScans >= MAX_CONCURRENT_SCANS) {
    return res.status(503).json({ error: 'Der Scanner ist aktuell ausgelastet. Bitte kurz warten und erneut versuchen.' });
  }

  activeScans++;
  try {
    const fullReport = await runScan(targetUrl);
    await saveReport(fullReport); // voller Bericht bleibt privat, Kunde bekommt nur die Zusammenfassung
    const summary = buildPublicSummary(fullReport);
    await archiveInquiry({
      type: 'scan',
      label: targetUrl.hostname,
      payload: { url: fullReport.url, overallStatus: summary.overallStatus, categories: summary.categories },
    }).catch(() => {}); // Ablage darf einen erfolgreichen Scan nie verhindern
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: `Scan fehlgeschlagen: ${err.message}` });
  } finally {
    activeScans--;
  }
});

const contactRateLog = new Map();

app.post('/api/contact', async (req, res) => {
  const ip = req.ip;
  const timestamps = (contactRateLog.get(ip) || []).filter((t) => Date.now() - t < rateLimitWindowMs);
  timestamps.push(Date.now());
  contactRateLog.set(ip, timestamps);
  if (timestamps.length > rateLimitMax) {
    return res.status(429).json({ error: 'Zu viele Anfragen. Bitte in ein paar Minuten erneut versuchen.' });
  }

  const { name, email, company, message, source, package: pkg, branche } = req.body || {};
  if (!name || !email) {
    return res.status(400).json({ error: 'Bitte Name und E-Mail angeben.' });
  }

  try {
    await archiveInquiry({
      type: 'kontakt',
      label: company || name,
      payload: { name, email, company: company || null, message: message || null, source: source || 'unbekannt', package: pkg || null, branche: branche || null },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Anfrage konnte nicht gespeichert werden.' });
  }
});

async function requireAdminToken(req, res, next) {
  const token = req.query.token;
  const adminToken = await getAdminToken();
  if (!token || token !== adminToken) {
    return res.status(403).json({ error: 'Ungültiges oder fehlendes Admin-Token.' });
  }
  next();
}

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin/api/reports', requireAdminToken, async (req, res) => {
  res.json(await listReports());
});

app.get('/admin/api/reports/:id', requireAdminToken, async (req, res) => {
  const report = await getReport(req.params.id);
  if (!report) {
    return res.status(404).json({ error: 'Bericht nicht gefunden.' });
  }
  res.json(report);
});

app.listen(PORT, async () => {
  const adminToken = await getAdminToken();
  console.log(`Aestio Web Compliance Scanner läuft auf http://localhost:${PORT}`);
  console.log(`Admin-Bereich (volle Berichte): http://localhost:${PORT}/admin?token=${adminToken}`);
});

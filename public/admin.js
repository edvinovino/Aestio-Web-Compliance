import { renderReport, escapeHtml } from './report-render.js';

const token = new URLSearchParams(window.location.search).get('token') || '';

const listView = document.getElementById('list-view');
const detailView = document.getElementById('detail-view');
const scanList = document.getElementById('scan-list');
const detailContent = document.getElementById('detail-content');
const backLink = document.getElementById('back-link');

const tabReports = document.getElementById('tab-reports');
const tabInquiries = document.getElementById('tab-inquiries');
const inquiryListView = document.getElementById('inquiry-list-view');
const inquiryList = document.getElementById('inquiry-list');
const inquiryDetailView = document.getElementById('inquiry-detail-view');
const inquiryDetailContent = document.getElementById('inquiry-detail-content');
const inquiryBackLink = document.getElementById('inquiry-back-link');

function withToken(path) {
  return `${path}?token=${encodeURIComponent(token)}`;
}

function hideAllSections() {
  listView.style.display = 'none';
  detailView.style.display = 'none';
  inquiryListView.style.display = 'none';
  inquiryDetailView.style.display = 'none';
}

function statusClass(status) {
  const s = (status || '').toLowerCase();
  if (s === 'erledigt') return 'erledigt';
  if (s === 'kontaktiert') return 'kontaktiert';
  return '';
}

async function loadList() {
  hideAllSections();
  listView.style.display = '';
  tabReports.classList.add('active');
  tabInquiries.classList.remove('active');

  const res = await fetch(withToken('/admin/api/reports'));
  if (!res.ok) {
    scanList.innerHTML = `<li>Zugriff verweigert — Token in der URL prüfen (?token=...).</li>`;
    return;
  }
  const reports = await res.json();

  if (!reports.length) {
    scanList.innerHTML = `<li>Noch keine Scans durchgeführt.</li>`;
    return;
  }

  scanList.innerHTML = reports
    .map(
      (r) => `
      <li data-id="${escapeHtml(r.id)}">
        <div class="dot ${r.overallStatus}"></div>
        <span class="url">${escapeHtml(r.url)}</span>
        <span class="date">${new Date(r.checkedAt).toLocaleString('de-DE')}</span>
      </li>`
    )
    .join('');

  scanList.querySelectorAll('li[data-id]').forEach((li) => {
    li.addEventListener('click', () => loadDetail(li.dataset.id));
  });
}

async function loadDetail(id) {
  const res = await fetch(withToken(`/admin/api/reports/${id}`));
  if (!res.ok) {
    detailContent.innerHTML = `<div class="error-box">Bericht konnte nicht geladen werden.</div>`;
  } else {
    const report = await res.json();
    detailContent.innerHTML = renderReport(report);
  }
  hideAllSections();
  detailView.style.display = '';
}

backLink.addEventListener('click', (e) => {
  e.preventDefault();
  loadList();
});

const TYPE_LABELS = { scan: 'Scan', kontakt: 'Kontakt' };

async function loadInquiryList() {
  hideAllSections();
  inquiryListView.style.display = '';
  tabInquiries.classList.add('active');
  tabReports.classList.remove('active');

  const res = await fetch(withToken('/admin/api/inquiries'));
  if (!res.ok) {
    inquiryList.innerHTML = `<li>Zugriff verweigert — Token in der URL prüfen (?token=...).</li>`;
    return;
  }
  const inquiries = await res.json();

  if (!inquiries.length) {
    inquiryList.innerHTML = `<li>Noch keine Anfragen eingegangen.</li>`;
    return;
  }

  inquiryList.innerHTML = inquiries
    .map(
      (i) => `
      <li data-month="${escapeHtml(i.month)}" data-folder="${escapeHtml(i.folder)}">
        <span class="type-tag">${escapeHtml(TYPE_LABELS[i.type] || i.type || '—')}</span>
        <span class="url">${escapeHtml(i.label)}</span>
        <span class="status-pill ${statusClass(i.status)}">${escapeHtml(i.status)}</span>
        <span class="date">${i.receivedAt ? new Date(i.receivedAt).toLocaleString('de-DE') : ''}</span>
      </li>`
    )
    .join('');

  inquiryList.querySelectorAll('li[data-folder]').forEach((li) => {
    li.addEventListener('click', () => loadInquiryDetail(li.dataset.month, li.dataset.folder));
  });
}

async function loadInquiryDetail(month, folder) {
  const res = await fetch(withToken(`/admin/api/inquiries/${month}/${folder}`));
  if (!res.ok) {
    inquiryDetailContent.innerHTML = `<div class="error-box">Anfrage konnte nicht geladen werden.</div>`;
  } else {
    const { record, notes } = await res.json();
    inquiryDetailContent.innerHTML = `
      <h2 style="margin-bottom:14px;">${escapeHtml(record.url || record.company || record.name || folder)}</h2>
      <div class="record-box">${escapeHtml(JSON.stringify(record, null, 2))}</div>
      <h3 style="margin:20px 0 4px;font-size:15px;">Notizen</h3>
      <textarea class="notes-box" id="notes-field">${escapeHtml(notes)}</textarea>
      <div>
        <button class="save-btn" id="save-notes-btn">Speichern</button>
        <span class="save-status" id="save-status"></span>
      </div>
    `;
    document.getElementById('save-notes-btn').addEventListener('click', async () => {
      const statusEl = document.getElementById('save-status');
      statusEl.textContent = 'Speichere…';
      const putRes = await fetch(withToken(`/admin/api/inquiries/${month}/${folder}/notes`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: document.getElementById('notes-field').value }),
      });
      statusEl.textContent = putRes.ok ? 'Gespeichert.' : 'Fehler beim Speichern.';
    });
  }
  hideAllSections();
  inquiryDetailView.style.display = '';
}

inquiryBackLink.addEventListener('click', (e) => {
  e.preventDefault();
  loadInquiryList();
});

tabReports.addEventListener('click', loadList);
tabInquiries.addEventListener('click', loadInquiryList);

loadList();

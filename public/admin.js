import { renderReport, escapeHtml } from './report-render.js';

const token = new URLSearchParams(window.location.search).get('token') || '';

const listView = document.getElementById('list-view');
const detailView = document.getElementById('detail-view');
const scanList = document.getElementById('scan-list');
const detailContent = document.getElementById('detail-content');
const backLink = document.getElementById('back-link');

function withToken(path) {
  return `${path}?token=${encodeURIComponent(token)}`;
}

async function loadList() {
  detailView.style.display = 'none';
  listView.style.display = '';

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
  listView.style.display = 'none';
  detailView.style.display = '';
}

backLink.addEventListener('click', (e) => {
  e.preventDefault();
  loadList();
});

loadList();

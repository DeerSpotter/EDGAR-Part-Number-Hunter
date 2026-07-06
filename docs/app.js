(() => {
  'use strict';

  const WORKER_URL = 'https://edgar-part-number-hunter.spotterdeer.workers.dev';
  const HISTORY_KEY = 'edgarKeywordHistoryV3';

  const $ = (id) => document.getElementById(id);
  const ui = {
    keywords: $('keywords'),
    excludeKeywords: $('excludeKeywords'),
    matchMode: $('matchMode'),
    forms: $('forms'),
    startDate: $('startDate'),
    endDate: $('endDate'),
    limit: $('limit'),
    rememberSearches: $('rememberSearches'),
    searchButton: $('searchButton'),
    stopButton: $('stopButton'),
    copyQuery: $('copyQuery'),
    queryStatus: $('queryStatus'),
    progressBar: $('progressBar'),
    workerStatus: $('workerStatus'),
    keywordCount: $('keywordCount'),
    resultCount: $('resultCount'),
    totalCount: $('totalCount'),
    companyCount: $('companyCount'),
    resultFilter: $('resultFilter'),
    sortResults: $('sortResults'),
    exportCsv: $('exportCsv'),
    exportJson: $('exportJson'),
    emptyState: $('emptyState'),
    results: $('results'),
    history: $('history'),
    clearHistory: $('clearHistory'),
    loadExample: $('loadExample')
  };

  let controller = null;
  let results = [];
  let secTotal = 0;
  let lastQuery = '';

  ui.endDate.value = new Date().toISOString().slice(0, 10);

  function uniqueLines(value) {
    return [...new Set(String(value || '').split(/\r?\n/).map(v => v.trim()).filter(Boolean))];
  }

  function keywords() {
    return uniqueLines(ui.keywords.value);
  }

  function exclusions() {
    return uniqueLines(ui.excludeKeywords.value);
  }

  function quote(value) {
    return `"${String(value).replace(/"/g, '')}"`;
  }

  function buildQuery(items) {
    const mode = ui.matchMode.value;
    let query;

    if (mode === 'exact') {
      query = items.map(quote).join(' OR ');
    } else if (mode === 'all') {
      query = items.map(item => `(${item})`).join(' AND ');
    } else {
      query = items.map(item => `(${item})`).join(' OR ');
    }

    for (const blocked of exclusions()) {
      query += ` NOT ${quote(blocked)}`;
    }

    return query.trim();
  }

  function workerSearchUrl(query) {
    const url = new URL('/search', WORKER_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('size', ui.limit.value);
    if (ui.startDate.value) url.searchParams.set('startdt', ui.startDate.value);
    if (ui.endDate.value) url.searchParams.set('enddt', ui.endDate.value);
    if (ui.forms.value) url.searchParams.set('forms', ui.forms.value);
    return url.toString();
  }

  function setWorkerStatus(text, kind = '') {
    ui.workerStatus.textContent = text;
    ui.workerStatus.className = `status-pill ${kind}`.trim();
  }

  function setProgress(percent, text) {
    ui.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    ui.queryStatus.textContent = text;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
  }

  function visibleResults() {
    const filter = ui.resultFilter.value.trim().toLowerCase();
    let visible = results.filter(item => {
      if (!filter) return true;
      return [
        item.company,
        item.cik,
        item.form,
        item.filed,
        item.accession,
        item.filename,
        item.context
      ].join(' ').toLowerCase().includes(filter);
    });

    visible = [...visible].sort((a, b) => {
      if (ui.sortResults.value === 'company') {
        return a.company.localeCompare(b.company) || b.filed.localeCompare(a.filed);
      }
      if (ui.sortResults.value === 'form') {
        return a.form.localeCompare(b.form) || b.filed.localeCompare(a.filed);
      }
      return b.filed.localeCompare(a.filed) || a.company.localeCompare(b.company);
    });

    return visible;
  }

  function updateStats() {
    const visible = visibleResults();
    ui.keywordCount.textContent = String(keywords().length);
    ui.resultCount.textContent = String(visible.length);
    ui.totalCount.textContent = String(secTotal);
    ui.companyCount.textContent = String(new Set(visible.map(item => item.company)).size);
    ui.exportCsv.disabled = results.length === 0;
    ui.exportJson.disabled = results.length === 0;
  }

  function renderResults() {
    const visible = visibleResults();
    ui.emptyState.hidden = results.length > 0;

    ui.results.innerHTML = visible.map((item, index) => {
      const filingUrl = item.filing_url || item.filing_index_url || 'https://www.sec.gov/edgar/search/';
      const indexUrl = item.filing_index_url || filingUrl;
      return `
        <article class="result-card">
          <div class="score high"><strong>${String(index + 1).padStart(2, '0')}</strong><small>match</small></div>
          <div class="result-main">
            <h3>${escapeHtml(item.company || 'Unknown filer')}</h3>
            <div class="result-meta">
              <span>${escapeHtml(item.form || 'Unknown form')}</span>
              <span>Filed ${escapeHtml(item.filed || 'unknown')}</span>
              ${item.cik ? `<span>CIK ${escapeHtml(item.cik)}</span>` : ''}
              ${item.accession ? `<span>${escapeHtml(item.accession)}</span>` : ''}
            </div>
            <div class="match-line"><strong>Match context:</strong> ${escapeHtml(item.context || 'SEC full text match')}</div>
            <div class="badges">
              <span class="badge signal">SEC EDGAR</span>
              ${item.filename ? `<span class="badge">${escapeHtml(item.filename)}</span>` : ''}
            </div>
          </div>
          <div class="result-links">
            <a href="${escapeHtml(filingUrl)}" target="_blank" rel="noreferrer">Open match ↗</a>
            <a href="${escapeHtml(indexUrl)}" target="_blank" rel="noreferrer">Filing index ↗</a>
            <button class="copy-button" type="button" data-copy="${escapeHtml(filingUrl)}">Copy SEC URL</button>
          </div>
        </article>`;
    }).join('');

    updateStats();
  }

  function validateKeywords() {
    const items = keywords();
    if (!items.length) {
      setProgress(0, 'Enter at least one keyword');
      ui.keywords.focus();
      return null;
    }
    return items;
  }

  async function search() {
    const items = validateKeywords();
    if (!items) return;

    controller?.abort();
    controller = new AbortController();
    const query = buildQuery(items);
    lastQuery = query;

    ui.searchButton.disabled = true;
    ui.stopButton.disabled = false;
    setWorkerStatus('Searching', 'busy');
    setProgress(20, `Searching EDGAR for ${items.length} keyword${items.length === 1 ? '' : 's'}`);

    remember(items);

    try {
      const response = await fetch(workerSearchUrl(query), {
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });

      setProgress(65, 'SEC results received, building matches');

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `Worker returned HTTP ${response.status}`);
      }

      results = Array.isArray(payload.results) ? payload.results : [];
      secTotal = Number(payload.total || 0);
      renderResults();
      setWorkerStatus('Worker online', 'ok');
      setProgress(100, `${results.length} results shown from ${secTotal} SEC matches`);
    } catch (error) {
      if (error?.name === 'AbortError') {
        setWorkerStatus('Stopped', 'error');
        setProgress(0, 'Search stopped');
      } else {
        results = [];
        secTotal = 0;
        renderResults();
        setWorkerStatus('Worker error', 'error');
        setProgress(0, error?.message || String(error));
        ui.results.innerHTML = `<div class="error-card"><strong>Search failed:</strong> ${escapeHtml(error?.message || String(error))}<br><br>The Pages UI is connected to <code>${escapeHtml(WORKER_URL)}</code>. Deploy the Worker source from <code>worker/src/index.js</code> in this repository to that Worker.</div>`;
        ui.emptyState.hidden = true;
      }
    } finally {
      controller = null;
      ui.searchButton.disabled = false;
      ui.stopButton.disabled = true;
    }
  }

  async function checkWorker() {
    try {
      const response = await fetch(`${WORKER_URL}/health`, { headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true) throw new Error('Health check failed');
      setWorkerStatus('Worker online', 'ok');
    } catch {
      setWorkerStatus('Worker needs deploy', 'error');
    }
  }

  function remember(items) {
    if (!ui.rememberSearches.checked) return;
    const existing = readHistory();
    const next = [...items, ...existing].filter((item, index, array) => array.indexOf(item) === index).slice(0, 40);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    renderHistory();
  }

  function readHistory() {
    try {
      const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function renderHistory() {
    const items = readHistory();
    ui.history.innerHTML = items.length
      ? items.map(item => `<button type="button" data-history="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join('')
      : '<span class="history-empty">No locally saved keywords yet.</span>';
  }

  async function copyText(text, message) {
    try {
      await navigator.clipboard.writeText(text);
      ui.queryStatus.textContent = message;
    } catch {
      window.prompt('Copy text', text);
    }
  }

  function exportRows() {
    return visibleResults().map(item => ({
      query: lastQuery,
      company: item.company,
      cik: item.cik,
      form: item.form,
      filed: item.filed,
      period_of_report: item.period_of_report,
      accession: item.accession,
      filename: item.filename,
      context: item.context,
      filing_url: item.filing_url,
      filing_index_url: item.filing_index_url
    }));
  }

  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  ui.searchButton.addEventListener('click', search);
  ui.stopButton.addEventListener('click', () => controller?.abort());
  ui.copyQuery.addEventListener('click', () => {
    const items = validateKeywords();
    if (items) copyText(buildQuery(items), 'Query copied');
  });

  ui.resultFilter.addEventListener('input', renderResults);
  ui.sortResults.addEventListener('change', renderResults);
  ui.keywords.addEventListener('input', updateStats);

  ui.loadExample.addEventListener('click', () => {
    ui.keywords.value = ['launcher', '4G16311', 'F34601-99-D-0002', 'government furnished material'].join('\n');
    updateStats();
    setProgress(0, 'Examples loaded');
  });

  ui.exportCsv.addEventListener('click', () => {
    const rows = exportRows();
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(','), ...rows.map(row => headers.map(key => csvEscape(row[key])).join(','))].join('\r\n');
    download(`edgar-hunter-${new Date().toISOString().slice(0, 10)}.csv`, `\ufeff${csv}`, 'text/csv;charset=utf-8');
  });

  ui.exportJson.addEventListener('click', () => {
    download(`edgar-hunter-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ query: lastQuery, total: secTotal, results: exportRows() }, null, 2), 'application/json');
  });

  ui.clearHistory.addEventListener('click', () => {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
  });

  ui.history.addEventListener('click', event => {
    const button = event.target.closest('[data-history]');
    if (!button) return;
    const items = keywords();
    if (!items.includes(button.dataset.history)) items.push(button.dataset.history);
    ui.keywords.value = items.join('\n');
    updateStats();
    ui.queryStatus.textContent = `${button.dataset.history} added`;
  });

  ui.results.addEventListener('click', event => {
    const button = event.target.closest('[data-copy]');
    if (button) copyText(button.dataset.copy, 'SEC URL copied');
  });

  renderHistory();
  renderResults();
  updateStats();
  checkWorker();
})();

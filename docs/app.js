(() => {
  'use strict';

  const SEC_SEARCH_API = 'https://efts.sec.gov/LATEST/search-index';
  const SEC_FULL_TEXT = 'https://www.sec.gov/edgar/search/';
  const REQUEST_DELAY_MS = 350;
  const HISTORY_KEY = 'edgarHunterHistoryV1';

  const SIGNALS = [
    ['government furnished', 12], ['gfm', 8], ['gfp', 8], ['government property', 8],
    ['nsn', 12], ['national stock number', 12], ['cage', 10], ['milstrip', 14],
    ['dfars', 10], ['far ', 5], ['subcontract', 8], ['contract number', 7],
    ['air force', 7], ['army', 5], ['navy', 5], ['department of defense', 8], ['dod', 6],
    ['logistics', 6], ['sustainment', 8], ['repair', 4], ['overhaul', 6], ['depot', 6],
    ['technical data', 5], ['configuration management', 6], ['special tooling', 7],
    ['spare parts', 7], ['supply', 3], ['weapon system', 8], ['missile', 8], ['aircraft', 5],
    ['exhibit 10', 7], ['material contract', 7], ['statement of work', 7], ['sow', 4]
  ];

  const $ = (id) => document.getElementById(id);
  const ui = {
    queries: $('queries'), startDate: $('startDate'), endDate: $('endDate'), forms: $('forms'), limit: $('limit'),
    exactPhrase: $('exactPhrase'), defenseOnly: $('defenseOnly'), rememberSearches: $('rememberSearches'),
    searchButton: $('searchButton'), stopButton: $('stopButton'), apiStatus: $('apiStatus'), progressText: $('progressText'), progressBar: $('progressBar'),
    targetCount: $('targetCount'), resultCount: $('resultCount'), highCount: $('highCount'), companyCount: $('companyCount'),
    resultFilter: $('resultFilter'), sortResults: $('sortResults'), exportCsv: $('exportCsv'), exportJson: $('exportJson'),
    emptyState: $('emptyState'), results: $('results'), history: $('history'), clearHistory: $('clearHistory'), loadExample: $('loadExample')
  };

  let controller = null;
  let allResults = [];
  let errors = [];

  ui.endDate.value = new Date().toISOString().slice(0, 10);

  function parseTargets() {
    return [...new Set(ui.queries.value.split(/\r?\n/).map(v => v.trim()).filter(Boolean))];
  }

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const id = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(id);
        reject(new DOMException('Search stopped', 'AbortError'));
      }, { once: true });
    });
  }

  function setStatus(text, kind = '') {
    ui.apiStatus.textContent = text;
    ui.apiStatus.className = `status-pill ${kind}`.trim();
  }

  function setProgress(done, total, label) {
    const percent = total ? Math.round((done / total) * 100) : 0;
    ui.progressBar.style.width = `${percent}%`;
    ui.progressText.textContent = label;
  }

  function normalizeAccession(value) {
    const text = String(value || '').trim();
    const match = text.match(/\d{10}-\d{2}-\d{6}/);
    return match ? match[0] : text;
  }

  function first(value) {
    return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
  }

  function stripHtml(text) {
    const temp = document.createElement('div');
    temp.innerHTML = String(text || '');
    return (temp.textContent || temp.innerText || '').replace(/\s+/g, ' ').trim();
  }

  function sourceText(hit, target) {
    const src = hit?._source || {};
    const highlighted = hit?.highlight ? Object.values(hit.highlight).flat().join(' … ') : '';
    return stripHtml([
      highlighted,
      src.entity_name,
      first(src.display_names),
      src.form_type,
      src.root_forms,
      src.file_num,
      target
    ].filter(Boolean).join(' | '));
  }

  function classifyTarget(target) {
    if (/^\d{4}-\d{2}-\d{3}-\d{4}$/.test(target)) return 'NSN';
    if (/^\d{13}$/.test(target.replace(/[- ]/g, ''))) return 'NSN';
    if (/^[A-Z0-9]{5}$/i.test(target)) return 'CAGE / short identifier';
    if (/^[A-Z]\d{4,6}-\d{2}-[A-Z]-\d{4,}$/i.test(target) || /[A-Z]\d{5}-\d{2}-D-\d{4}/i.test(target)) return 'Contract';
    if (/^(?=.*\d)(?=.*[A-Z])[A-Z0-9][A-Z0-9_.\/-]{4,}$/i.test(target)) return 'Part number';
    return 'Term';
  }

  function scoreHit(hit, target) {
    const src = hit?._source || {};
    const text = sourceText(hit, target).toLowerCase();
    const targetLower = target.toLowerCase();
    let score = 18;
    const signals = [];

    if (text.includes(targetLower)) score += 28;
    const targetType = classifyTarget(target);
    if (targetType === 'Part number' || targetType === 'NSN' || targetType === 'Contract') score += 10;

    const form = String(src.form_type || '').toUpperCase();
    if (form.startsWith('EX-10')) { score += 18; signals.push('Exhibit 10'); }
    else if (['10-K', '10-Q', '8-K', 'S-1', 'S-3'].includes(form)) score += 5;

    for (const [term, points] of SIGNALS) {
      if (text.includes(term)) {
        score += points;
        signals.push(term.toUpperCase());
      }
    }

    score = Math.min(100, score);
    return { score, signals: [...new Set(signals)].slice(0, 8), targetType };
  }

  function filingUrl(src, hit) {
    const cik = String(first(src.ciks) || src.cik || '').replace(/^0+/, '');
    const accession = normalizeAccession(src.file_num || hit?._id || '');
    const accessionFolder = accession.replace(/-/g, '');
    if (cik && /^\d{10}-\d{2}-\d{6}$/.test(accession)) {
      return `https://www.sec.gov/Archives/edgar/data/${encodeURIComponent(cik)}/${accessionFolder}/${accession}-index.html`;
    }
    return SEC_FULL_TEXT;
  }

  function makeSearchUrl(target) {
    const params = new URLSearchParams();
    params.set('q', target);
    if (ui.startDate.value) params.set('dateRange', 'custom');
    if (ui.startDate.value) params.set('startdt', ui.startDate.value);
    if (ui.endDate.value) params.set('enddt', ui.endDate.value);
    if (ui.forms.value) params.set('forms', ui.forms.value);
    params.set('from', '0');
    params.set('size', ui.limit.value);
    return `${SEC_SEARCH_API}?${params.toString()}`;
  }

  function makeSecFallbackUrl(target) {
    const params = new URLSearchParams();
    params.set('q', ui.exactPhrase.checked ? `"${target}"` : target);
    if (ui.startDate.value) params.set('dateRange', 'custom');
    if (ui.startDate.value) params.set('startdt', ui.startDate.value);
    if (ui.endDate.value) params.set('enddt', ui.endDate.value);
    return `${SEC_FULL_TEXT}#/${params.toString()}`;
  }

  async function searchTarget(target, signal) {
    const query = ui.exactPhrase.checked ? `"${target}"` : target;
    const url = makeSearchUrl(query);
    const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`SEC search returned HTTP ${response.status}`);
    const data = await response.json();
    const hits = data?.hits?.hits || [];
    return hits.map((hit, index) => {
      const src = hit?._source || {};
      const ranked = scoreHit(hit, target);
      const company = first(src.display_names) || src.entity_name || 'Unknown filer';
      const accession = normalizeAccession(src.file_num || hit?._id || '');
      return {
        id: `${target}-${accession}-${index}`,
        target,
        targetType: ranked.targetType,
        score: ranked.score,
        signals: ranked.signals,
        company: String(company),
        cik: String(first(src.ciks) || src.cik || ''),
        form: String(src.form_type || 'Unknown form'),
        filed: String(src.file_date || ''),
        period: String(src.period_of_report || ''),
        accession,
        context: sourceText(hit, target) || `EDGAR full text match for ${target}`,
        url: filingUrl(src, hit),
        secSearchUrl: makeSecFallbackUrl(target)
      };
    });
  }

  function relevanceClass(score) {
    if (score >= 70) return 'high';
    if (score >= 45) return 'medium';
    return 'low';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }

  function visibleResults() {
    const filter = ui.resultFilter.value.trim().toLowerCase();
    let results = allResults.filter(item => {
      if (ui.defenseOnly.checked && item.signals.length === 0) return false;
      if (!filter) return true;
      return [item.target, item.company, item.cik, item.form, item.accession, item.context, item.signals.join(' ')].join(' ').toLowerCase().includes(filter);
    });

    const mode = ui.sortResults.value;
    results = [...results].sort((a, b) => {
      if (mode === 'date') return b.filed.localeCompare(a.filed) || b.score - a.score;
      if (mode === 'company') return a.company.localeCompare(b.company) || b.score - a.score;
      return b.score - a.score || b.filed.localeCompare(a.filed);
    });
    return results;
  }

  function render() {
    const results = visibleResults();
    ui.targetCount.textContent = String(new Set(allResults.map(r => r.target)).size || parseTargets().length);
    ui.resultCount.textContent = String(results.length);
    ui.highCount.textContent = String(results.filter(r => r.score >= 70).length);
    ui.companyCount.textContent = String(new Set(results.map(r => r.company)).size);
    ui.exportCsv.disabled = allResults.length === 0;
    ui.exportJson.disabled = allResults.length === 0;
    ui.emptyState.hidden = allResults.length > 0 || errors.length > 0;

    const cards = results.map(item => {
      const kind = relevanceClass(item.score);
      const badges = [item.targetType, ...item.signals].map((tag, i) => `<span class="badge ${i ? 'signal' : ''}">${escapeHtml(tag)}</span>`).join('');
      return `
        <article class="result-card">
          <div class="score ${kind}"><strong>${item.score}</strong><small>score</small></div>
          <div class="result-main">
            <h3>${escapeHtml(item.company)}</h3>
            <div class="result-meta">
              <span>${escapeHtml(item.form)}</span>
              <span>Filed ${escapeHtml(item.filed || 'unknown')}</span>
              ${item.cik ? `<span>CIK ${escapeHtml(item.cik)}</span>` : ''}
              ${item.accession ? `<span>${escapeHtml(item.accession)}</span>` : ''}
            </div>
            <div class="match-line"><strong>Matched ${escapeHtml(item.target)}:</strong> ${escapeHtml(item.context)}</div>
            <div class="badges">${badges}</div>
          </div>
          <div class="result-links">
            <a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Open filing ↗</a>
            <a href="${escapeHtml(item.secSearchUrl)}" target="_blank" rel="noreferrer">SEC search ↗</a>
            <button class="copy-button" type="button" data-copy="${escapeHtml(item.url)}">Copy URL</button>
          </div>
        </article>`;
    });

    const errorCards = errors.map(error => `<div class="error-card"><strong>${escapeHtml(error.target)}</strong>: ${escapeHtml(error.message)} <a href="${escapeHtml(error.url)}" target="_blank" rel="noreferrer">Open this search directly on SEC.gov ↗</a></div>`);
    ui.results.innerHTML = [...errorCards, ...cards].join('');
  }

  function updateHistory(targets) {
    if (!ui.rememberSearches.checked) return;
    const existing = readHistory();
    const next = [...targets, ...existing].filter((value, index, array) => array.indexOf(value) === index).slice(0, 30);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    renderHistory();
  }

  function readHistory() {
    try {
      const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function renderHistory() {
    const history = readHistory();
    if (!history.length) {
      ui.history.innerHTML = '<span class="history-empty">No locally saved search targets yet.</span>';
      return;
    }
    ui.history.innerHTML = history.map(target => `<button type="button" data-history="${escapeHtml(target)}">${escapeHtml(target)}</button>`).join('');
  }

  async function runSearch() {
    const targets = parseTargets();
    if (!targets.length) {
      ui.queries.focus();
      setStatus('Enter a target', 'error');
      return;
    }

    controller?.abort();
    controller = new AbortController();
    allResults = [];
    errors = [];
    ui.searchButton.disabled = true;
    ui.stopButton.disabled = false;
    setStatus('Searching', 'busy');
    setProgress(0, targets.length, `Preparing ${targets.length} target${targets.length === 1 ? '' : 's'}`);
    render();
    updateHistory(targets);

    let completed = 0;
    try {
      for (const target of targets) {
        if (controller.signal.aborted) break;
        setProgress(completed, targets.length, `Searching ${target}`);
        try {
          const matches = await searchTarget(target, controller.signal);
          allResults.push(...matches);
        } catch (error) {
          if (error?.name === 'AbortError') throw error;
          errors.push({ target, message: `${error.message}. Your browser may be blocking cross origin EDGAR search requests.`, url: makeSecFallbackUrl(target) });
        }
        completed += 1;
        setProgress(completed, targets.length, `${completed} of ${targets.length} targets complete`);
        render();
        if (completed < targets.length) await sleep(REQUEST_DELAY_MS, controller.signal);
      }

      if (controller.signal.aborted) {
        setStatus('Stopped', 'error');
        setProgress(completed, targets.length, `Stopped after ${completed} of ${targets.length} targets`);
      } else if (errors.length && !allResults.length) {
        setStatus('SEC browser block', 'error');
        setProgress(targets.length, targets.length, 'Use the direct SEC search links below');
      } else {
        setStatus('Complete', 'ok');
        setProgress(targets.length, targets.length, `${allResults.length} matches collected`);
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        setStatus('Stopped', 'error');
        setProgress(completed, targets.length, `Stopped after ${completed} of ${targets.length} targets`);
      } else {
        errors.push({ target: 'Search', message: error.message || String(error), url: SEC_FULL_TEXT });
        setStatus('Error', 'error');
      }
    } finally {
      ui.searchButton.disabled = false;
      ui.stopButton.disabled = true;
      controller = null;
      render();
    }
  }

  function exportRows() {
    return visibleResults().map(item => ({
      matched_target: item.target,
      target_type: item.targetType,
      relevance_score: item.score,
      company: item.company,
      cik: item.cik,
      form: item.form,
      filed: item.filed,
      period_of_report: item.period,
      accession_number: item.accession,
      defense_signals: item.signals.join('; '),
      context: item.context,
      filing_url: item.url,
      sec_search_url: item.secSearchUrl
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

  function exportCsv() {
    const rows = exportRows();
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(','), ...rows.map(row => headers.map(key => csvEscape(row[key])).join(','))].join('\r\n');
    download(`edgar-part-hunter-${new Date().toISOString().slice(0, 10)}.csv`, `\ufeff${csv}`, 'text/csv;charset=utf-8');
  }

  function exportJson() {
    const payload = {
      exported_at: new Date().toISOString(),
      source: 'SEC EDGAR full text search',
      targets: parseTargets(),
      results: exportRows()
    };
    download(`edgar-part-hunter-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
  }

  ui.searchButton.addEventListener('click', runSearch);
  ui.stopButton.addEventListener('click', () => controller?.abort());
  ui.resultFilter.addEventListener('input', render);
  ui.sortResults.addEventListener('change', render);
  ui.defenseOnly.addEventListener('change', render);
  ui.exportCsv.addEventListener('click', exportCsv);
  ui.exportJson.addEventListener('click', exportJson);
  ui.clearHistory.addEventListener('click', () => { localStorage.removeItem(HISTORY_KEY); renderHistory(); });
  ui.loadExample.addEventListener('click', () => {
    ui.queries.value = ['4G16311', 'F34601-99-D-0002', 'T56', 'government furnished material'].join('\n');
    ui.targetCount.textContent = '4';
  });
  ui.queries.addEventListener('input', () => { if (!allResults.length) ui.targetCount.textContent = String(parseTargets().length); });
  ui.queries.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') runSearch();
  });
  ui.results.addEventListener('click', async event => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      const old = button.textContent;
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = old; }, 900);
    } catch {
      window.prompt('Copy filing URL', button.dataset.copy);
    }
  });
  ui.history.addEventListener('click', event => {
    const button = event.target.closest('[data-history]');
    if (!button) return;
    const current = parseTargets();
    if (!current.includes(button.dataset.history)) current.push(button.dataset.history);
    ui.queries.value = current.join('\n');
    ui.targetCount.textContent = String(current.length);
    ui.queries.focus();
  });

  renderHistory();
  render();
})();

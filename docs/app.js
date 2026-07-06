(() => {
  'use strict';

  const SEC_SEARCH = 'https://www.sec.gov/edgar/search/';
  const HISTORY_KEY = 'edgarKeywordHistoryV2';

  const $ = (id) => document.getElementById(id);
  const ui = {
    keywords: $('keywords'),
    excludeKeywords: $('excludeKeywords'),
    matchMode: $('matchMode'),
    forms: $('forms'),
    startDate: $('startDate'),
    endDate: $('endDate'),
    rememberSearches: $('rememberSearches'),
    openNewTab: $('openNewTab'),
    searchCombined: $('searchCombined'),
    buildQueue: $('buildQueue'),
    copyQuery: $('copyQuery'),
    queryStatus: $('queryStatus'),
    keywordCount: $('keywordCount'),
    excludeCount: $('excludeCount'),
    searchCount: $('searchCount'),
    modeLabel: $('modeLabel'),
    openAll: $('openAll'),
    clearQueue: $('clearQueue'),
    emptyState: $('emptyState'),
    results: $('results'),
    history: $('history'),
    clearHistory: $('clearHistory'),
    loadExample: $('loadExample')
  };

  let queue = [];
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
    let query = '';

    if (mode === 'exact') {
      query = items.map(quote).join(' OR ');
    } else if (mode === 'all') {
      query = items.map(item => `(${item})`).join(' AND ');
    } else {
      query = items.map(item => `(${item})`).join(' OR ');
    }

    const blocked = exclusions();
    if (blocked.length) {
      query += blocked.map(item => ` NOT ${quote(item)}`).join('');
    }

    return query.trim();
  }

  function buildSecUrl(query) {
    const params = new URLSearchParams();
    params.set('q', query);
    if (ui.startDate.value || ui.endDate.value) params.set('dateRange', 'custom');
    if (ui.startDate.value) params.set('startdt', ui.startDate.value);
    if (ui.endDate.value) params.set('enddt', ui.endDate.value);
    if (ui.forms.value) params.set('forms', ui.forms.value);
    return `${SEC_SEARCH}#/${params.toString()}`;
  }

  function openUrl(url) {
    if (ui.openNewTab.checked) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      window.location.href = url;
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
  }

  function updateStats() {
    ui.keywordCount.textContent = String(keywords().length);
    ui.excludeCount.textContent = String(exclusions().length);
    ui.searchCount.textContent = String(queue.length);
    ui.modeLabel.textContent = ui.matchMode.value.toUpperCase();
    ui.openAll.disabled = queue.length === 0;
    ui.clearQueue.disabled = queue.length === 0;
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

  function renderQueue() {
    ui.emptyState.hidden = queue.length > 0;
    ui.results.innerHTML = queue.map((item, index) => `
      <article class="result-card">
        <div class="score high"><strong>${String(index + 1).padStart(2, '0')}</strong><small>search</small></div>
        <div class="result-main">
          <h3>${escapeHtml(item.label)}</h3>
          <div class="result-meta">
            <span>${escapeHtml(ui.forms.options[ui.forms.selectedIndex].text)}</span>
            <span>${escapeHtml(ui.matchMode.options[ui.matchMode.selectedIndex].text)}</span>
          </div>
          <div class="match-line"><strong>SEC query:</strong> ${escapeHtml(item.query)}</div>
          <div class="badges"><span class="badge signal">SEC.GOV</span><span class="badge">NO API</span></div>
        </div>
        <div class="result-links">
          <button class="copy-button" type="button" data-open="${escapeHtml(item.url)}">Search SEC ↗</button>
          <button class="copy-button" type="button" data-copy="${escapeHtml(item.query)}">Copy query</button>
          <button class="copy-button" type="button" data-remove="${index}">Remove</button>
        </div>
      </article>`).join('');
    updateStats();
  }

  function validateKeywords() {
    const items = keywords();
    if (!items.length) {
      ui.queryStatus.textContent = 'Enter at least one keyword';
      ui.keywords.focus();
      return null;
    }
    return items;
  }

  function buildIndividualQueue() {
    const items = validateKeywords();
    if (!items) return;

    queue = items.map(item => {
      const query = buildQuery([item]);
      return { label: item, query, url: buildSecUrl(query) };
    });

    remember(items);
    ui.queryStatus.textContent = `${queue.length} SEC searches ready`;
    renderQueue();
  }

  function searchCombined() {
    const items = validateKeywords();
    if (!items) return;

    const query = buildQuery(items);
    remember(items);
    ui.queryStatus.textContent = `Opening combined search for ${items.length} keyword${items.length === 1 ? '' : 's'}`;
    openUrl(buildSecUrl(query));
  }

  async function copyText(text, successMessage) {
    try {
      await navigator.clipboard.writeText(text);
      ui.queryStatus.textContent = successMessage;
    } catch {
      window.prompt('Copy text', text);
    }
  }

  ui.searchCombined.addEventListener('click', searchCombined);
  ui.buildQueue.addEventListener('click', buildIndividualQueue);
  ui.copyQuery.addEventListener('click', () => {
    const items = validateKeywords();
    if (!items) return;
    copyText(buildQuery(items), 'Query copied');
  });

  ui.openAll.addEventListener('click', () => {
    if (!queue.length) return;
    queue.forEach(item => window.open(item.url, '_blank', 'noopener,noreferrer'));
    ui.queryStatus.textContent = `Opened ${queue.length} SEC searches`;
  });

  ui.clearQueue.addEventListener('click', () => {
    queue = [];
    ui.queryStatus.textContent = 'Search queue cleared';
    renderQueue();
  });

  ui.loadExample.addEventListener('click', () => {
    ui.keywords.value = ['4G16311', 'F34601-99-D-0002', 'T56', 'government furnished material'].join('\n');
    updateStats();
    ui.queryStatus.textContent = 'Examples loaded';
  });

  ui.keywords.addEventListener('input', updateStats);
  ui.excludeKeywords.addEventListener('input', updateStats);
  ui.matchMode.addEventListener('change', updateStats);

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
    const openButton = event.target.closest('[data-open]');
    if (openButton) {
      openUrl(openButton.dataset.open);
      return;
    }

    const copyButton = event.target.closest('[data-copy]');
    if (copyButton) {
      copyText(copyButton.dataset.copy, 'Query copied');
      return;
    }

    const removeButton = event.target.closest('[data-remove]');
    if (removeButton) {
      queue.splice(Number(removeButton.dataset.remove), 1);
      renderQueue();
      ui.queryStatus.textContent = 'Search removed';
    }
  });

  renderHistory();
  renderQueue();
  updateStats();
})();

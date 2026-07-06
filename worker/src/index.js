const SEC_SEARCH_ENDPOINT = 'https://efts.sec.gov/LATEST/search-index';
const SEC_ARCHIVES = 'https://www.sec.gov/Archives/edgar/data';
const DEFAULT_USER_AGENT = 'DeerSpotter EDGAR-Part-Number-Hunter https://github.com/DeerSpotter/EDGAR-Part-Number-Hunter';
const MAX_RESULTS = 100;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'GET') {
      return json({ error: 'Method not allowed' }, 405);
    }

    const url = new URL(request.url);

    if (url.pathname === '/' || url.pathname === '/health') {
      return json({
        ok: true,
        service: 'EDGAR Part Number Hunter',
        build: 'worker-6-sec-fair-access',
        endpoint: '/search?q=launcher',
      });
    }

    if (url.pathname !== '/search') {
      return json({ error: 'Not found' }, 404);
    }

    const query = (url.searchParams.get('q') || '').trim();
    if (!query) {
      return json({ error: 'Missing q search parameter' }, 400);
    }

    const startDate = cleanDate(url.searchParams.get('startdt'));
    const endDate = cleanDate(url.searchParams.get('enddt'));
    const forms = cleanForms(url.searchParams.get('forms'));
    const from = clampNumber(url.searchParams.get('from'), 0, 10000, 0);
    const size = clampNumber(url.searchParams.get('size'), 1, MAX_RESULTS, 50);

    const secUrl = new URL(SEC_SEARCH_ENDPOINT);
    secUrl.searchParams.set('q', query);
    secUrl.searchParams.set('from', String(from));
    secUrl.searchParams.set('count', String(size));

    if (startDate || endDate) secUrl.searchParams.set('dateRange', 'custom');
    if (startDate) secUrl.searchParams.set('startdt', startDate);
    if (endDate) secUrl.searchParams.set('enddt', endDate);
    if (forms) secUrl.searchParams.set('forms', forms);

    const cacheKey = new Request(url.toString(), request);
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    try {
      const response = await fetch(secUrl.toString(), {
        redirect: 'follow',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'User-Agent': env.SEC_USER_AGENT || DEFAULT_USER_AGENT,
        },
      });

      if (!response.ok) {
        const body = await response.text();
        return json({
          error: `SEC EDGAR returned HTTP ${response.status}`,
          upstream_status: response.status,
          upstream_excerpt: body.slice(0, 500),
          worker_build: 'worker-6-sec-fair-access',
          note: response.status === 403
            ? 'SEC refused the Worker request. This Worker uses the SEC documented declared User-Agent and gzip/deflate request headers.'
            : '',
        }, 502);
      }

      const payload = await response.json();
      const hits = Array.isArray(payload?.hits?.hits) ? payload.hits.hits : [];
      const total = Number(payload?.hits?.total?.value || 0);
      const results = hits.map(normalizeHit);

      const output = json({
        query,
        total,
        from,
        size,
        returned: results.length,
        worker_build: 'worker-6-sec-fair-access',
        results,
      });

      output.headers.set('Cache-Control', 'public, max-age=60');
      ctx.waitUntil(cache.put(cacheKey, output.clone()));
      return output;
    } catch (error) {
      return json({
        error: 'Worker could not search SEC EDGAR',
        detail: error instanceof Error ? error.message : String(error),
        worker_build: 'worker-6-sec-fair-access',
      }, 502);
    }
  },
};

function normalizeHit(hit) {
  const source = hit?._source || {};
  const hitId = String(hit?._id || '');
  const accession = extractAccession(source.file_num || source.adsh || hitId);
  const accessionFolder = accession.replace(/-/g, '');
  const cik = String(first(source.ciks) || source.cik || '').replace(/^0+/, '');
  const filename = extractFilename(hitId, source);
  const company = String(first(source.display_names) || source.entity_name || 'Unknown filer');
  const context = extractContext(hit);

  let filingUrl = '';
  let filingIndexUrl = '';
  if (cik && accessionFolder) {
    filingIndexUrl = `${SEC_ARCHIVES}/${encodeURIComponent(cik)}/${accessionFolder}/${accession}-index.html`;
    filingUrl = filename
      ? `${SEC_ARCHIVES}/${encodeURIComponent(cik)}/${accessionFolder}/${encodeURIComponent(filename)}`
      : filingIndexUrl;
  }

  return {
    company,
    cik,
    form: String(source.form_type || source.form || ''),
    filed: String(source.file_date || ''),
    period_of_report: String(source.period_of_report || source.period_ending || ''),
    accession,
    filename,
    context,
    filing_url: filingUrl,
    filing_index_url: filingIndexUrl,
  };
}

function extractContext(hit) {
  const highlight = hit?.highlight || {};
  const snippets = Object.values(highlight)
    .flat()
    .map(stripMarkup)
    .filter(Boolean);

  if (snippets.length) return snippets.slice(0, 3).join(' … ');

  const source = hit?._source || {};
  return [source.entity_name, source.form_type || source.form, source.file_num || source.adsh]
    .filter(Boolean)
    .join(' | ');
}

function extractFilename(hitId, source) {
  const colonIndex = hitId.indexOf(':');
  if (colonIndex >= 0) {
    const value = hitId.slice(colonIndex + 1).trim();
    if (/\.(txt|htm|html|xml|pdf)$/i.test(value)) return value;
  }

  const candidates = [source.file_name, source.filename, source.document_name];
  return String(candidates.find(value => typeof value === 'string' && value.trim()) || '');
}

function extractAccession(value) {
  const match = String(value || '').match(/\d{10}-\d{2}-\d{6}/);
  return match ? match[0] : '';
}

function stripMarkup(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function cleanDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function cleanForms(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(item => /^[A-Z0-9-]+$/i.test(item))
    .slice(0, 20)
    .join(',');
}

function clampNumber(value, min, max, fallback) {
  const number = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

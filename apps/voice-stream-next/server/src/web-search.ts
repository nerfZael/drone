export type WebSearchRecencyFilter = 'day' | 'week' | 'month' | 'year';

export type WebSearchInput = {
  query: string;
  numResults?: number;
  recencyFilter?: WebSearchRecencyFilter;
  domainFilter?: string[];
  timeoutMs?: number;
};

export type WebSearchResult = {
  ok: true;
  provider: 'exa';
  query: string;
  answer: string;
  results: WebSearchResultItem[];
  elapsedMs: number;
};

export type WebSearchResultItem = {
  title: string;
  url: string;
  snippet: string;
  publishedDate: string | null;
  author: string | null;
};

export type FetchContentLivecrawl = 'never' | 'fallback' | 'preferred' | 'always';

export type FetchContentInput = {
  url: string;
  maxCharacters?: number;
  livecrawl?: FetchContentLivecrawl;
  timeoutMs?: number;
};

export type FetchContentResult = {
  ok: true;
  provider: 'exa';
  url: string;
  title: string;
  content: string;
  answer: string;
  publishedDate: string | null;
  author: string | null;
  status: FetchContentStatus | null;
  elapsedMs: number;
};

export type FetchContentStatus = {
  id: string;
  status: string;
  error: {
    tag: string;
    httpStatusCode: number | null;
  } | null;
};

type ExaSearchResponse = {
  results?: Array<{
    title?: string;
    url?: string;
    publishedDate?: string;
    author?: string;
    text?: string;
    highlights?: unknown;
  }>;
};

type ExaContentsResponse = {
  results?: Array<{
    title?: string;
    url?: string;
    publishedDate?: string;
    author?: string;
    text?: string;
  }>;
  statuses?: Array<{
    id?: string;
    status?: string;
    error?: {
      tag?: string;
      httpStatusCode?: number;
    };
  }>;
};

const EXA_SEARCH_URL = 'https://api.exa.ai/search';
const EXA_CONTENTS_URL = 'https://api.exa.ai/contents';
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_CONTENT_TIMEOUT_MS = 15_000;

export async function searchWeb(input: WebSearchInput, apiKey: string): Promise<WebSearchResult> {
  if (!apiKey.trim()) throw Object.assign(new Error('Exa API key is not configured. Add your Exa key in assistant settings.'), { statusCode: 400 });
  const query = String(input.query ?? '').trim();
  if (!query) throw Object.assign(new Error('web search query is required'), { statusCode: 400 });

  const startedAt = Date.now();
  const response = await fetch(EXA_SEARCH_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query,
      type: 'auto',
      numResults: clampNumResults(input.numResults),
      ...domainFilters(input.domainFilter),
      ...(input.recencyFilter ? { startPublishedDate: recencyStartDate(input.recencyFilter) } : {}),
      contents: {
        text: { maxCharacters: 1200 },
        highlights: true,
      },
    }),
    signal: signalWithTimeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  const bodyText = await response.text();
  let body: ExaSearchResponse = {};
  try {
    body = bodyText ? JSON.parse(bodyText) as ExaSearchResponse : {};
  } catch {
    body = {};
  }
  if (!response.ok) {
    const message = providerError(bodyText, `Exa search failed: ${response.status}`);
    throw Object.assign(new Error(message), { statusCode: response.status });
  }

  const results = mapResults(body.results);
  return {
    ok: true,
    provider: 'exa',
    query,
    answer: buildAnswer(results),
    results,
    elapsedMs: Date.now() - startedAt,
  };
}

export async function fetchContent(input: FetchContentInput, apiKey: string): Promise<FetchContentResult> {
  if (!apiKey.trim()) throw Object.assign(new Error('Exa API key is not configured. Add your Exa key in assistant settings.'), { statusCode: 400 });
  const url = cleanHttpUrl(input.url);
  const startedAt = Date.now();
  const response = await fetch(EXA_CONTENTS_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      urls: [url],
      text: { maxCharacters: clampMaxCharacters(input.maxCharacters) },
      ...maxAgeHoursForLivecrawl(input.livecrawl),
      livecrawlTimeout: 12_000,
    }),
    signal: signalWithTimeout(input.timeoutMs ?? DEFAULT_CONTENT_TIMEOUT_MS),
  });

  const bodyText = await response.text();
  let body: ExaContentsResponse = {};
  try {
    body = bodyText ? JSON.parse(bodyText) as ExaContentsResponse : {};
  } catch {
    body = {};
  }
  if (!response.ok) {
    const message = providerError(bodyText, `Exa contents fetch failed: ${response.status}`);
    throw Object.assign(new Error(message), { statusCode: response.status });
  }

  const item = Array.isArray(body.results) ? body.results[0] : undefined;
  const status = mapStatus(Array.isArray(body.statuses) ? body.statuses[0] : undefined);
  const title = String(item?.title ?? '').trim() || url;
  const content = String(item?.text ?? '').trim();
  return {
    ok: true,
    provider: 'exa',
    url: String(item?.url ?? '').trim() || url,
    title,
    content,
    answer: buildContentAnswer({ title, url: String(item?.url ?? '').trim() || url, content, status }),
    publishedDate: cleanNullableString(item?.publishedDate),
    author: cleanNullableString(item?.author),
    status,
    elapsedMs: Date.now() - startedAt,
  };
}

function clampNumResults(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(10, Math.floor(value)));
}

function clampMaxCharacters(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return 12_000;
  return Math.max(1000, Math.min(30_000, Math.floor(value)));
}

function cleanHttpUrl(raw: unknown): string {
  const value = String(raw ?? '').trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw Object.assign(new Error('fetch_content url must be a valid http or https URL'), { statusCode: 400 });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw Object.assign(new Error('fetch_content url must use http or https'), { statusCode: 400 });
  }
  return url.toString();
}

function cleanLivecrawl(raw: unknown): FetchContentLivecrawl {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === 'never' || value === 'preferred' || value === 'always' ? value : 'fallback';
}

function maxAgeHoursForLivecrawl(raw: unknown): { maxAgeHours?: number } {
  const livecrawl = cleanLivecrawl(raw);
  if (livecrawl === 'always') return { maxAgeHours: 0 };
  if (livecrawl === 'never') return { maxAgeHours: -1 };
  if (livecrawl === 'preferred') return { maxAgeHours: 1 };
  return {};
}

function signalWithTimeout(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Math.min(60_000, timeoutMs)));
  (timeout as any).unref?.();
  return controller.signal;
}

function recencyStartDate(filter: WebSearchRecencyFilter): string {
  const daysByFilter: Record<WebSearchRecencyFilter, number> = {
    day: 1,
    week: 7,
    month: 30,
    year: 365,
  };
  return new Date(Date.now() - daysByFilter[filter] * 86_400_000).toISOString();
}

function domainFilters(domainFilter: string[] | undefined): { includeDomains?: string[]; excludeDomains?: string[] } {
  if (!Array.isArray(domainFilter) || domainFilter.length === 0) return {};
  const includeDomains: string[] = [];
  const excludeDomains: string[] = [];
  for (const item of domainFilter) {
    const value = String(item ?? '').trim();
    if (!value) continue;
    if (value.startsWith('-')) {
      const domain = value.slice(1).trim();
      if (domain) excludeDomains.push(domain);
    } else {
      includeDomains.push(value);
    }
  }
  return {
    ...(includeDomains.length > 0 ? { includeDomains } : {}),
    ...(excludeDomains.length > 0 ? { excludeDomains } : {}),
  };
}

function mapResults(raw: ExaSearchResponse['results']): WebSearchResultItem[] {
  if (!Array.isArray(raw)) return [];
  const results: WebSearchResultItem[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index];
    const url = String(item?.url ?? '').trim();
    if (!url) continue;
    const title = String(item?.title ?? '').trim() || `Source ${index + 1}`;
    results.push({
      title,
      url,
      snippet: resultSnippet(item),
      publishedDate: cleanNullableString(item?.publishedDate),
      author: cleanNullableString(item?.author),
    });
  }
  return results;
}

function mapStatus(raw: NonNullable<ExaContentsResponse['statuses']>[number] | undefined): FetchContentStatus | null {
  if (!raw) return null;
  const error = raw.error && typeof raw.error === 'object'
    ? {
        tag: String(raw.error.tag ?? '').trim(),
        httpStatusCode: Number.isFinite(Number(raw.error.httpStatusCode)) ? Number(raw.error.httpStatusCode) : null,
      }
    : null;
  return {
    id: String(raw.id ?? '').trim(),
    status: String(raw.status ?? '').trim(),
    error: error && error.tag ? error : null,
  };
}

function resultSnippet(item: NonNullable<ExaSearchResponse['results']>[number]): string {
  const highlights = Array.isArray(item.highlights)
    ? item.highlights.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];
  const text = highlights.length > 0 ? highlights.join(' ') : String(item.text ?? '').trim();
  return text.replace(/\s+/g, ' ').slice(0, 700);
}

function cleanNullableString(raw: unknown): string | null {
  const value = String(raw ?? '').trim();
  return value || null;
}

function buildAnswer(results: WebSearchResultItem[]): string {
  if (results.length === 0) return 'No web search results found.';
  return results
    .map((result, index) => {
      const date = result.publishedDate ? `, ${result.publishedDate}` : '';
      const snippet = result.snippet ? `\n${result.snippet}` : '';
      return `${index + 1}. ${result.title}${date}\n${result.url}${snippet}`;
    })
    .join('\n\n');
}

function buildContentAnswer(input: { title: string; url: string; content: string; status: FetchContentStatus | null }): string {
  const statusLine = input.status?.status ? `Status: ${input.status.status}` : '';
  const errorLine = input.status?.error ? `Fetch error: ${input.status.error.tag}${input.status.error.httpStatusCode ? ` (${input.status.error.httpStatusCode})` : ''}` : '';
  const content = input.content || 'No readable page content returned.';
  return [`${input.title}\n${input.url}`, statusLine, errorLine, content].filter(Boolean).join('\n\n');
}

function providerError(raw: string, fallback: string): string {
  try {
    const parsed = JSON.parse(raw);
    return parsed?.error?.message ?? parsed?.message ?? fallback;
  } catch {
    return raw.trim() || fallback;
  }
}

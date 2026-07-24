type MermaidApi = (typeof import('mermaid'))['default'];

export type MermaidRenderResult = {
  errorMessage: string;
  svg: string;
};

const MAX_MERMAID_SOURCE_LENGTH = 50_000;
const MAX_MERMAID_SOURCE_LINES = 1_000;
const MAX_CACHED_DIAGRAMS = 48;

const renderCache = new Map<
  string,
  {
    promise: Promise<MermaidRenderResult> | null;
    result: MermaidRenderResult | null;
  }
>();

let mermaidPromise: Promise<MermaidApi> | null = null;
let mermaidRenderQueue: Promise<void> = Promise.resolve();
let mermaidRenderSequence = 0;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceEvery(value: string, search: string, replacement: string): string {
  return value.split(search).join(replacement);
}

function scopeStyleSelectors(svg: string, idMap: ReadonlyMap<string, string>): string {
  return svg.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
    (_style, openingTag: string, css: string, closingTag: string) => {
      const scopedCss = String(css).replace(/([^{}]+)(?=\{)/g, (selector) => {
        let scopedSelector = String(selector);
        for (const [id, nextId] of idMap) {
          scopedSelector = scopedSelector.replace(
            new RegExp(`#${escapeRegExp(id)}(?=$|[^a-zA-Z0-9_-])`, 'g'),
            `#${nextId}`,
          );
        }
        return scopedSelector;
      });
      return `${openingTag}${scopedCss}${closingTag}`;
    },
  );
}

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: 'base',
        darkMode: true,
        themeVariables: {
          background: '#181825',
          primaryColor: '#313244',
          primaryTextColor: '#cdd6f4',
          primaryBorderColor: '#6c7086',
          lineColor: '#9399b2',
          secondaryColor: '#45475a',
          secondaryTextColor: '#cdd6f4',
          secondaryBorderColor: '#7f849c',
          tertiaryColor: '#1e1e2e',
          tertiaryTextColor: '#cdd6f4',
          tertiaryBorderColor: '#585b70',
          noteBkgColor: '#313244',
          noteTextColor: '#cdd6f4',
          noteBorderColor: '#6c7086',
          fontFamily: 'inherit',
        },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

function touchCacheEntry(source: string) {
  const entry = renderCache.get(source);
  if (!entry) return;
  renderCache.delete(source);
  renderCache.set(source, entry);
}

function trimRenderCache() {
  while (renderCache.size > MAX_CACHED_DIAGRAMS) {
    const oldestSource = renderCache.keys().next().value;
    if (typeof oldestSource !== 'string') return;
    renderCache.delete(oldestSource);
  }
}

function sourceLimitError(source: string): string {
  if (
    source.length > MAX_MERMAID_SOURCE_LENGTH ||
    source.split('\n').length > MAX_MERMAID_SOURCE_LINES
  ) {
    return 'This Mermaid diagram is too large to render.';
  }
  return '';
}

function queueMermaidRender(mermaid: MermaidApi, source: string): Promise<string> {
  const renderId = `drone-hub-mermaid-${mermaidRenderSequence++}`;
  const render = mermaidRenderQueue.then(() =>
    mermaid.render(renderId, source).then((result) => result.svg),
  );
  mermaidRenderQueue = render.then(
    () => undefined,
    () => undefined,
  );
  return render;
}

export function getCachedMermaidRender(source: string): MermaidRenderResult | null {
  const entry = renderCache.get(source);
  if (!entry?.result) return null;
  touchCacheEntry(source);
  return entry.result;
}

export function scopeMermaidSvgIds(svg: string, scope: string): string {
  const ids = Array.from(
    new Set(
      Array.from(svg.matchAll(/\sid=(?:"([^"]+)"|'([^']+)')/g), (match) =>
        String(match[1] ?? match[2] ?? ''),
      ).filter(Boolean),
    ),
  ).sort((a, b) => b.length - a.length);
  if (ids.length === 0) return svg;

  const idMap = new Map(ids.map((id) => [id, `${scope}-${id}`]));
  let scoped = scopeStyleSelectors(svg, idMap).replace(
    /\b(aria-labelledby|aria-describedby)=(?:"([^"]*)"|'([^']*)')/g,
    (attribute, _name: string, doubleQuoted: string, singleQuoted: string) => {
      const quote = doubleQuoted == null ? "'" : '"';
      const value = String(doubleQuoted ?? singleQuoted ?? '');
      const nextValue = value
        .split(/\s+/)
        .map((id) => idMap.get(id) ?? id)
        .join(' ');
      return `${String(attribute).split('=')[0]}=${quote}${nextValue}${quote}`;
    },
  );

  for (const id of ids) {
    const nextId = idMap.get(id)!;
    scoped = replaceEvery(scoped, `id="${id}"`, `id="${nextId}"`);
    scoped = replaceEvery(scoped, `id='${id}'`, `id='${nextId}'`);
    scoped = replaceEvery(scoped, `url(#${id})`, `url(#${nextId})`);
    scoped = replaceEvery(scoped, `href="#${id}"`, `href="#${nextId}"`);
    scoped = replaceEvery(scoped, `href='#${id}'`, `href='#${nextId}'`);
  }
  return scoped;
}

export function renderMermaidSource(source: string): Promise<MermaidRenderResult> {
  const cached = renderCache.get(source);
  if (cached?.result) {
    touchCacheEntry(source);
    return Promise.resolve(cached.result);
  }
  if (cached?.promise) {
    touchCacheEntry(source);
    return cached.promise;
  }

  const limitError = sourceLimitError(source);
  if (limitError) {
    const result = { errorMessage: limitError, svg: '' };
    renderCache.set(source, { promise: null, result });
    trimRenderCache();
    return Promise.resolve(result);
  }

  const entry: {
    promise: Promise<MermaidRenderResult> | null;
    result: MermaidRenderResult | null;
  } = {
    promise: null,
    result: null,
  };
  const promise = loadMermaid()
    .then((mermaid) => queueMermaidRender(mermaid, source))
    .then(
      (svg): MermaidRenderResult => ({ errorMessage: '', svg }),
      (): MermaidRenderResult => ({
        errorMessage: 'Could not render this Mermaid diagram. Check the syntax below.',
        svg: '',
      }),
    )
    .then((result) => {
      entry.promise = null;
      entry.result = result;
      if (renderCache.get(source) === entry) touchCacheEntry(source);
      trimRenderCache();
      return result;
    });

  entry.promise = promise;
  renderCache.set(source, entry);
  trimRenderCache();
  return promise;
}

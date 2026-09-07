// Page reports are untrusted and only contribute bounded numeric display data.
const PAGE_FIELDS = [
  'domContentLoadedMs',
  'documentLoadMs',
  'firstContentfulPaintMs',
  'resourceCount',
  'resourceTransferBytes',
  'resourceEncodedBytes',
] as const;

export function parseBrowserLoadDiagnostics(data: string): Record<string, number> | null {
  if (data.length > 2048) return null;
  try {
    const report = JSON.parse(data);
    if (report?.type !== 'drone-browser-load' || !report.metrics) return null;
    const result: Record<string, number> = {};
    for (const key of PAGE_FIELDS) {
      const value = report.metrics[key];
      if (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= Number.MAX_SAFE_INTEGER
      )
        result[key] = Math.round(value);
    }
    return Object.keys(result).length ? result : null;
  } catch {
    return null;
  }
}

// Executed after navigation completes. No URLs, DOM text, headers or bodies cross the bridge.
export const BROWSER_LOAD_DIAGNOSTICS_SCRIPT = `
(function () {
  function report() {
    try {
      var nav = performance.getEntriesByType('navigation')[0];
      var resources = performance.getEntriesByType('resource');
      var paint = performance.getEntriesByType('paint').find(function (e) { return e.name === 'first-contentful-paint'; });
      var metrics = {
        resourceCount: resources.length,
        resourceTransferBytes: resources.reduce(function (sum, e) { return sum + (e.transferSize || 0); }, 0),
        resourceEncodedBytes: resources.reduce(function (sum, e) { return sum + (e.encodedBodySize || 0); }, 0)
      };
      if (nav && nav.domContentLoadedEventEnd > 0) metrics.domContentLoadedMs = nav.domContentLoadedEventEnd;
      if (nav && nav.loadEventEnd > 0) metrics.documentLoadMs = nav.loadEventEnd;
      if (paint) metrics.firstContentfulPaintMs = paint.startTime;
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'drone-browser-load', metrics: metrics }));
      return !!paint;
    } catch (_) { return true; }
  }
  setTimeout(function () {
    if (!report() && typeof PerformanceObserver !== 'undefined') {
      var observer = new PerformanceObserver(function () { if (report()) observer.disconnect(); });
      observer.observe({ type: 'paint', buffered: true });
      setTimeout(function () { observer.disconnect(); }, 30000);
    }
  }, 0);
})(); true;
`;

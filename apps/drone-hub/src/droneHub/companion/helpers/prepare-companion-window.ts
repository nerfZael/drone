import { syncDocumentStyles } from '../../../ui/sync-document-styles';

/** Copy app styling without copying scripts or the main window's custom title bar. */
export function prepareCompanionWindow(source: Document, target: Document): () => void {
  target.title = 'Companion — Drone Hub';
  const base = target.createElement('base');
  base.href = source.baseURI;
  target.head.append(base);
  const copyTheme = () => {
    for (const name of ['class', 'style', 'data-theme']) {
      const value = source.documentElement.getAttribute(name);
      if (value === null) target.documentElement.removeAttribute(name);
      else target.documentElement.setAttribute(name, value);
    }
    target.documentElement.style.setProperty('--companion-max-height', `${Math.max(48, (target.defaultView?.screen.availHeight || 900) - 32)}px`);
    target.body.className = source.body.className;
    target.body.style.cssText = 'margin:0; overflow:hidden; background:transparent';
  };
  const stopStyles = syncDocumentStyles(source, target.head);
  copyTheme();
  const style = target.createElement('style');
  style.textContent = `
    html, body { background: transparent !important; }
    [data-companion-window-panel] aside { max-height: min(36rem, calc(var(--companion-max-height) - 16px)); }
    [data-companion-drag-handle] { -webkit-app-region: drag; }
    [data-companion-drag-handle] button { -webkit-app-region: no-drag; }
  `;
  target.head.append(style);
  const theme = new MutationObserver(copyTheme);
  theme.observe(source.documentElement, { attributes: true });
  theme.observe(source.body, { attributes: true, attributeFilter: ['class'] });
  return () => { stopStyles(); theme.disconnect(); };
}

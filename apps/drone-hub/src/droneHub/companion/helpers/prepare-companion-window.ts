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
    target.body.className = source.body.className;
    target.body.style.cssText = 'margin:0; overflow:auto; background:var(--app-bg, #11161e)';
  };
  const stopStyles = syncDocumentStyles(source, target.head);
  copyTheme();
  const theme = new MutationObserver(copyTheme);
  theme.observe(source.documentElement, { attributes: true });
  theme.observe(source.body, { attributes: true, attributeFilter: ['class'] });
  return () => { stopStyles(); theme.disconnect(); };
}

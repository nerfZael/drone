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
    target.body.style.cssText = 'margin:0; overflow:hidden; background:transparent';
  };
  const stopStyles = syncDocumentStyles(source, target.head);
  copyTheme();
  const style = target.createElement('style');
  // The max height is a conservative limit until the desktop reports the room around the bar;
  // it lives in a stylesheet so theme syncing of the root element's style attribute cannot wipe it.
  style.textContent = `
    :root { --companion-max-height: ${Math.max(48, (target.defaultView?.screen.availHeight || 900) - 32)}px; }
    html, body { background: transparent !important; }
    [data-companion-window-panel] aside { max-height: min(36rem, calc(var(--companion-max-height) - 16px)); }
    [data-companion-drag-handle] { -webkit-app-region: drag; }
    [data-companion-drag-handle] :is(button, a, input, textarea, select, summary, [role="button"]) { -webkit-app-region: no-drag; }
    /* A drag region swallows every pointer event, so text the user should be able to select and copy opts out. */
    [data-companion-selectable], [data-companion-selectable] * { -webkit-app-region: no-drag; }
    /* Drag regions are geometric, not stacked: anything portalled over a drag handle (menus, dialogs,
       tooltips) must opt out or its overlapping part swallows clicks and drags the window instead. */
    [data-radix-popper-content-wrapper], [data-radix-popper-content-wrapper] *, [role="dialog"], [role="dialog"] *, [role="menu"], [role="listbox"], [role="tooltip"] { -webkit-app-region: no-drag; }
  `;
  target.head.append(style);
  const theme = new MutationObserver(copyTheme);
  theme.observe(source.documentElement, { attributes: true });
  theme.observe(source.body, { attributes: true, attributeFilter: ['class'] });
  return () => { stopStyles(); theme.disconnect(); };
}

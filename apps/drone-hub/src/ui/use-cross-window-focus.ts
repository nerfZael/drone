import React from 'react';

/** Radix FocusScope uses the module's document. Floating portals need their own. */
export function useCrossWindowFocus(container?: HTMLElement) {
  const previous = React.useRef<HTMLElement | null>(null);
  const external = Boolean(container && container.ownerDocument !== document);
  return {
    external,
    onOpenAutoFocus(event: Event) {
      if (!external) return;
      const panel = event.target as HTMLElement;
      previous.current = panel.ownerDocument.activeElement as HTMLElement | null;
      event.preventDefault();
      (focusableElements(panel)[0] ?? panel).focus();
    },
    onCloseAutoFocus(event: Event) {
      if (!external) return;
      event.preventDefault();
      if (previous.current?.isConnected) previous.current.focus();
    },
    onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
      if (!external || event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
      const panel = event.currentTarget;
      const items = focusableElements(panel);
      const first = items[0];
      const last = items[items.length - 1];
      const active = panel.ownerDocument.activeElement;
      if (!first) { event.preventDefault(); panel.focus(); }
      else if (event.shiftKey && (active === first || active === panel)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    },
  };
}

function focusableElements(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]'))
    .filter(element => element.tabIndex >= 0 && !element.matches(':disabled, [hidden]') && element.getClientRects().length > 0);
}

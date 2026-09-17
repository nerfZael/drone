import React from 'react';
import { createPortal } from 'react-dom';
import { syncDocumentStyles } from '../../ui/sync-document-styles';

/** Monaco supports shadow-root focus lookup; its global document lookup cannot follow a popup. */
export function PortableEditorHost({ children }: { children: React.ReactNode }) {
  const anchor = React.useRef<HTMLDivElement>(null);
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    const element = anchor.current;
    if (!element) return;
    const shadow = element.shadowRoot ?? element.attachShadow({ mode: 'open' });
    const target = document.createElement('div');
    shadow.append(target);
    const cleanup = syncDocumentStyles(document, shadow);
    setContainer(target);
    return () => { cleanup(); target.remove(); };
  }, []);
  return <div ref={anchor} data-portable-editor="true" style={{ width: '100%' }}>
    {container ? createPortal(children, container) : null}
  </div>;
}

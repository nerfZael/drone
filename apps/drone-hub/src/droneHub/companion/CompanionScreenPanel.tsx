import React from 'react';
import { useCompanionWindow } from './companion-window';
import { createPortal } from 'react-dom';
import ReactMarkdown, { type Components } from 'react-markdown';
import type { CompanionScreen } from '@drone/assistant-chat';

export function CompanionScreenPanel({ screen }: { screen: CompanionScreen }) {
  const { ownerWindow, portalContainer, detached } = useCompanionWindow();
  const state = React.useSyncExternalStore(screen.subscribe, screen.getSnapshot);
  const anchor = React.useRef<HTMLDivElement>(null);
  const measure = React.useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = React.useState({ width: 0, height: 0, bottom: 0, right: 0 });
  React.useLayoutEffect(() => {
    const element = anchor.current;
    const parent = element?.parentElement;
    if (!element || !parent) return;
    const view = ownerWindow ?? window;
    const resize = () => {
      const rect = parent.getBoundingClientRect();
      const viewport = view.visualViewport;
      const width = Math.floor(Math.max(0, Math.min(480, rect.width - 26, (viewport?.width ?? view.innerWidth) - 58)));
      const height = Math.floor(Math.max(0, Math.min(420, detached ? view.innerHeight - 120 : rect.top - (viewport?.offsetTop ?? 0) - 80)));
      setBounds({ width, height, bottom: view.innerHeight - rect.top + 12, right: Math.max(16, view.innerWidth - rect.right) });
      screen.resize(width, height, 'body:14px/22px; headings:22px/28px,19px/25px,16px/22px', { preserveContent: true });
    };
    resize();
    const observer = new ResizeObserver(resize); observer.observe(parent);
    const positionObserver = new MutationObserver(resize); positionObserver.observe(parent, { attributes: true });
    view.addEventListener('resize', resize);
    view.visualViewport?.addEventListener('resize', resize);
    view.visualViewport?.addEventListener('scroll', resize);
    return () => { observer.disconnect(); positionObserver.disconnect(); view.removeEventListener('resize', resize); view.visualViewport?.removeEventListener('resize', resize); view.visualViewport?.removeEventListener('scroll', resize); };
  }, [screen, ownerWindow, detached]);
  React.useEffect(() => () => screen.detach(), [screen]);
  React.useLayoutEffect(() => {
    if (!state.candidate || !measure.current) return;
    const element = measure.current;
    const id = state.candidate.id;
    let cancelled = false;
    void element.ownerDocument.fonts.ready.then(() => {
      if (!cancelled) screen.measured(id, element.scrollWidth, Math.max(element.scrollHeight, Math.ceil(element.getBoundingClientRect().height)));
    });
    return () => { cancelled = true; };
  }, [screen, state.candidate, bounds]);
  const content = (markdown: string) => <ReactMarkdown skipHtml components={markdownComponents}>{markdown}</ReactMarkdown>;
  const display = <div data-companion-surface="true" style={detached ? { position: 'relative', width: '100%', zIndex: 1 } : { position: 'fixed', bottom: bounds.bottom, right: bounds.right, width: bounds.width + 26, zIndex: 101 }}>
    {state.markdown ? <section aria-label="Companion display" style={{ boxSizing: 'border-box', padding: 12, border: '1px solid var(--border-subtle)', borderRadius: 12, background: 'var(--panel-raised, var(--panel))', color: 'var(--text)', maxHeight: detached ? undefined : bounds.height + 48, overflow: 'auto' }}>
      <button type="button" aria-label="Dismiss Companion display" onClick={() => screen.clear()} style={{ display: 'block', marginLeft: 'auto', height: 22, lineHeight: '22px', fontSize: 12 }}>Dismiss</button>
      <div style={{ ...textStyle, width: bounds.width }}>{content(state.markdown)}</div>
    </section> : null}
    {state.candidate ? <div aria-hidden="true" ref={measure} style={{ ...textStyle, position: 'absolute', visibility: 'hidden', width: bounds.width, top: 0, pointerEvents: 'none' }}>{content(state.candidate.markdown)}</div> : null}
  </div>;
  return <><div ref={anchor} style={{ display: 'none' }} />{detached ? display : createPortal(display, portalContainer ?? document.body)}</>;
}

const textStyle: React.CSSProperties = { display: 'flow-root', fontSize: 14, lineHeight: '22px', overflowWrap: 'anywhere' };

const markdownComponents: Components = {
  h1: ({ children }) => <h1 style={{ fontSize: 22, lineHeight: '28px', fontWeight: 700, margin: '8px 0' }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ fontSize: 19, lineHeight: '25px', fontWeight: 700, margin: '8px 0' }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ fontSize: 16, lineHeight: '22px', fontWeight: 700, margin: '6px 0' }}>{children}</h3>,
  p: ({ children }) => <p style={{ margin: '0 0 8px' }}>{children}</p>,
  ul: ({ children }) => <ul style={{ listStyleType: 'disc', paddingLeft: 22, margin: '0 0 8px' }}>{children}</ul>,
  ol: ({ children, start }) => <ol start={start} style={{ listStyleType: 'decimal', paddingLeft: 22, margin: '0 0 8px' }}>{children}</ol>,
  blockquote: ({ children }) => <blockquote style={{ borderLeft: '2px solid var(--border)', paddingLeft: 10 }}>{children}</blockquote>,
  a: ({ children, href }) => <a href={href} style={{ color: 'var(--accent)', textDecoration: 'underline' }}>{children}</a>,
  img: () => null,
};

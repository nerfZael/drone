import React from 'react';
import { createPortal } from 'react-dom';
import { useChatContextMenu } from './use-chat-context-menu';

/** Render an additional chat view exclusively in its native desktop window. */
export function DesktopChatWindow({ chatKey, title, request, onClose, children }: {
  chatKey: string; title: string; request: number; onClose: () => void; children: React.ReactNode;
}) {
  const titleRef = React.useRef(title);
  titleRef.current = title;
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const [host] = React.useState(() => {
    const node = document.createElement('div');
    node.className = 'flex h-full min-h-0 flex-col';
    return node;
  });
  const popup = React.useRef<Window | null>(null);
  const cleanup = React.useRef<(() => void) | null>(null);
  const [outside, setOutside] = React.useState(false);
  const [pinned, setPinned] = React.useState(false);
  const [error, setError] = React.useState('');
  const name = `drone-hub-chat:${chatKey}`;
  React.useLayoutEffect(() => {
    return () => { cleanup.current?.(); host.remove(); };
  }, [host]);
  React.useEffect(() => {
    if (popup.current) popup.current.document.title = title;
  }, [title]);
  const open = React.useCallback(() => {
    if (popup.current && !popup.current.closed) { popup.current.focus(); return; }
    const child = window.open('about:blank', name, 'width=640,height=800');
    if (!child) { setError('Could not open the desktop window. Try again.'); return; }
    setError('');
    popup.current = child;
    child.document.title = titleRef.current;
    const base = child.document.createElement('base');
    base.href = document.baseURI;
    child.document.head.appendChild(base);
    const styles: Node[] = [];
    const syncStyles = () => {
      for (const node of styles) node.parentNode?.removeChild(node);
      styles.length = 0;
      for (const node of document.head.querySelectorAll('style:not([data-drone-hub-desktop-title-bar]), link[rel="stylesheet"]')) {
        const clone = node.cloneNode(true);
        child.document.head.appendChild(clone);
        styles.push(clone);
      }
      for (const attribute of document.documentElement.attributes) {
        if (attribute.name.startsWith('data-') && attribute.name !== 'data-drone-hub-desktop') {
          child.document.documentElement.setAttribute(attribute.name, attribute.value);
        }
      }
      child.document.documentElement.className = document.documentElement.className;
      child.document.documentElement.style.cssText = document.documentElement.style.cssText;
      child.document.body.className = document.body.className;
      child.document.body.style.cssText = 'margin:0;height:100vh;overflow:hidden';
    };
    syncStyles();
    const observer = new MutationObserver(syncStyles);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    observer.observe(document.documentElement, { attributes: true });
    child.document.body.appendChild(host);
    setOutside(true);
    setPinned(false);
    const closed = () => {
      observer.disconnect();
      child.removeEventListener('beforeunload', closed);
      popup.current = null;
      cleanup.current = null;
      setOutside(false);
      setPinned(false);
      onCloseRef.current();
    };
    child.addEventListener('beforeunload', closed);
    cleanup.current = () => {
      observer.disconnect();
      child.removeEventListener('beforeunload', closed);
      popup.current = null;
      child.close();
    };
    child.focus();
  }, [host, name]);
  React.useEffect(() => {
    open();
  }, [request, open]);
  const togglePin = async () => {
    try {
      const value = await window.droneHubDesktop?.setChatWindowAlwaysOnTop?.(name, !pinned);
      if (popup.current) setPinned(value === true);
    } catch { setError('Could not change always-on-top. Try again.'); }
  };
  // The OS title bar already names the chat and closes the window, so the one
  // window option lives behind right-click instead of a header of its own.
  const contextMenu = useChatContextMenu(`Window options for ${title}`, () => [
    { id: 'always-on-top', label: 'Always on top', checked: pinned, onSelect: () => void togglePin() },
  ]);
  if (!outside) return error ? <div role="alert" className="absolute bottom-3 right-3 z-50 rounded bg-[var(--panel)] p-3 text-[var(--red)]">
    {error} <button onClick={open}>Retry</button> <button onClick={onClose}>Dismiss</button>
  </div> : null;
  // dh-floating-chat gives this window the same slim composer and tighter
  // transcript as a floating chat in the Hub once it is narrow enough.
  return createPortal(<div onContextMenu={contextMenu.onContextMenu}
    className="dh-floating-chat flex min-h-0 flex-1 flex-col bg-[var(--chat-background)]">
    {error && <div role="alert" className="px-2 text-12 text-[var(--red)]">{error}</div>}
    {children}
    {contextMenu.menu}
  </div>, host);
}

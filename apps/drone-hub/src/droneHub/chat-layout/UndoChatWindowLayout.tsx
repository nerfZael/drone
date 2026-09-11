import React from 'react';
import { CHAT_LAYOUT_UNDO } from './chat-window-layout-events';

export function UndoChatWindowLayout({ workspaceId }: { workspaceId: string }) {
  const [undo, setUndo] = React.useState<(() => unknown) | null>(null);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    setUndo(null); setError('');
    const listener = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail.workspaceId === workspaceId) { setUndo(() => detail.undo); setError(''); }
    };
    window.addEventListener(CHAT_LAYOUT_UNDO, listener);
    return () => window.removeEventListener(CHAT_LAYOUT_UNDO, listener);
  }, [workspaceId]);
  if (!undo && !error) return null;
  return <div data-companion-surface="true" className="absolute bottom-3 left-3 z-[2000] rounded border bg-[var(--panel)] p-2 text-xs">
    {undo && <button type="button" onClick={() => {
      try { undo(); } catch { setError('Layout changed. Ask Companion to read the current layout again.'); setUndo(null); }
    }}>Undo arrangement</button>}
    {error && <span role="status">{error} <button type="button" onClick={() => setError('')}>Dismiss</button></span>}
  </div>;
}

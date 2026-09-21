import React from 'react';
import type { CompanionMirrorSession, CompanionMirrorState } from '@drone/assistant-chat';
import { buildDirectApiWebSocketUrl } from '../app/direct-api-fetch';

type MirrorContext = CompanionMirrorState & {
  connected: boolean;
  saving: boolean;
  error: string;
  autoApprove: boolean | null;
  setEnabled(enabled: boolean): Promise<void>;
  command(session: CompanionMirrorSession, action: 'approve' | 'discard'): Promise<void>;
};
const Context = React.createContext<MirrorContext | null>(null);

export function CompanionMirrorProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<CompanionMirrorState>({ enabled: false, sessions: [] });
  const [connected, setConnected] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [connectionError, setConnectionError] = React.useState('');
  const [autoApprove, setAutoApprove] = React.useState<boolean | null>(null);
  const socket = React.useRef<WebSocket | null>(null);
  const writing = React.useRef(false);
  const pending = React.useRef(new Map<string, { finish(error?: string): void }>());
  React.useEffect(() => {
    let disposed = false;
    let retry: number | undefined;
    const open = () => {
      if (disposed) return;
      const active = new WebSocket(buildDirectApiWebSocketUrl('/api/companion/stream'));
      socket.current = active;
      const timeout = window.setTimeout(() => active.close(), 10_000);
      active.onopen = () => active.send(JSON.stringify({ type: 'mirror_subscribe' }));
      active.onmessage = (event) => {
        if (disposed || socket.current !== active) return;
        let message;
        try { message = JSON.parse(String(event.data)); } catch { return; }
        if (message.type === 'mirror_state' && typeof message.enabled === 'boolean' && Array.isArray(message.sessions)) {
          window.clearTimeout(timeout);
          setState({ enabled: message.enabled, sessions: message.sessions }); setConnected(true); setConnectionError('');
        } else if (message.type === 'mirror_auto_approve' && typeof message.enabled === 'boolean') setAutoApprove(message.enabled);
        else if (message.type === 'mirror_result') pending.current.get(message.requestId)?.finish(message.ok ? undefined : message.error || 'Could not control the remote Companion.');
        else if (message.type === 'mirror_error') { setConnectionError(message.error); active.close(); }
      };
      active.onerror = () => active.close();
      active.onclose = () => {
        window.clearTimeout(timeout);
        if (disposed || socket.current !== active) return;
        setConnected(false); setConnectionError('Companion mirror disconnected. Reconnecting…');
        for (const request of pending.current.values()) request.finish('Connection lost. Check the proposal status after reconnecting.');
        retry = window.setTimeout(open, 2_000);
      };
    };
    open();
    return () => {
      disposed = true; window.clearTimeout(retry); socket.current?.close(); socket.current = null;
      for (const request of pending.current.values()) request.finish('Companion mirror closed.');
    };
  }, []);

  const setEnabled = async (enabled: boolean) => {
    if (writing.current || !connected) return;
    writing.current = true; setSaving(true); setError('');
    try {
      const response = await fetch('/api/settings/companion/mirror', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error('Could not save Companion mirror preference. Try again.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { writing.current = false; setSaving(false); }
  };

  const command = async (session: CompanionMirrorSession, action: 'approve' | 'discard') => {
    const active = socket.current;
    if (!connected || active?.readyState !== WebSocket.OPEN) throw new Error('Companion mirror is disconnected.');
    const requestId = crypto.randomUUID();
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => finish('The phone did not confirm the action. Check the proposal status.'), 15_000);
      const finish = (error?: string) => {
        if (!pending.current.delete(requestId)) return;
        window.clearTimeout(timer);
        if (error) reject(new Error(error)); else resolve();
      };
      pending.current.set(requestId, { finish });
      try { active.send(JSON.stringify({ type: 'mirror_command', requestId, deviceId: session.deviceId,
        sessionId: session.sessionId, proposalRevision: session.proposalRevision, action })); }
      catch (reason) { finish(String(reason)); }
    });
  };

  return <Context.Provider value={{ ...state, connected, saving, error: error || connectionError, autoApprove, setEnabled, command }}>{children}</Context.Provider>;
}

export function useCompanionMirror() { return React.useContext(Context); }

import React from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { requestJson } from '../http';
import { provisioningLabel, usePaneReadiness } from '../panes/usePaneReadiness';

const TERMINAL_INITIAL_TAIL_LINES = 40;
const TERMINAL_MAX_BYTES = 200_000;
const TERMINAL_INPUT_FLUSH_MS = 22;
const TERMINAL_INPUT_CHUNK_MAX = 16_384;
const TERMINAL_INPUT_BURST_FLUSH_BYTES = 768;
const TERMINAL_WS_RECONNECT_BASE_MS = 250;
const TERMINAL_WS_RECONNECT_MAX_MS = 2200;
const TERMINAL_POLL_FAST_MS = 120;
const TERMINAL_POLL_IDLE_MS = 600;
const TERMINAL_POLL_UNFOCUSED_MS = 900;
const TERMINAL_POLL_OFFSCREEN_MS = 1500;
const TERMINAL_POLL_HIDDEN_MS = 2500;
const TERMINAL_IDLE_AFTER_MS = 5000;
const TERMINAL_EMPTY_BACKOFF_MAX_MS = 2000;
const TERMINAL_ERROR_BACKOFF_MAX_MS = 6000;

type OpenTerminalResponse = {
  ok: true;
  id: string;
  name: string;
  mode: 'shell' | 'agent';
  chat: string | null;
  cwd: string;
  sessionName: string;
};

type ReadTerminalOutputResponse = {
  ok: true;
  id: string;
  name: string;
  sessionName: string;
  offsetBytes: number;
  text: string;
};

type TerminalStreamServerMessage =
  | { type: 'ready'; offsetBytes?: number }
  | { type: 'output'; offsetBytes?: number; text?: string }
  | { type: 'error'; error?: string }
  | { type: 'pong' };

function normalizeContainerPathInput(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function DroneTerminalDock({
  droneId,
  droneName,
  chatName,
  defaultCwd,
  disabled,
  hubPhase,
  hubMessage,
}: {
  droneId: string;
  droneName: string;
  chatName: string;
  defaultCwd: string;
  disabled: boolean;
  hubPhase?: 'creating' | 'starting' | 'seeding' | 'error' | null;
  hubMessage?: string | null;
}) {
  const normalizedCwd = React.useMemo(() => normalizeContainerPathInput(defaultCwd), [defaultCwd]);
  const [sessionName, setSessionName] = React.useState<string>('');
  const [error, setError] = React.useState<string | null>(null);
  const [streamMode, setStreamMode] = React.useState<'ws' | 'poll'>(() =>
    typeof window !== 'undefined' && typeof window.WebSocket !== 'undefined' ? 'ws' : 'poll',
  );

  const terminalHostRef = React.useRef<HTMLDivElement | null>(null);
  const terminalRef = React.useRef<Terminal | null>(null);
  const fitAddonRef = React.useRef<FitAddon | null>(null);
  const outputOffsetRef = React.useRef<number | null>(null);
  const activeTargetRef = React.useRef<{ droneId: string; sessionName: string } | null>(null);
  const inputBufferRef = React.useRef<string>('');
  const inputFlushTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushingInputRef = React.useRef<boolean>(false);
  const pollNowRef = React.useRef<(() => void) | null>(null);
  const postInputPollTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityAtRef = React.useRef<number>(Date.now());
  const emptyStreakRef = React.useRef<number>(0);
  const errorStreakRef = React.useRef<number>(0);
  const inViewportRef = React.useRef<boolean>(true);
  const computePollIntervalMsRef = React.useRef<() => number>(() => TERMINAL_POLL_IDLE_MS);
  const dockRootRef = React.useRef<HTMLDivElement | null>(null);
  const wsRef = React.useRef<WebSocket | null>(null);
  const wsReconnectTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const startup = usePaneReadiness({
    hubPhase,
    resetKey: `${droneId}\u0000terminal`,
    timeoutMs: 18_000,
  });

  function isImmediateInput(data: string): boolean {
    return /[\r\n\t\u0003\u0004\u001b]/.test(data);
  }

  function buildTerminalStreamWsUrl(drone: string, session: string, since?: number): string {
    const proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const base = typeof window !== 'undefined' ? window.location.host : 'localhost';
    const u = new URL(`${proto}//${base}/api/drones/${encodeURIComponent(drone)}/terminal/${encodeURIComponent(session)}/stream`);
    if (typeof since === 'number' && Number.isFinite(since) && since >= 0) {
      u.searchParams.set('since', String(Math.floor(since)));
      u.searchParams.set('maxBytes', String(TERMINAL_MAX_BYTES));
    }
    return u.toString();
  }

  const applyServerOutput = React.useCallback((nextText: string) => {
    if (!nextText) {
      emptyStreakRef.current = Math.min(50, emptyStreakRef.current + 1);
      return;
    }
    terminalRef.current?.write(nextText);
    lastActivityAtRef.current = Date.now();
    emptyStreakRef.current = 0;
  }, []);

  const flushInputBuffer = React.useCallback(async () => {
    const target = activeTargetRef.current;
    if (!target) return;
    const ws = wsRef.current;
    const wsOpen = Boolean(ws && ws.readyState === WebSocket.OPEN);
    if (!wsOpen && flushingInputRef.current) return;
    const chunk = inputBufferRef.current.slice(0, TERMINAL_INPUT_CHUNK_MAX);
    if (!chunk) return;

    inputBufferRef.current = inputBufferRef.current.slice(chunk.length);
    if (wsOpen && ws) {
      try {
        ws.send(JSON.stringify({ type: 'input', data: chunk }));
        lastActivityAtRef.current = Date.now();
        emptyStreakRef.current = 0;
        errorStreakRef.current = 0;
        setError(null);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      } finally {
        if (inputBufferRef.current) void flushInputBuffer();
      }
      return;
    }

    if (flushingInputRef.current) return;
    flushingInputRef.current = true;
    try {
      await requestJson(
        `/api/drones/${encodeURIComponent(target.droneId)}/terminal/${encodeURIComponent(target.sessionName)}/input`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ data: chunk }),
        },
      );
      lastActivityAtRef.current = Date.now();
      emptyStreakRef.current = 0;
      errorStreakRef.current = 0;
      setError(null);
      pollNowRef.current?.();
      if (postInputPollTimerRef.current != null) {
        clearTimeout(postInputPollTimerRef.current);
        postInputPollTimerRef.current = null;
      }
      postInputPollTimerRef.current = setTimeout(() => {
        postInputPollTimerRef.current = null;
        pollNowRef.current?.();
      }, 80);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      flushingInputRef.current = false;
      if (inputBufferRef.current) {
        void flushInputBuffer();
      }
    }
  }, []);

  const scheduleFlushInput = React.useCallback(() => {
    if (inputFlushTimerRef.current != null) return;
    inputFlushTimerRef.current = setTimeout(() => {
      inputFlushTimerRef.current = null;
      void flushInputBuffer();
    }, TERMINAL_INPUT_FLUSH_MS);
  }, [flushInputBuffer]);

  const queueInput = React.useCallback(
    (data: string) => {
      if (!data) return;
      if (!activeTargetRef.current) return;

      inputBufferRef.current += data;
      if (inputBufferRef.current.length > 128 * 1024) {
        inputBufferRef.current = inputBufferRef.current.slice(-128 * 1024);
      }
      if (isImmediateInput(data) || inputBufferRef.current.length >= TERMINAL_INPUT_BURST_FLUSH_BYTES) {
        if (inputFlushTimerRef.current != null) {
          clearTimeout(inputFlushTimerRef.current);
          inputFlushTimerRef.current = null;
        }
        void flushInputBuffer();
        return;
      }
      scheduleFlushInput();
    },
    [flushInputBuffer, scheduleFlushInput],
  );

  React.useEffect(() => {
    const host = terminalHostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontSize: 12,
      fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      theme: {
        background: '#101216',
        foreground: '#A8AEBE',
        cursor: '#A78BFA',
        cursorAccent: '#101216',
        selectionBackground: 'rgba(167,139,250,0.15)',
        black: '#1E2329',
        red: '#FF5A5A',
        green: '#4ADE80',
        yellow: '#FFB224',
        blue: '#388bfd',
        magenta: '#C084FC',
        cyan: '#22D3EE',
        white: '#DFE3EA',
        brightBlack: '#4E5468',
        brightRed: '#FF7676',
        brightGreen: '#34FFBA',
        brightYellow: '#FFD666',
        brightBlue: '#60A5FA',
        brightMagenta: '#D8B4FE',
        brightCyan: '#67E8F9',
        brightWhite: '#F0F2F6',
      },
      allowProposedApi: false,
      scrollback: 15_000,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(host);
    fitAddon.fit();

    const onData = terminal.onData((data) => {
      queueInput(data);
    });

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // ignore
      }
    });
    resizeObserver.observe(host);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    return () => {
      onData.dispose();
      resizeObserver.disconnect();
      terminalRef.current = null;
      fitAddonRef.current = null;
      terminal.dispose();
    };
  }, [queueInput]);

  React.useEffect(() => {
    if (!droneName || disabled) {
      if (wsReconnectTimerRef.current != null) {
        clearTimeout(wsReconnectTimerRef.current);
        wsReconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
      setSessionName('');
      setError(null);
      setStreamMode(typeof window !== 'undefined' && typeof window.WebSocket !== 'undefined' ? 'ws' : 'poll');
      outputOffsetRef.current = null;
      activeTargetRef.current = null;
      emptyStreakRef.current = 0;
      errorStreakRef.current = 0;
      return;
    }

    let cancelled = false;
    if (wsReconnectTimerRef.current != null) {
      clearTimeout(wsReconnectTimerRef.current);
      wsReconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    setStreamMode(typeof window !== 'undefined' && typeof window.WebSocket !== 'undefined' ? 'ws' : 'poll');
    setSessionName('');
    setError(null);
    outputOffsetRef.current = null;
    activeTargetRef.current = null;
    inputBufferRef.current = '';
    emptyStreakRef.current = 0;
    errorStreakRef.current = 0;
    if (inputFlushTimerRef.current != null) {
      clearTimeout(inputFlushTimerRef.current);
      inputFlushTimerRef.current = null;
    }
    if (postInputPollTimerRef.current != null) {
      clearTimeout(postInputPollTimerRef.current);
      postInputPollTimerRef.current = null;
    }

    const termAtStart = terminalRef.current;
    if (termAtStart) {
      termAtStart.reset();
      termAtStart.clear();
    }

    const open = async () => {
      const qs = new URLSearchParams();
      qs.set('mode', 'shell');
      qs.set('chat', chatName || 'default');
      qs.set('cwd', normalizedCwd);
      const data = await requestJson<OpenTerminalResponse>(`/api/drones/${encodeURIComponent(droneId)}/terminal/open?${qs.toString()}`, {
        method: 'POST',
      });
      if (cancelled) return;

      const nextSession = String(data?.sessionName ?? '').trim();
      if (!nextSession) throw new Error('terminal session did not return a session name');

      setSessionName(nextSession);
      outputOffsetRef.current = null;
      inputBufferRef.current = '';
      activeTargetRef.current = { droneId, sessionName: nextSession };
      lastActivityAtRef.current = Date.now();
      emptyStreakRef.current = 0;
      errorStreakRef.current = 0;

      const term = terminalRef.current;
      if (term) {
        term.reset();
        term.clear();
        term.focus();
      }
      try {
        fitAddonRef.current?.fit();
      } catch {
        // ignore
      }
    };

    void open()
      .catch((e: any) => {
        if (cancelled) return;
        setSessionName('');
        activeTargetRef.current = null;
        setError(e?.message ?? String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [droneId, chatName, normalizedCwd, disabled, queueInput]);

  React.useEffect(() => {
    const el = dockRootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        const visible = Boolean(e && (e.isIntersecting || e.intersectionRatio > 0));
        inViewportRef.current = visible;
      },
      { root: null, threshold: [0, 0.05, 0.1] },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  React.useEffect(() => {
    if (!droneName || !sessionName || disabled || streamMode !== 'ws') return;
    if (typeof window === 'undefined' || typeof window.WebSocket === 'undefined') {
      setStreamMode('poll');
      return;
    }

    let mounted = true;
    let attempts = 0;
    let wsClosedByUs = false;

    const clearReconnectTimer = () => {
      if (wsReconnectTimerRef.current != null) {
        clearTimeout(wsReconnectTimerRef.current);
        wsReconnectTimerRef.current = null;
      }
    };

    const connect = (since?: number) => {
      if (!mounted) return;
      clearReconnectTimer();
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }

      let opened = false;
      const ws = new WebSocket(buildTerminalStreamWsUrl(droneId, sessionName, since));
      wsRef.current = ws;

      ws.onopen = () => {
        opened = true;
        attempts = 0;
        setError(null);
        errorStreakRef.current = 0;
      };

      ws.onmessage = (ev) => {
        if (!mounted) return;
        const raw = typeof ev.data === 'string' ? ev.data : '';
        if (!raw) return;

        let msg: TerminalStreamServerMessage | null = null;
        try {
          msg = JSON.parse(raw) as TerminalStreamServerMessage;
        } catch {
          return;
        }
        if (!msg) return;

        if (msg.type === 'error') {
          setError(msg.error ?? 'terminal stream error');
          errorStreakRef.current = Math.min(20, errorStreakRef.current + 1);
          return;
        }
        if (msg.type === 'ready') {
          const off = Number(msg.offsetBytes);
          if (Number.isFinite(off) && off >= 0) outputOffsetRef.current = off;
          return;
        }
        if (msg.type === 'output') {
          setError(null);
          errorStreakRef.current = 0;
          const off = Number(msg.offsetBytes);
          if (Number.isFinite(off) && off >= 0) outputOffsetRef.current = off;
          applyServerOutput(typeof msg.text === 'string' ? msg.text : '');
        }
      };

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (!mounted || wsClosedByUs) return;

        attempts += 1;
        if (attempts > 5) {
          setStreamMode('poll');
          return;
        }
        if (!opened && attempts >= 2) {
          setStreamMode('poll');
          return;
        }

        const delay = Math.min(TERMINAL_WS_RECONNECT_MAX_MS, TERMINAL_WS_RECONNECT_BASE_MS * Math.pow(2, attempts - 1));
        wsReconnectTimerRef.current = setTimeout(() => {
          wsReconnectTimerRef.current = null;
          if (!mounted) return;
          const nextSince = outputOffsetRef.current == null ? undefined : outputOffsetRef.current;
          connect(nextSince);
        }, Math.floor(delay));
      };

      ws.onerror = () => {
        // onclose handles retries/fallback.
      };
    };

    const initialSince = outputOffsetRef.current == null ? undefined : outputOffsetRef.current;
    connect(initialSince);

    return () => {
      mounted = false;
      wsClosedByUs = true;
      clearReconnectTimer();
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
    };
  }, [droneId, sessionName, disabled, streamMode, queueInput, applyServerOutput]);

  React.useEffect(() => {
    if (!droneName || !sessionName || disabled || streamMode !== 'poll') return;
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let busy = false;

    const computeIntervalMs = () => {
      const now = Date.now();
      const last = lastActivityAtRef.current || now;
      const idle = now - last > TERMINAL_IDLE_AFTER_MS;
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      const focused = typeof document !== 'undefined' ? document.hasFocus() : true;
      const inViewport = inViewportRef.current;

      const base = hidden
        ? TERMINAL_POLL_HIDDEN_MS
        : !inViewport
          ? TERMINAL_POLL_OFFSCREEN_MS
          : !focused
            ? TERMINAL_POLL_UNFOCUSED_MS
            : idle
              ? TERMINAL_POLL_IDLE_MS
              : TERMINAL_POLL_FAST_MS;

      let delay = base;
      const emptyStreak = emptyStreakRef.current;
      if (idle && emptyStreak >= 3) {
        const extra = Math.min(TERMINAL_EMPTY_BACKOFF_MAX_MS, base * Math.pow(1.6, Math.min(8, emptyStreak - 2)));
        delay = Math.max(delay, Math.floor(extra));
      }

      const errStreak = errorStreakRef.current;
      if (errStreak > 0) {
        const extra = Math.min(TERMINAL_ERROR_BACKOFF_MAX_MS, base * Math.pow(2, Math.min(6, errStreak)));
        delay = Math.max(delay, Math.floor(extra));
      }

      return delay;
    };
    computePollIntervalMsRef.current = computeIntervalMs;

    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const qs = new URLSearchParams();
        if (outputOffsetRef.current == null) {
          qs.set('tail', String(TERMINAL_INITIAL_TAIL_LINES));
        } else {
          qs.set('since', String(outputOffsetRef.current));
          qs.set('maxBytes', String(TERMINAL_MAX_BYTES));
        }
        const data = await requestJson<ReadTerminalOutputResponse>(
          `/api/drones/${encodeURIComponent(droneId)}/terminal/${encodeURIComponent(sessionName)}/output?${qs.toString()}`,
        );
        if (!mounted) return;
        setError(null);
        errorStreakRef.current = 0;
        const nextOffset = Number(data?.offsetBytes);
        const nextText = typeof data?.text === 'string' ? data.text : '';
        if (Number.isFinite(nextOffset) && nextOffset >= 0) {
          outputOffsetRef.current = nextOffset;
        }
        applyServerOutput(nextText);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message ?? String(e));
        errorStreakRef.current = Math.min(20, errorStreakRef.current + 1);
      } finally {
        busy = false;
      }
    };

    pollNowRef.current = () => {
      void poll();
    };

    const loop = async () => {
      if (!mounted) return;
      await poll();
      if (!mounted) return;
      const nextDelay = computePollIntervalMsRef.current?.() ?? TERMINAL_POLL_IDLE_MS;
      timer = setTimeout(() => {
        void loop();
      }, Math.max(80, Math.floor(nextDelay)));
    };

    void loop();

    return () => {
      mounted = false;
      pollNowRef.current = null;
      if (timer != null) clearTimeout(timer);
      if (postInputPollTimerRef.current != null) {
        clearTimeout(postInputPollTimerRef.current);
        postInputPollTimerRef.current = null;
      }
    };
  }, [droneId, sessionName, disabled, streamMode, applyServerOutput, queueInput]);

  React.useEffect(() => {
    return () => {
      if (inputFlushTimerRef.current != null) clearTimeout(inputFlushTimerRef.current);
      if (postInputPollTimerRef.current != null) clearTimeout(postInputPollTimerRef.current);
      if (wsReconnectTimerRef.current != null) clearTimeout(wsReconnectTimerRef.current);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={dockRootRef}
      className="w-full h-full min-h-0 bg-[var(--panel-alt)] overflow-hidden flex flex-col relative"
    >
      {error && (
        <div className="px-3 py-1 text-[10px] text-[var(--red)] truncate max-w-full border-b border-[var(--border-subtle)] bg-[var(--red-subtle)]">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 bg-[#101216] relative pt-1 pl-1">
        {disabled && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-center px-6">
            <div className="max-w-[360px] rounded-md border border-[var(--border-subtle)] bg-[rgba(0,0,0,.35)] backdrop-blur px-4 py-3">
              <div className="text-[10px] font-semibold tracking-wide uppercase text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                {provisioningLabel(hubPhase)}
              </div>
              <div className="mt-1 text-[12px] text-[var(--muted)]">
                {startup.timedOut
                  ? 'Still waiting for the terminal to become available.'
                  : 'Connecting terminal…'}
              </div>
              {String(hubMessage ?? '').trim() ? (
                <div className="mt-1 text-[11px] text-[var(--muted-dim)]">{String(hubMessage ?? '').trim()}</div>
              ) : null}
              {startup.timedOut ? (
                <div className="mt-2 text-[11px] text-[var(--muted-dim)]">
                  If this persists, check the drone status/error details in the sidebar.
                </div>
              ) : null}
            </div>
          </div>
        )}
        <div
          ref={terminalHostRef}
          className="w-full h-full min-h-0 overflow-hidden"
          onClick={() => {
            terminalRef.current?.focus();
          }}
        />
      </div>
    </div>
  );
}

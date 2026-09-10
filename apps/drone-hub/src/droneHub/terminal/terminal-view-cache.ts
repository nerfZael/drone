import { takeTerminalOpenStartedAt, terminalModuleTiming } from './terminal-performance';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { ITheme } from '@xterm/xterm';
import { TerminalConnection } from './terminal-connection';
import { terminalOpenRequests, type ShellTerminalTarget } from './terminal-open-request';

type View = {
  element: HTMLDivElement;
  terminal: Terminal;
  fit: FitAddon;
  connection: TerminalConnection;
  users: number;
  timer?: ReturnType<typeof setTimeout>;
};
const views = new Map<string, View>();
export const terminalViewKey = (droneId: string, pane: string, tab: string) =>
  JSON.stringify([droneId, pane, tab]);

export function acquireTerminalView(
  key: string,
  host: HTMLElement,
  target: ShellTerminalTarget,
  theme: ITheme,
) {
  const mounting = performance.now();
  const started = takeTerminalOpenStartedAt();
  let view = views.get(key);
  const reused = Boolean(view);
  if (!view) {
    const element = document.createElement('div');
    element.style.cssText = 'width:100%;height:100%;min-height:0';
    host.append(element);
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontSize: 12,
      fontFamily:
        "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      theme,
      scrollback: 15_000,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(element);
    const connection = new TerminalConnection(
      target,
      {
        write: (data, done) => terminal.write(data, done),
        reset: () => terminal.reset(),
      },
      started,
    );
    const moduleTiming = terminalModuleTiming(started);
    connection.measure('module-ready', performance.now() - moduleTiming.ms, {
      preloaded: moduleTiming.preloaded,
    });
    connection.measure('view-mount-wait', performance.now() - (mounting - started));
    connection.measure('xterm-setup', mounting);
    terminal.onData((data) => connection.send(data));
    terminal.onResize(({ cols, rows }) => connection.resize(cols, rows));
    view = { element, terminal, fit, connection, users: 0 };
    views.set(key, view);
  }
  views.delete(key);
  views.set(key, view);
  (window as any).__droneTerminalDiagnostics = () =>
    [...views.values()].map((value) => value.connection.diagnostics());
  clearTimeout(view.timer);
  view.users++;
  host.append(view.element);
  view.terminal.options.theme = theme;
  view.fit.fit();
  view.connection.resize(view.terminal.cols, view.terminal.rows);
  view.terminal.focus();
  view.connection.measure(reused ? 'view-restored' : 'view-created', started, {
    cols: view.terminal.cols,
    rows: view.terminal.rows,
  });
  const current = view;
  let released = false;
  return {
    ...current,
    release() {
      if (released) return;
      released = true;
      current.users--;
      if (current.users || views.get(key) !== current) return;
      current.element.remove();
      current.timer = setTimeout(() => evictTerminalView(key), 120_000);
      const idle = [...views.entries()].filter(([, item]) => item.users === 0);
      for (const [oldKey] of idle.slice(0, Math.max(0, idle.length - 8))) evictTerminalView(oldKey);
    },
  };
}

export function evictTerminalView(key: string) {
  const view = views.get(key);
  if (!view) return;
  views.delete(key);
  clearTimeout(view.timer);
  view.connection.dispose();
  view.terminal.dispose();
  view.element.remove();
}

export function invalidateDroneTerminals(droneId: string) {
  for (const [key, view] of views) {
    if (view.connection.target.droneId !== droneId) continue;
    terminalOpenRequests.invalidate(view.connection.target);
    evictTerminalView(key);
  }
}

export function cachedTerminalConnection(key: string) {
  return views.get(key)?.connection;
}

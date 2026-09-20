import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DroneTerminalSessionList } from '../src/droneHub/terminal/DroneTerminalSessionList';
import {
  onNewTerminalSessionRequest,
  requestNewTerminalSession,
} from '../src/droneHub/terminal/terminal-new-session-request';
import type { TerminalPaneSession } from '../src/droneHub/terminal/terminal-tabs-state';

function session(id: string, title: string): TerminalPaneSession {
  return { id, title, cwd: '/work/repo' } as TerminalPaneSession;
}

function render(sessions: TerminalPaneSession[], activeSessionId: string | null = null) {
  return renderToStaticMarkup(
    <DroneTerminalSessionList
      sessions={sessions}
      activeSessionId={activeSessionId}
      closingSessionId={null}
      onActivateSession={() => {}}
      onCloseSession={() => {}}
    />,
  );
}

describe('terminal session list', () => {
  test('keeps the same list whether there is one session or several', () => {
    const lone = render([session('a', 'bash')], 'a');
    const several = render([session('a', 'bash'), session('b', 'node')], 'b');
    for (const markup of [render([]), lone, several]) {
      expect(markup).toContain('w-40');
      expect(markup).toContain('aria-orientation="vertical"');
    }
    expect(lone).toContain('aria-label="Close bash"');
    expect(several.match(/role="tab"/g)).toHaveLength(2);
    expect(several).toMatch(/aria-selected="true"[^>]*>(?:(?!<\/button>).)*node/s);
  });

  test('opens new terminals from the dock header, not from the list', () => {
    expect(render([session('a', 'bash')], 'a')).not.toContain('Open a new terminal');
  });
});

describe('new terminal requests', () => {
  test('reach only the pane they were addressed to, until it unsubscribes', () => {
    const calls: string[] = [];
    const offSingle = onNewTerminalSessionRequest('drone-1', 'single', () => calls.push('single'));
    const offOther = onNewTerminalSessionRequest('drone-2', 'single', () => calls.push('other'));
    requestNewTerminalSession('drone-1', 'single');
    expect(calls).toEqual(['single']);
    offSingle();
    requestNewTerminalSession('drone-1', 'single');
    expect(calls).toEqual(['single']);
    offOther();
  });
});

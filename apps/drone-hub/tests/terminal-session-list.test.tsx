import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DroneTerminalSessionList } from '../src/droneHub/terminal/DroneTerminalSessionList';
import {
  canRequestNewTerminalSession,
  onNewTerminalSessionRequest,
  requestNewTerminalSession,
} from '../src/droneHub/terminal/terminal-new-session-request';
import type { TerminalPaneSession } from '../src/droneHub/terminal/terminal-tabs-state';

function session(id: string, title: string): TerminalPaneSession {
  return { id, title, cwd: '/work/repo' } as TerminalPaneSession;
}

function render(
  sessions: TerminalPaneSession[],
  activeSessionId: string | null = null,
  onCreateSession?: () => void,
) {
  return renderToStaticMarkup(
    <DroneTerminalSessionList
      sessions={sessions}
      activeSessionId={activeSessionId}
      closingSessionId={null}
      onActivateSession={() => {}}
      onCloseSession={() => {}}
      onCreateSession={onCreateSession}
    />,
  );
}

describe('terminal session list', () => {
  test('keeps the same list whether there is one session or several', () => {
    const lone = render([session('a', 'bash')], 'a');
    const several = render([session('a', 'bash'), session('b', 'node')], 'b');
    for (const markup of [render([]), lone, several]) {
      expect(markup).toContain('w-[clamp(7rem,28%,10rem)]');
      expect(markup).toContain('aria-orientation="vertical"');
    }
    expect(lone).toContain('aria-label="Close bash"');
    expect(several.match(/role="tab"/g)).toHaveLength(2);
    expect(several).toMatch(/aria-selected="true"[^>]*>(?:(?!<\/button>).)*node/s);
  });

  test('leaves the new-terminal button to the dock header, and offers it where there is none', () => {
    expect(render([session('a', 'bash')], 'a')).not.toContain('Open a new terminal');
    // The single-pane mobile layout has no dock header to carry the button.
    expect(render([session('a', 'bash')], 'a', () => {})).toContain('aria-label="Open a new terminal"');
  });
});

describe('new terminal requests', () => {
  test('reach only the pane they were addressed to, until it unsubscribes', () => {
    const calls: string[] = [];
    const offSingle = onNewTerminalSessionRequest('drone-1', 'single', () => calls.push('single'));
    const offOther = onNewTerminalSessionRequest('drone-2', 'single', () => calls.push('other'));
    requestNewTerminalSession('drone-1', 'single');
    expect(calls).toEqual(['single']);
    // The header button is only live while a pane is listening for it.
    expect(canRequestNewTerminalSession('drone-1', 'single')).toBe(true);
    offSingle();
    expect(canRequestNewTerminalSession('drone-1', 'single')).toBe(false);
    requestNewTerminalSession('drone-1', 'single');
    expect(calls).toEqual(['single']);
    offOther();
  });
});

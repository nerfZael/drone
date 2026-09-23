import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { afterEach, expect, test } from 'bun:test';
import { desktopToolWindowsAvailable, useDesktopToolWindows } from '../src/droneHub/app/desktop-tool-windows';
import { DesktopToolWindows, desktopToolPinTooltip, desktopToolWindowTitle } from '../src/droneHub/app/DesktopToolWindows';
import { ChatsDockTab } from '../src/droneHub/app/ChatsDockTab';
import type { DroneSummary } from '../src/droneHub/types';
import fs from 'node:fs';
import path from 'node:path';

const drone = (id: string, name: string): DroneSummary => ({ id, name, chats: ['default'] } as unknown as DroneSummary);

function installDom(dom: Window, child?: Window) {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  if (child) Object.assign(dom, { open: () => child, droneHubDesktop: { setChatWindowAlwaysOnTop: async () => true } });
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, MutationObserver: dom.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  return () => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
    child?.happyDOM.abort();
  };
}

afterEach(() => {
  useDesktopToolWindows.setState({ windows: {} });
});

test('tool windows exist only in the desktop app; reopening a tool focuses its following window, pinned ones are left alone', () => {
  const dom = new Window({ url: 'http://localhost' });
  const restore = installDom(dom);
  try {
    expect(desktopToolWindowsAvailable()).toBe(false);
    expect(useDesktopToolWindows.getState().open('changes')).toBeNull();
    expect(useDesktopToolWindows.getState().windows).toEqual({});
    Object.assign(dom, { droneHubDesktop: { setChatWindowAlwaysOnTop: async () => true } });
    expect(desktopToolWindowsAvailable()).toBe(true);
    // Panes that only know the selected drone (browser ports, links) cannot be pinned, so they get no window.
    expect(useDesktopToolWindows.getState().open('links')).toBeNull();
    expect(useDesktopToolWindows.getState().open('preview')).toBeNull();
    const first = useDesktopToolWindows.getState().open('changes')!;
    expect(useDesktopToolWindows.getState().open('changes')).toBe(first);
    expect(useDesktopToolWindows.getState().windows[first]).toMatchObject({ tab: 'changes', pinnedDroneId: null, request: 2 });
    useDesktopToolWindows.getState().setPinnedDrone(first, 'a');
    const second = useDesktopToolWindows.getState().open('changes')!;
    expect(second).not.toBe(first);
    expect(Object.keys(useDesktopToolWindows.getState().windows)).toEqual([first, second]);
    useDesktopToolWindows.getState().setPinnedDrone(first, null);
    expect(useDesktopToolWindows.getState().windows[first].pinnedDroneId).toBeNull();
    useDesktopToolWindows.getState().close(first);
    expect(Object.keys(useDesktopToolWindows.getState().windows)).toEqual([second]);
    // A closed window's id is reused, so its pane key (and terminal sessions) come back.
    useDesktopToolWindows.getState().close(second);
    expect(useDesktopToolWindows.getState().open('changes')).toBe(first);
  } finally {
    restore();
  }
});

test('the titles name the drone and say when the window is pinned to it', () => {
  expect(desktopToolWindowTitle('Changes', 'alpha', false)).toBe('alpha · Changes');
  expect(desktopToolWindowTitle('Changes', 'alpha', true)).toBe('Changes (alpha) · pinned');
  expect(desktopToolWindowTitle('Changes', null, false)).toBe('Changes');
  expect(desktopToolPinTooltip('alpha', false)).toContain('keeps showing alpha when you select another drone');
  expect(desktopToolPinTooltip('alpha', true)).toContain('unpin to follow the selected drone');
});

test('a dock tab offers the desktop window only in the desktop app and opens its tool there', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const restore = installDom(dom);
  const container = dom.document.createElement('div');
  const root = createRoot(container as unknown as HTMLElement);
  const api = { title: 'Chats', onDidTitleChange: () => ({ dispose: () => {} }), close: () => {} };
  try {
    await act(async () => { root.render(<ChatsDockTab api={api as never} containerApi={{} as never} params={{}} tabLocation="header" />); });
    expect(container.querySelector('[data-open-desktop-tool]')).toBeNull();
    Object.assign(dom, { droneHubDesktop: { setChatWindowAlwaysOnTop: async () => true } });
    await act(async () => { root.unmount(); });
    const again = createRoot(container as unknown as HTMLElement);
    await act(async () => { again.render(<ChatsDockTab api={api as never} containerApi={{} as never} params={{}} tabLocation="header" />); });
    const button = container.querySelector<HTMLButtonElement>('[data-open-desktop-tool]')!;
    expect(button.getAttribute('title')).toContain('pin');
    await act(async () => { button.click(); });
    expect(Object.values(useDesktopToolWindows.getState().windows).map((item) => item.tab)).toEqual(['chats']);
    await act(async () => { again.unmount(); });
  } finally {
    restore();
  }
});

test('a desktop tool window follows the selected drone until pinned, then keeps that drone', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const child = new Window({ url: 'about:blank' });
  const restore = installDom(dom, child);
  const element = dom.document.createElement('div');
  dom.document.body.appendChild(element);
  const root = createRoot(element as unknown as HTMLElement);
  const alpha = drone('a', 'alpha');
  const beta = drone('b', 'beta');
  const rendered: string[] = [];
  const view = (current: DroneSummary, drones: DroneSummary[] = [alpha, beta]) => (
    <DesktopToolWindows droneById={Object.fromEntries(drones.map((item) => [item.id, item]))} currentDrone={current}
      renderToolPane={(target, tab, paneKey) => { rendered.push(`${target.id}:${tab}:${paneKey}`); return <div data-pane={target.id} />; }}
      chatContext={{ drones: [alpha, beta] } as never} />
  );
  try {
    await act(async () => { root.render(view(alpha)); });
    let id = '';
    await act(async () => { id = useDesktopToolWindows.getState().open('changes')!; });
    const body = () => child.document.body;
    expect(body().querySelector('[data-pane]')?.getAttribute('data-pane')).toBe('a');
    expect(rendered.at(-1)).toBe(`a:changes:desktop:${id}`);
    expect(child.document.title).toBe('alpha · Changes');
    expect(body().querySelector('[data-desktop-tool-drone]')?.textContent).toContain('alpha');
    await act(async () => { root.render(view(beta)); });
    expect(body().querySelector('[data-pane]')?.getAttribute('data-pane')).toBe('b');
    expect(child.document.title).toBe('beta · Changes');
    const pin = () => body().querySelector<HTMLButtonElement>('[data-desktop-tool-pin]')!;
    expect(pin().getAttribute('aria-pressed')).toBe('false');
    await act(async () => { pin().click(); });
    expect(useDesktopToolWindows.getState().windows[id].pinnedDroneId).toBe('b');
    expect(pin().getAttribute('aria-pressed')).toBe('true');
    expect(child.document.title).toBe('Changes (beta) · pinned');
    expect(body().querySelector('[data-desktop-tool-drone]')?.textContent).toBe(' (beta)');
    await act(async () => { root.render(view(alpha)); });
    expect(body().querySelector('[data-pane]')?.getAttribute('data-pane')).toBe('b');
    // The pinned drone disappears: the window says so and can still be unpinned.
    await act(async () => { root.render(view(alpha, [alpha])); });
    expect(body().querySelector('[data-pane]')).toBeNull();
    expect(body().textContent).toContain('The pinned drone is gone.');
    expect(pin().getAttribute('aria-label')).toBe('Unpin from a deleted drone');
    await act(async () => { pin().click(); });
    expect(body().querySelector('[data-pane]')?.getAttribute('data-pane')).toBe('a');
    expect(child.document.title).toBe('alpha · Changes');
  } finally {
    await act(async () => root.unmount());
    restore();
  }
});

test('a pane shown for another drone gets that drone\'s home path and no borrowed selected chat', () => {
  const source = fs.readFileSync(path.join(import.meta.dir, '../src/use-drone-hub-app-model.tsx'), 'utf8');
  expect(source).toContain("const isSelectedDrone = drone.id === currentDrone?.id;");
  expect(source).toContain("selectedChat={isSelectedDrone ? selectedChat : ''}");
  expect(source).toContain("defaultFsPathForCurrentDrone={isSelectedDrone ? defaultFsPathForCurrentDrone : droneHomePath(drone) || '/'}");
  // Files opened from another drone's Changes/Requests resolve against that drone and bring the Hub to it.
  expect(source).toContain("onOpenChangesFileInEditor={isSelectedDrone ? openChangesFileInEditor : (repoRelativePath) => {");
  expect(source).toContain("const containerPath = resolveDroneRepoFilePath(drone, repoRelativePath);");
  expect(source).toContain("openFileDictationTarget({ droneId: drone.id, path: containerPath,");
  expect(source).toContain("onRevealChangesFileInFiles={isSelectedDrone ? revealChangesFileInFiles : (_pane, repoRelativePath) => {");
  expect(source).toContain("setFsPathForDrone(drone, slash > 0 ? containerPath.slice(0, slash) : '/');");
  // Every tool tab except the preview offers the desktop window from its dock tab.
  const dock = fs.readFileSync(path.join(import.meta.dir, '../src/droneHub/app/DockableDroneWorkspace.tsx'), 'utf8');
  expect(dock).toContain("if (props.api.id.startsWith(TOOL_PANEL_PREFIX) && tabFromPanelId(props.api.id) !== 'preview') return <ToolDockTab {...props} />;");
  // The workspace content mounts the windows beside the detached chats, outside the per-drone dock.
  const content = fs.readFileSync(path.join(import.meta.dir, '../src/droneHub/app/DroneHubWorkspaceContent.tsx'), 'utf8');
  expect(content).toContain('<DesktopToolWindows {...desktopToolWindowsProps} chatContext={detachedChatWindowsProps} />');
});

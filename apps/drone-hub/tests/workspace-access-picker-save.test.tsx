import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, mock, test } from 'bun:test';
import type { ChatWorkspaceAccess, ChatWorkspaceCatalog, ChatWorkspaceOption } from '@drone/assistant-chat';

// Live refresh is not under test: the Hub's event streams stay quiet.
mock.module('../src/droneHub/app/desktop-events', () => ({ subscribeDesktopEvents: () => () => {} }));
mock.module('../src/droneHub/app/device-mesh-events', () => ({ subscribeDeviceMeshChanges: () => () => {} }));

const { WorkspaceAccessPicker } = await import('../src/droneHub/assistant/WorkspaceAccessPicker');

const device = { id: 'device-a', name: 'desktop' };
const option = (id: string, name: string, kind: ChatWorkspaceOption['kind']): ChatWorkspaceOption =>
  ({ id, name, kind, deviceId: device.id, deviceName: device.name, read: true, write: true, execute: kind !== 'host' }) as ChatWorkspaceOption;
const drone = option('drone:mech', 'Mech drone', 'drone');
const guides = option('host:guides', 'Guides', 'host');
const graphics = option('host:graphics', 'Game Graphics', 'host');
const grant = (target: ChatWorkspaceOption, write = false) => ({ ...target, read: true, write, execute: false });

function catalogOf(access: ChatWorkspaceAccess, revision: string): ChatWorkspaceCatalog {
  return {
    revision,
    access,
    defaults: { targets: [], defaultTargetId: null },
    workspaces: [drone, guides, graphics],
    devices: [device],
  } as ChatWorkspaceCatalog;
}

test('an edit made on an outdated catalog keeps what changed elsewhere and saves, never leaving the picker busy', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const endpoint = '/api/drones/mech/chats/reviewer/workspaces';
  // What the Hub stores: the picker first sees revision r1; Game Graphics is added elsewhere (r2) while it is closed.
  let stored = catalogOf({ targets: [grant(drone, true), grant(guides)], defaultTargetId: drone.id }, 'r1');
  let releaseGet: (() => void) | null = null;
  let holdGets = false;
  const posts: Array<{ access: ChatWorkspaceAccess; revision: string }> = [];
  const requestJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      posts.push(body);
      if (body.revision !== stored.revision) throw new Error('Workspace access changed elsewhere. Reload before applying.');
      stored = catalogOf(body.access, `r${Number(stored.revision.slice(1)) + 1}`);
      return structuredClone(stored) as T;
    }
    if (holdGets) await new Promise<void>((resolve) => { releaseGet = resolve; });
    return structuredClone(stored) as T;
  };
  const busy: boolean[] = [];
  const element = dom.document.createElement('div');
  dom.document.body.appendChild(element);
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const mount = () => {
    const root = createRoot(element as unknown as HTMLElement);
    root.render(<WorkspaceAccessPicker requestJson={requestJson} endpoint={endpoint} onBusyChange={(value) => busy.push(value)} />);
    return root;
  };
  try {
    let root!: ReturnType<typeof createRoot>;
    await act(async () => { root = mount(); await wait(20); });
    await act(async () => root.unmount());
    stored = catalogOf({ targets: [grant(drone, true), grant(guides), grant(graphics)], defaultTargetId: drone.id }, 'r2');

    // Reopened: it shows the cached r1 at once, and the fresh catalog is slow to come.
    holdGets = true;
    await act(async () => { root = mount(); await wait(5); });
    const cell = element.querySelector('button[aria-label="Write Guides"]') as HTMLElement | null;
    expect(cell).not.toBeNull();
    await act(async () => {
      // A keyboard press: the square toggles on a click with no pointer.
      cell!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true, detail: 0 }) as unknown as Event);
      // The debounced save goes out against r1 and is refused.
      await wait(400);
    });
    expect(posts[0]?.revision).toBe('r1');
    holdGets = false;
    await act(async () => { releaseGet?.(); await wait(800); });

    const saved = posts.at(-1)!;
    expect(saved.revision).toBe('r2');
    expect(saved.access.targets.map((target) => target.id)).toEqual([drone.id, guides.id, graphics.id]);
    expect(saved.access.targets.find((target) => target.id === guides.id)?.write).toBe(true);
    expect(stored.revision).toBe('r3');
    expect(busy.at(-1)).toBe(false);
    await act(async () => root.unmount());
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
  }
});

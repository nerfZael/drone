import { afterEach, expect, test } from 'bun:test';
import {
  CompanionEditorFiles,
  type CompanionEditorTarget,
} from '../src/droneHub/files/CompanionEditorFiles';
import { COMPANION_FILE_PRESENTATION } from '../src/droneHub/files/companion-file-presentation';

const originalWindow = globalThis.window;
afterEach(() => {
  globalThis.window = originalWindow;
});

function fixture() {
  const events = new EventTarget();
  globalThis.window = events as unknown as Window & typeof globalThis;
  let target: CompanionEditorTarget | null;
  const accepted: unknown[] = [],
    requests: string[] = [];
  const panes = new Set<string>();
  let deny = false,
    supported = true;
  let duringRead = () => {};
  target = {
    droneId: 'a',
    session: Symbol(),
    tabs: [],
    activate() {},
    accept(data) {
      accepted.push(data);
      const tabId = `tab:${data.path}`;
      target!.tabs.push({ tabId, path: data.path, name: data.path, loaded: true });
      return tabId;
    },
  };
  events.addEventListener(COMPANION_FILE_PRESENTATION, ((event: CustomEvent) => {
    const { files, presentation } = event.detail;
    event.detail.panelIds = files.map((file: { tabId: string }) => {
      if (presentation === 'panes') {
        panes.add(file.tabId);
        return `file-tab:${file.tabId}`;
      }
      panes.delete(file.tabId);
      return 'tool:editor';
    });
  }) as EventListener);
  const controller = new CompanionEditorFiles(
    () => target,
    async <T>(url: string, init?: RequestInit) => {
      requests.push(url);
      if (url === '/api/companion/editor-file') {
        if (deny) throw new Error('Read access denied');
        const input = JSON.parse(String(init?.body));
        if (input.path === 'missing') throw new Error('NOT_A_FILE');
        return {
          path: input.path.startsWith('/') ? input.path : `/repo/${input.path}`,
          workspaceId: 'drone:a',
        } as T;
      }
      duringRead();
      return {
        ok: true,
        kind: 'text',
        path: new URL(url, 'http://local').searchParams.get('path'),
        content: 'private content',
        revision: 'revision',
      } as T;
    },
    () =>
      ({
        supported,
        workspaceId: 'a',
        layoutRevision: '2',
        panels: [
          { panelId: 'tool:editor' },
          ...[...panes].map((tabId) => ({ panelId: `file-tab:${tabId}` })),
        ],
      }) as any,
  );
  return {
    controller,
    accepted,
    requests,
    panes,
    target: () => target!,
    deny: () => {
      deny = true;
    },
    unsupported: () => {
      supported = false;
    },
    duringRead: (fn: () => void) => {
      duringRead = fn;
    },
    navigate: () => {
      target = { ...target!, session: Symbol() };
    },
  };
}

test('batch opens panes, reports partial failures, and returns metadata without content', async () => {
  const f = fixture();
  const result = await f.controller.open({
    droneId: 'a',
    paths: ['one.ts', 'missing', 'two.ts'],
    presentation: 'panes',
  });
  expect(result.ok).toBe(false);
  expect(result.files.map((file) => file.status)).toEqual(['opened', 'failed', 'opened']);
  expect(result.files[0]).toMatchObject({
    path: '/repo/one.ts',
    tabId: 'tab:/repo/one.ts',
    panelId: 'file-tab:tab:/repo/one.ts',
  });
  expect(f.accepted).toHaveLength(2);
  expect(JSON.stringify(result)).not.toContain('private content');
  expect(result.layout).toMatchObject({
    editorTabs: [{ presentation: 'panes' }, { presentation: 'panes' }],
  });
});

test('reuses loaded tabs without reading or replacing drafts, and can reattach them', async () => {
  const f = fixture();
  const tab = {
    tabId: 'draft',
    path: '/repo/one.ts',
    name: 'one.ts',
    loaded: true,
    content: 'unsaved draft',
  };
  f.target().tabs.push(tab);
  expect(
    (await f.controller.open({ droneId: 'a', paths: ['one.ts'], presentation: 'panes' })).files[0],
  ).toMatchObject({ reused: true, tabId: 'draft' });
  expect(f.requests).toEqual(['/api/companion/editor-file']);
  expect(f.accepted).toEqual([]);
  expect(
    f.controller.present({ droneId: 'a', tabIds: ['draft'], presentation: 'tabs' }).files[0]
      ?.panelId,
  ).toBe('tool:editor');
  expect(f.target().tabs[0]).toBe(tab);
  expect(tab.content).toBe('unsaved draft');
  expect(f.panes.size).toBe(0);
});

test('revocation during read stops editor changes', async () => {
  const f = fixture();
  f.duringRead(f.deny);
  expect((await f.controller.open({ droneId: 'a', paths: ['one.ts'] })).files[0]).toMatchObject({
    status: 'failed',
    error: 'Read access denied',
  });
  expect(f.accepted).toEqual([]);
});

test('navigating away and back during a read cancels all remaining file opens', async () => {
  const f = fixture();
  f.duringRead(f.navigate);
  const result = await f.controller.open({ droneId: 'a', paths: ['one.ts', 'two.ts'] });
  expect(result.files).toHaveLength(2);
  expect(result.files.every((file) => file.status === 'failed')).toBe(true);
  expect(result.layout).toBeUndefined();
  expect(f.accepted).toEqual([]);
});

test('mobile or hidden workspace fails before any file request or tab mutation', async () => {
  const f = fixture();
  f.unsupported();
  await expect(f.controller.open({ droneId: 'a', paths: ['one.ts'] })).rejects.toThrow(
    'EDITOR_WORKSPACE_UNAVAILABLE',
  );
  expect(f.requests).toEqual([]);
  expect(f.accepted).toEqual([]);
});

test('presentation validates the entire batch before moving any tab', () => {
  const f = fixture();
  f.target().tabs.push({ tabId: 'one', path: '/repo/one', name: 'one' });
  expect(() =>
    f.controller.present({ droneId: 'a', tabIds: ['one', 'gone'], presentation: 'panes' }),
  ).toThrow('STALE_EDITOR_TAB');
  expect(f.panes.size).toBe(0);
});

test('a workspace hidden during a file read cannot receive new tabs', async () => {
  const f = fixture();
  f.duringRead(f.unsupported);
  const result = await f.controller.open({ droneId: 'a', paths: ['one.ts'] });
  expect(result.files[0]).toMatchObject({
    status: 'failed',
    error: 'EDITOR_WORKSPACE_UNAVAILABLE',
  });
  expect(f.accepted).toEqual([]);
  expect(f.panes.size).toBe(0);
});

test('changing existing file presentation requires an explicit choice', () => {
  const f = fixture();
  f.target().tabs.push({ tabId: 'one', path: '/repo/one', name: 'one' });
  expect(() => f.controller.present({ droneId: 'a', tabIds: ['one'] })).toThrow(
    'INVALID_FILE_PRESENTATION',
  );
  expect(f.panes.size).toBe(0);
});

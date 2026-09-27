import React from 'react';
import { afterEach, beforeEach, expect, test, spyOn } from 'bun:test';
import { Window } from 'happy-dom';
import type { Root } from 'react-dom/client';
import type { CompanionEditorTarget } from '../src/droneHub/files/CompanionEditorFiles';
import type { useFileEditorState } from '../src/droneHub/app/use-file-editor-state';
import { createPortal } from 'react-dom';
import { EditorPaneContext } from '../src/droneHub/app/editor-pane-context';
import { ChangesExplorerContext } from '../src/droneHub/changes/changes-explorer-context';

let dom: Window;
let root: Root | undefined;
const previous = new Map<string, PropertyDescriptor | undefined>();
const settle = () => new Promise((resolve) => setTimeout(resolve, 25));
beforeEach(() => {
  dom = new Window();
  for (const key of [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'Element',
    'HTMLDivElement',
    'Node',
    'MouseEvent',
    'PointerEvent',
    'KeyboardEvent',
    'Event',
    'CustomEvent',
    'MutationObserver',
    'ResizeObserver',
    'localStorage',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'fetch',
  ]) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    if (key !== 'fetch')
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value: (dom as any)[key],
      });
  }
  Object.defineProperty(dom.HTMLElement.prototype, 'clientWidth', { get: () => 1600 });
  Object.defineProperty(dom.HTMLElement.prototype, 'clientHeight', { get: () => 1000 });
  dom.HTMLElement.prototype.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1600,
      bottom: 1000,
      width: 1600,
      height: 1000,
      toJSON() {},
    }) as any;
});
afterEach(async () => {
  const { flushSync } = await import('react-dom');
  flushSync(() => root?.unmount());
  root = undefined;
  dom.happyDOM.cancelAsync();
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as any)[key];
  }
});

async function editorFixture(renderToolPane: (tab: string) => React.ReactNode = () => <div>editor</div>) {
  const { createRoot } = await import('react-dom/client');
  const { flushSync } = await import('react-dom');
  const { DockableDroneWorkspace, ensureWorkspaceToolPanel } =
    await import('../src/droneHub/app/DockableDroneWorkspace');
  const { useFileEditorState } = await import('../src/droneHub/app/use-file-editor-state');
  const { CompanionEditorFiles } = await import('../src/droneHub/files/CompanionEditorFiles');
  const { WorkspaceWindowLayoutController } =
    await import('../src/droneHub/workspace-layout/WorkspaceWindowLayoutController');
  const { getWorkspaceLayoutSource } =
    await import('../src/droneHub/workspace-layout/workspace-layout-events');
  let editor!: ReturnType<typeof useFileEditorState>, target!: CompanionEditorTarget;
  const session = Symbol(),
    closed: string[] = [];
  const drone = {
    id: 'integration',
    name: 'integration',
    runtime: 'host',
    repoPath: '/repo',
    chats: ['default'],
  } as any;
  const request = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    if (url === '/api/companion/editor-file') {
      const input = JSON.parse(String(init?.body));
      return {
        path: input.path.startsWith('/') ? input.path : '/repo/' + input.path,
        workspaceId: 'host:test',
      } as T;
    }
    if (url.includes('/fs/file'))
      return {
        ok: true,
        kind: 'text',
        path: new URL(url, 'http://local').searchParams.get('path'),
        name: 'one.ts',
        content: 'saved',
        revision: 'r1',
        size: 5,
      } as T;
    return {} as T;
  };
  function App() {
    const [detached, setDetached] = React.useState<string[]>([]);
    editor = useFileEditorState({
      currentDrone: drone,
      requestJson: request,
      onRefreshFsList() {},
      hostedTabIds: detached,
    });
    target = {
      droneId: drone.id,
      session,
      tabs: editor.openedFileTabs,
      accept: (data) => editor.acceptCompanionFile(drone.id, data),
      activate: editor.setActiveOpenedFileTab,
    };
    return (
      <DockableDroneWorkspace
        currentDrone={drone}
        paneHeaderMode="normal"
        activeToolTab="changes"
        openRequestNonce={1}
        chatContent={<div>chat</div>}
        renderToolPane={renderToolPane}
        previewTab="preview"
        fileWindows={{
          openTabIds: editor.openedFileTabs.map((tab) => tab.tabId),
          render: () => <div>file</div>,
          onDetachedTabsChange: setDetached,
          onClosed: (id) => {
            closed.push(id);
            editor.closeEditorFile(id);
          },
        }}
      />
    );
  }
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(<App />));
  await settle();
  const layouts = new WorkspaceWindowLayoutController();
  const files = new CompanionEditorFiles(
    () => target,
    request,
    () => layouts.read(drone.id),
  );
  const api = getWorkspaceLayoutSource(drone.id)!.api;
  flushSync(() => ensureWorkspaceToolPanel(api, 'changes', 'single'));
  return { files, api, closed, flushSync, host, editor: () => editor };
}

test('Editor, Changes, and both explorers remain rendered when independently moved and restored', async () => {
  const { ensureWorkspaceToolPanel, migrateEditorChangesPanels, migrateWorkspaceExplorerPanels } =
    await import('../src/droneHub/app/DockableDroneWorkspace');
  function Tool({ tab }: { tab: string }) {
    const pane = React.useContext(EditorPaneContext);
    const changesHost = React.useContext(ChangesExplorerContext);
    if (tab === 'editor') return <div data-test-pane={pane === 'explorer' ? 'file-explorer' : 'editor'} />;
    return <>
      <div data-test-pane="changes" />
      {changesHost ? createPortal(<div data-test-pane="changes-explorer" />, changesHost) : null}
    </>;
  }
  const f = await editorFixture((tab) => <Tool tab={tab} />);
  f.flushSync(() => ensureWorkspaceToolPanel(f.api, 'editor', 'single'));
  await settle();
  const ids = ['tool:editor', 'file-explorer', 'tool:changes', 'changes-explorer'];
  const assertAllRendered = () => {
    for (const pane of ['editor', 'file-explorer', 'changes', 'changes-explorer']) {
      expect(f.host.querySelectorAll(`[data-test-pane="${pane}"]`)).toHaveLength(1);
    }
    expect(new Set(ids.map((id) => f.api.getPanel(id)!.group)).size).toBe(4);
  };
  assertAllRendered();
  const editorGroup = f.api.getPanel('tool:editor')!.group;
  const changesGroup = f.api.getPanel('tool:changes')!.group;
  f.flushSync(() => {
    f.api.getPanel('changes-explorer')!.api.moveTo({ group: editorGroup, position: 'left' });
    f.api.getPanel('file-explorer')!.api.moveTo({ group: changesGroup, position: 'below' });
  });
  await settle();
  assertAllRendered();
  expect(f.api.getPanel('tool:editor')!.group).toBe(editorGroup);
  expect(f.api.getPanel('tool:changes')!.group).toBe(changesGroup);

  const saved = f.api.toJSON();
  f.flushSync(() => {
    f.api.fromJSON(saved, { reuseExistingPanels: true });
    migrateEditorChangesPanels(f.api);
    migrateWorkspaceExplorerPanels(f.api);
  });
  await settle();
  assertAllRendered();
  expect(f.api.toJSON().grid).toEqual(saved.grid);

  f.flushSync(() => f.api.getPanel('changes-explorer')!.api.close());
  await settle();
  const closedLayout = f.api.toJSON();
  f.flushSync(() => {
    f.api.fromJSON(closedLayout);
    migrateEditorChangesPanels(f.api);
    migrateWorkspaceExplorerPanels(f.api);
  });
  await settle();
  expect(f.host.querySelector('[data-test-pane="changes-explorer"]')).toBeNull();
  expect(f.host.querySelector('[data-test-pane="file-explorer"]')).not.toBeNull();
  expect(f.host.querySelector('[data-test-pane="editor"]')).not.toBeNull();
  expect(f.host.querySelector('[data-test-pane="changes"]')).not.toBeNull();
  f.flushSync(() => ensureWorkspaceToolPanel(f.api, 'changes', 'single'));
  await settle();
  assertAllRendered();
});

test('real editor and Dockview preserve drafts, keep Changes open, and return a stable layout', async () => {
  const f = await editorFixture();
  const result = await f.files.open({
    droneId: 'integration',
    paths: ['one.ts', 'two.ts'],
    presentation: 'panes',
  });
  expect(result.ok).toBe(true);
  const ids = result.files.map((file) => String(file.tabId));
  f.flushSync(() => f.editor().setFileTabContent(ids[0]!, 'unsaved draft'));
  expect(
    (await f.files.open({ droneId: 'integration', paths: ['one.ts'], presentation: 'panes' }))
      .files[0]?.reused,
  ).toBe(true);
  const returned = f.files.present({ droneId: 'integration', tabIds: ids, presentation: 'tabs' });
  await settle();
  expect(f.closed).toEqual([]);
  expect(f.editor().openedFileTabs).toHaveLength(2);
  expect(f.editor().openedFileTabs.find((tab) => tab.tabId === ids[0])?.content).toBe(
    'unsaved draft',
  );
  expect(returned.files.every((file) => file.panelId === 'tool:editor')).toBe(true);
  expect(f.api.getPanel('tool:changes')!.params?.tab).toBe('changes');
  expect(f.api.getPanel('changes-explorer')).toBeDefined();
  expect(f.api.getPanel('file-explorer')).toBeDefined();
  expect(returned.layout.layoutRevision).toBe(f.files.readLayout().layoutRevision);
});

test('closing windows immediately after reattaching does not suppress a later real file close', async () => {
  const f = await editorFixture();
  const { workspacePresetTarget } = await import('../src/droneHub/app/workspace-preset-target');
  const result = await f.files.open({
    droneId: 'integration',
    paths: ['one.ts'],
    presentation: 'panes',
  });
  const tabId = String(result.files[0]!.tabId);
  f.files.present({ droneId: 'integration', tabIds: [tabId], presentation: 'tabs' });
  f.flushSync(() => workspacePresetTarget('integration')!.closeDockedWindows());
  const reopened = f.files.present({
    droneId: 'integration',
    tabIds: [tabId],
    presentation: 'panes',
  });
  f.flushSync(() => f.api.removePanel(f.api.getPanel(reopened.files[0]!.panelId!)!));
  await settle();
  expect(f.closed).toEqual([tabId]);
  expect(f.editor().openedFileTabs).toHaveLength(0);
});

test('Read shortcut preserves grants and refreshes the new drone after an in-flight save', async () => {
  const { createRoot } = await import('react-dom/client');
  const { flushSync } = await import('react-dom');
  const { ActiveComposerProvider } = await import('../src/droneHub/chat/ActiveComposerContext');
  const { CompanionWorkspaceProvider, useCompanionWorkspace } =
    await import('../src/droneHub/companion/CompanionWorkspaceContext');
  const { CompanionCurrentWorkspaceAccess } =
    await import('../src/droneHub/companion/CompanionCurrentWorkspaceAccess');
  const host = {
    id: 'host:repo',
    kind: 'host',
    name: 'my-repo',
    path: '/repo',
    deviceName: 'Home',
    read: true,
    write: true,
    execute: true,
  };
  const container = { ...host, id: 'drone:falcon', kind: 'drone', name: 'Falcon' };
  const other = { ...host, id: 'host:other', name: 'other' };
  let droneId = 'host-drone',
    revision = 0;
  let access = { targets: [other], defaultTargetId: other.id };
  let finishSave!: () => void;
  const posted: any[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      posted.push(body);
      if (posted.length === 1)
        await new Promise<void>((resolve) => {
          finishSave = resolve;
        });
      access = body.access;
      revision++;
    }
    return new Response(
      JSON.stringify({
        target: droneId === 'host-drone' ? host : container,
        access,
        revision: String(revision),
        workspaces: [host, container, other],
        devices: [],
      }),
    );
  }) as typeof fetch;
  function Registered() {
    const workspace = useCompanionWorkspace()!;
    React.useLayoutEffect(
      () =>
        workspace.registerWorkspaceTarget({
          getAppContext: () => ({ mainDroneId: droneId }),
        } as any),
      [workspace],
    );
    return <CompanionCurrentWorkspaceAccess refreshKey={false} />;
  }
  const node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
  flushSync(() =>
    root!.render(
      <ActiveComposerProvider>
        <CompanionWorkspaceProvider>
          <Registered />
        </CompanionWorkspaceProvider>
      </ActiveComposerProvider>,
    ),
  );
  await settle();
  expect(node.textContent).toContain('Allow Read · my-repo');
  node.querySelector('button')!.click();
  droneId = 'falcon';
  window.dispatchEvent(new Event('focus'));
  await settle();
  finishSave();
  await settle();
  expect(node.textContent).toContain('Allow Read · Falcon');
  expect(posted).toHaveLength(1);
  expect(access.defaultTargetId).toBe(host.id);
  expect(access.targets[0]).toEqual(other);
  expect(access.targets[1]).toMatchObject({ read: true, write: false, execute: false });
  node.querySelector('button')!.click();
  await settle();
  expect(posted[1].revision).toBe('1');
  expect(access.defaultTargetId).toBe(container.id);
});

test('saving Companion text keeps the editor open until explicitly closed', async () => {
  const { createRoot } = await import('react-dom/client');
  const { flushSync } = await import('react-dom');
  const { CompanionTextEditor } = await import('../src/droneHub/companion/CompanionTextEditor');
  const editorModule = await import('../src/droneHub/chat/ChatComposerEditor');
  const editorStub = spyOn(editorModule, 'ChatComposerEditor').mockImplementation(() => <textarea />);
  try {
  let saves = 0, closes = 0;
  function App() {
    const [dirty, setDirty] = React.useState(true);
    return <CompanionTextEditor id="prompt" title="Companion system prompt"
      content="Updated instructions" maxChars={50000} loading={false} saving={false}
      error="" dirty={dirty} onChange={() => {}} load={async () => {}}
      save={async () => { saves++; setDirty(false); return true; }}
      onClose={() => { closes++; }} />;
  }
  const node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
  flushSync(() => root!.render(<App />));
  const button = (text: string) => Array.from(node.querySelectorAll('button')).find(b => b.textContent === text)!;
  button('Save').click();
  await settle();
  expect(saves).toBe(1);
  expect(closes).toBe(0);
  expect(node.querySelector('[role="dialog"]')).not.toBeNull();
  button('Close').click();
  expect(closes).toBe(1);
  } finally { editorStub.mockRestore(); }
});

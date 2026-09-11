import type { WorkspaceWindowLayoutController } from '../workspace-layout/WorkspaceWindowLayoutController';
import { filePanelId } from '../app/file-tab-drag';
import { flushSync } from 'react-dom';
import { readDesktopFile } from './read-desktop-file';
import {
  presentCompanionFiles,
  type FilePresentation,
  type PresentedFile,
} from './companion-file-presentation';
import type { DroneFsReadPayload } from '../types';

type FileTab = PresentedFile & { loaded?: boolean; loading?: boolean; error?: string | null };
export type CompanionEditorTarget = {
  droneId: string;
  session: symbol;
  tabs: FileTab[];
  accept(data: Extract<DroneFsReadPayload, { ok: true }>): string;
  activate(tabId: string): void;
};
type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

export class CompanionEditorFiles {
  constructor(
    private readonly target: () => CompanionEditorTarget | null,
    private readonly request: RequestJson,
    private readonly layout: () => ReturnType<WorkspaceWindowLayoutController['read']>,
  ) {}

  readLayout() {
    const layout = this.layout();
    if (!layout.supported) return layout;
    const target = this.current(layout.workspaceId);
    return {
      ...layout,
      editorTabs: target.tabs.map((tab) => {
        const pane = layout.panels.find((panel) => panel.panelId === filePanelId(tab.tabId));
        return {
          tabId: tab.tabId,
          path: tab.path,
          name: tab.name,
          loaded: Boolean(tab.loaded),
          presentation: pane ? 'panes' : 'tabs',
          panelId:
            pane?.panelId ??
            layout.panels.find(
              (panel) => panel.panelId === 'tool:editor' || panel.panelId === 'tool:changes',
            )?.panelId ??
            null,
        };
      }),
    };
  }

  async open(args: Record<string, unknown>) {
    const target = this.current(args.droneId);
    if (!this.layout().supported) throw new Error('EDITOR_WORKSPACE_UNAVAILABLE');
    const presentation = presentationFrom(args.presentation);
    if (
      !Array.isArray(args.paths) ||
      !args.paths.length ||
      args.paths.length > 20 ||
      args.paths.some((path) => typeof path !== 'string' || !path.trim() || path.length > 4096)
    )
      throw new Error('INVALID_FILE_PATHS');
    const files: Record<string, unknown>[] = [];
    for (const path of args.paths) {
      let opened: { tabId: string; path: string } | undefined;
      try {
        this.stillCurrent(target);
        const authorized = await this.request<{ path: string; workspaceId: string }>(
          '/api/companion/editor-file',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ droneId: target.droneId, workspaceId: args.workspaceId, path }),
          },
        );
        const live = this.stillCurrent(target);
        const existing = live.tabs.find((tab) => tab.path === authorized.path && tab.loaded);
        let tabId = '';
        if (existing) {
          tabId = existing.tabId;
          flushSync(() => this.stillCurrent(target).activate(tabId));
        } else {
          const data = await readDesktopFile(this.request, target.droneId, authorized.path);
          await this.request('/api/companion/editor-file', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              droneId: target.droneId,
              workspaceId: authorized.workspaceId,
              path: authorized.path,
            }),
          });
          this.stillCurrent(target);
          flushSync(() => {
            tabId = this.stillCurrent(target).accept(data);
          });
        }
        opened = { tabId, path: authorized.path };
        const tab = this.stillCurrent(target).tabs.find((tab) => tab.tabId === tabId);
        if (!tab) throw new Error('EDITOR_TAB_NOT_READY');
        let panelIds: string[] = [];
        flushSync(() => {
          panelIds = presentCompanionFiles(target.droneId, [tab], presentation);
        });
        files.push({
          ...opened,
          requestedPath: path,
          panelId: panelIds[0],
          status: 'opened',
          reused: Boolean(existing),
        });
      } catch (error) {
        files.push({
          requestedPath: path,
          ...opened,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
        if (this.target()?.session !== target.session) {
          for (const skipped of args.paths.slice(files.length))
            files.push({
              requestedPath: skipped,
              status: 'failed',
              error: 'DRONE_NOT_OPEN: navigation interrupted file opening',
            });
          break;
        }
      }
    }
    return {
      ok: files.length === args.paths.length && files.every((file) => file.status === 'opened'),
      files,
      ...(this.target()?.session === target.session ? { layout: this.readLayout() } : {}),
    };
  }

  present(args: Record<string, unknown>) {
    const target = this.current(args.droneId);
    if (!this.layout().supported) throw new Error('EDITOR_WORKSPACE_UNAVAILABLE');
    if (args.presentation === undefined) throw new Error('INVALID_FILE_PRESENTATION');
    const presentation = presentationFrom(args.presentation);
    if (
      !Array.isArray(args.tabIds) ||
      !args.tabIds.length ||
      args.tabIds.length > 20 ||
      new Set(args.tabIds).size !== args.tabIds.length
    )
      throw new Error('INVALID_TAB_IDS');
    const tabs = args.tabIds.map((id) => {
      const tab = target.tabs.find((tab) => tab.tabId === id);
      if (!tab) throw new Error('STALE_EDITOR_TAB');
      return tab;
    });
    let panelIds: string[] = [];
    flushSync(() => {
      panelIds = presentCompanionFiles(target.droneId, tabs, presentation);
      this.stillCurrent(target).activate(tabs[tabs.length - 1]!.tabId);
    });
    return {
      ok: true,
      files: tabs.map((tab, index) => ({
        tabId: tab.tabId,
        path: tab.path,
        panelId: panelIds[index],
      })),
      layout: this.readLayout(),
    };
  }

  private stillCurrent(captured: CompanionEditorTarget) {
    const target = this.current(captured.droneId);
    if (target.session !== captured.session)
      throw new Error('DRONE_NOT_OPEN: navigation interrupted file opening');
    const layout = this.layout();
    if (!layout.supported || layout.workspaceId !== captured.droneId)
      throw new Error('EDITOR_WORKSPACE_UNAVAILABLE');
    return target;
  }

  private current(droneId: unknown): CompanionEditorTarget {
    const target = this.target();
    if (!target?.droneId || typeof droneId !== 'string' || target.droneId !== droneId)
      throw new Error('DRONE_NOT_OPEN: open that drone before changing its editor');
    return target;
  }
}

function presentationFrom(value: unknown): FilePresentation {
  if (value === undefined) return 'tabs';
  if (value !== 'tabs' && value !== 'panes') throw new Error('INVALID_FILE_PRESENTATION');
  return value;
}

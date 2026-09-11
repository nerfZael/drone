import { workspacePanelConstraints } from './workspace-panel-constraints';
import { CHAT_LAYOUT_UNDO } from '../chat-layout/chat-window-layout-events';
import { measureSideChatBounds } from '../app/side-chat-workspace-state';
import { applyWorkspaceLayout } from './applyWorkspaceLayout';
import { getWorkspaceLayoutSource } from './workspace-layout-events';
import { readWorkspaceLayoutTree, validateWorkspaceLayout, workspaceLayoutPanelIds, type WorkspaceLayoutNode } from './workspace-layout-tree';

type Snapshot = { layout: WorkspaceLayoutNode; floating: { panels: string[]; bounds: { x: number; y: number; width: number; height: number } }[]; activePanel?: string; activeTabs: string[] };

export class WorkspaceWindowLayoutController {
  private signature = '';
  private revision = 0;
  private previous: { workspaceId: string; revision: string; snapshot: Snapshot } | null = null;

  read(workspaceId: string) {
    const source = getWorkspaceLayoutSource(workspaceId);
    if (!source) return { supported: false as const, workspaceId, reason: 'No visible desktop workspace' };
    const { api, root } = source;
    const serialized = api.toJSON();
    const panels = api.panels.map(panel => ({
      panelId: panel.id, title: panel.api.title ?? panel.id, groupId: panel.group.id,
      kind: panel.id.startsWith('file-tab:') ? 'file' : panel.id === 'agent-chat' ? 'chat' : panel.id.startsWith('side-chat:') ? 'side_chat' : 'tool',
      ...(panel.id.startsWith('file-tab:') && typeof panel.params?.path === 'string' ? { filePath: panel.params.path } : {}),
      location: panel.group.api.location.type,
      ...workspacePanelConstraints(panel),
      bounds: measureSideChatBounds(panel.group.element, root),
    }));
    const layout = readWorkspaceLayoutTree(serialized.grid.root, serialized.grid.orientation === 'HORIZONTAL' ? 'row' : 'column');
    const maximized = api.groups.some(group => group.api.isMaximized());
    const signature = JSON.stringify({ workspaceId, width: api.width, height: api.height, panels, layout, maximized });
    if (signature !== this.signature) { this.signature = signature; this.revision++; }
    return { supported: true as const, workspaceId, layoutRevision: String(this.revision),
      viewport: { width: api.width, height: api.height }, panels, layout, maximized,
      activePanelId: api.activePanel?.id ?? null,
      instructions: 'Arrange existing panels only. Include every docked panel once; a leaf with multiple IDs keeps them as tabs. Floating panels can be included to dock them. Rows run left to right; columns run top to bottom. No file contents or filesystem access are provided.' };
  }

  arrange(workspaceId: string, args: Record<string, unknown>) {
    const current = this.read(workspaceId);
    if (!current.supported) throw new Error('WORKSPACE_LAYOUT_UNSUPPORTED');
    if (args.workspaceId !== workspaceId || args.layoutRevision !== current.layoutRevision) throw new Error('STALE_WORKSPACE_LAYOUT: read get_workspace_window_layout again');
    if (current.maximized) throw new Error('WORKSPACE_MAXIMIZED: restore the maximized panel before arranging');
    const source = getWorkspaceLayoutSource(workspaceId)!;
    const { api } = source;
    let undo: Snapshot | undefined;
    let layout: WorkspaceLayoutNode;
    if (args.mode === 'undo') {
      if (!this.previous || this.previous.workspaceId !== workspaceId || this.previous.revision !== current.layoutRevision) throw new Error('NO_CURRENT_LAYOUT_UNDO');
      undo = this.previous.snapshot; layout = undo.layout;
    } else {
      if (args.mode !== undefined && !['rows', 'columns', 'custom'].includes(String(args.mode))) throw new Error('INVALID_LAYOUT_MODE');
      let input = args.layout;
      if (args.mode === 'rows' || args.mode === 'columns') {
        const ids = args.panelIds ?? current.panels.filter(p => p.location === 'grid').map(p => p.panelId);
        if (!Array.isArray(ids) || !ids.length || ids.length > 100) throw new Error('INVALID_PANEL_IDS');
        input = ids.length === 1 ? { panels: ids } : { direction: args.mode === 'rows' ? 'column' : 'row', children: ids.map(id => ({ panels: [id] })) };
      }
      layout = validateWorkspaceLayout(input, current.panels, current.viewport.width, current.viewport.height);
    }
    const affected = new Set(workspaceLayoutPanelIds(layout));
    const snapshot: Snapshot = {
      layout: current.layout,
      floating: api.groups.filter(g => g.api.location.type === 'floating' && g.panels.some(p => affected.has(p.id))).map(g => ({ panels: g.panels.map(p => p.id), bounds: measureSideChatBounds(g.element, source.root) })),
      activePanel: api.activePanel?.id, activeTabs: api.groups.flatMap(g => g.activePanel ? [g.activePanel.id] : []),
    };
    const focused = document.activeElement as HTMLElement | null;
    const scrollPositions = [...source.root.querySelectorAll<HTMLElement>('[data-chat-transcript-scroll]')].map(element => ({ element, top: element.scrollTop, left: element.scrollLeft }));
    source.transaction(() => {
      let completed = false;
      try { if (undo) restore(undo); else applyWorkspaceLayout(api, layout); completed = true; }
      catch (error) { restore(snapshot); throw error; }
      finally {
        const focus = completed && undo ? undo : snapshot;
        focus.activeTabs.forEach(id => {
          const panel = api.getPanel(id);
          if (panel) panel.group.model.openPanel(panel, { skipSetGroupActive: true });
        });
        if (focus.activePanel) api.getPanel(focus.activePanel)?.api.setActive();
        focused?.focus({ preventScroll: true });
        scrollPositions.forEach(({ element, top, left }) => { element.scrollTop = top; element.scrollLeft = left; });
      }
    });
    const result = this.read(workspaceId);
    this.previous = undo ? null : { workspaceId, revision: result.supported ? result.layoutRevision : '', snapshot };
    const revision = this.previous?.revision;
    window.dispatchEvent(new CustomEvent(CHAT_LAYOUT_UNDO, { detail: { workspaceId, undo: revision ? () => this.arrange(workspaceId, { workspaceId, layoutRevision: revision, mode: 'undo' }) : null } }));
    return { ok: true, ...result };

    function restore(state: Snapshot) {
      for (const group of state.floating) {
        const first = api.getPanel(group.panels[0]!);
        if (!first) throw new Error('UNDO_PANEL_UNAVAILABLE');
        api.addFloatingGroup(first, group.bounds);
        for (const id of group.panels.slice(1)) api.getPanel(id)!.api.moveTo({ group: first.group, position: 'center', skipSetActive: true });
      }
      applyWorkspaceLayout(api, state.layout);
    }
  }
}

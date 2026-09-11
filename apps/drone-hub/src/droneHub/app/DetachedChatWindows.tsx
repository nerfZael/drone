import { SideChatForkContext } from '../chat/SideChatForkContext';
import React from 'react';
import { DockviewReact, type DockviewApi, type IDockviewPanelProps, type IDockviewPanelHeaderProps, type IDockviewHeaderActionsProps } from 'dockview';
import 'dockview/dist/styles/dockview.css';
import type { DroneSummary } from '../types';
import { ChatSurface, adaptNativeAgentChatSurface } from '../chat';
import { AssistantDock } from '../assistant/AssistantDock';
import { dispatchAssistantOpenDroneChat } from '../assistant/open-drone-chat-event';
import { GroupMultiChatColumn, type GroupMultiChatColumnProps } from './GroupMultiChatColumn';
import { requestJson } from '../http';
import { droneHomePath } from './helpers';
import { detachedChatKey, DETACHED_CHAT_BEFORE_ATTACH_EVENT, DETACHED_CHAT_FOCUS_EVENT, useDetachedChatStore, type DetachedChat } from './detached-chat-store';
import { placeDetachedChat } from './detached-chat-placement';
import { measureSideChatBounds } from './side-chat-workspace-state';
import { prepareSideChatPanel } from './prepareSideChatPanel';
import { focusChatWindow } from './focus-chat-window';
import { requestChatFileOpen } from './chat-file-navigation';
import { IconDetachedChat } from './DetachedChatIndicator';
import { ChatWindowTab } from './ChatWindowTab';

export type DetachedChatWindowsProps = {
  drones: DroneSummary[];
  currentDroneId: string | null;
  visible: boolean;
  activeChatAgent?: { droneId: string; chatName: string; agent: { kind: string; id?: string } } | null;
  onSendPromptInNewChat: (drone: DroneSummary, ...args: [...Parameters<GroupMultiChatColumnProps['onSendPromptInNewChat']>, string]) => Promise<boolean>;
  onCreateQueuedNewChatNow: (id: string, source: { droneId: string; chatName: string }) => Promise<void>;
  onRenameChat?: (droneId: string, chatName: string, newName: string) => Promise<{ ok: boolean; chatName?: string; error?: string | null }>;
} & Pick<GroupMultiChatColumnProps, 'onCreateNewChatAutoFocusHandled' | 'promotingNewChatActionById' | 'promoteNewChatActionErrorById' | 'onAutoRenameChatFromFirstPrompt'>;

const WindowContext = React.createContext<DetachedChatWindowsProps | null>(null);
const nativeAdapter = adaptNativeAgentChatSurface();

function DetachedChatContent({ chat, drone, context }: { chat: DetachedChat; drone: DroneSummary; context: DetachedChatWindowsProps }) {
  const [agent, setAgent] = React.useState<{ kind: string; id?: string } | null>(null);
  const [error, setError] = React.useState('');
  const [retry, setRetry] = React.useState(0);
  const [publishing, setPublishing] = React.useState(false);
  const [publishError, setPublishError] = React.useState('');
  const draftDrone = drone.draft === true || drone.hubPhase === 'draft';
  const draft = draftDrone || drone.draftChats?.[chat.chatName] === true;
  const configuredAgent = context.activeChatAgent?.droneId === chat.droneId && context.activeChatAgent.chatName === chat.chatName
    ? context.activeChatAgent.agent : null;
  React.useEffect(() => {
    if (configuredAgent) {
      setAgent(configuredAgent);
      setError('');
      return;
    }
    const controller = new AbortController();
    setError('');
    void requestJson<{ agent: { kind: string; id?: string } }>(
      `/api/drones/${encodeURIComponent(chat.droneId)}/chats/${encodeURIComponent(chat.chatName)}/state?turn=last&config=true&activity=summary`,
      { signal: controller.signal },
    ).then((data) => { if (!controller.signal.aborted) setAgent(data.agent); })
      .catch((err) => { if (!controller.signal.aborted) setError(String(err?.message ?? err)); });
    return () => controller.abort();
  }, [chat.droneId, chat.chatName, draft, retry, configuredAgent?.kind, configuredAgent?.id]);
  const publish = async () => {
    if (publishing) return false;
    setPublishing(true);
    setPublishError('');
    try {
      const base = `/api/drones/${encodeURIComponent(chat.droneId)}`;
      await requestJson(draftDrone ? `${base}/publish` : `${base}/chats/${encodeURIComponent(chat.chatName)}/publish`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      });
      return true;
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : String(err));
      return false;
    } finally { setPublishing(false); }
  };
  const onOpenFileReference = (ref: Parameters<typeof requestChatFileOpen>[0]['ref']) => requestChatFileOpen({ droneId: drone.id, chatName: chat.chatName, ref });
  const actions = {
    onSendPromptInNewChat: (...args: Parameters<GroupMultiChatColumnProps['onSendPromptInNewChat']>) => context.onSendPromptInNewChat(drone, ...args, chat.chatName),
    onCreateQueuedNewChatNow: (id: string) => context.onCreateQueuedNewChatNow(id, { droneId: drone.id, chatName: chat.chatName }),
    onCreateNewChatAutoFocusHandled: context.onCreateNewChatAutoFocusHandled,
    promotingNewChatActionById: context.promotingNewChatActionById,
    promoteNewChatActionErrorById: context.promoteNewChatActionErrorById,
  };
  if (error) return <div role="alert" className="p-3 text-[var(--red)]">{error}<button className="block underline" onClick={() => setRetry((n) => n + 1)}>Retry</button></div>;
  if (!agent) return <div role="status" className="p-3 text-[var(--muted)]">Loading chat…</div>;
  // Drafts queue prompts through the ordinary chat API until published. A
  // native session here would bypass that draft lifecycle.
  const content = agent.kind === 'native' && !draft ? (
    <ChatSurface adapter={nativeAdapter}>
      <AssistantDock {...actions} nativeChat={{ droneId: drone.id, chatName: chat.chatName }} autoFocus={false}
        focusTargetId={`detached:${detachedChatKey(drone.id, chat.chatName)}`}
        messageFeatures={{
          droneId: drone.id, droneHomePath: droneHomePath(drone), onOpenFileReference, onOpenLink: () => false,
          linkedPullRequestContext: { droneId: drone.id, repoPath: drone.repoPath ?? '', repoAttached: Boolean(drone.repoAttached ?? drone.repoPath), disabled: false, openPullRequestsData: null, openPullRequestsLoading: false, openPullRequestsError: null },
        }} />
    </ChatSurface>
  ) : <GroupMultiChatColumn {...actions} compact drone={drone} preferredChat={chat.chatName} onOpenFileReference={onOpenFileReference}
    onAutoRenameChatFromFirstPrompt={context.onAutoRenameChatFromFirstPrompt}
    onPublish={draft ? publish : undefined} publishing={publishing}
    onOpenDrone={() => dispatchAssistantOpenDroneChat(drone.id, chat.chatName)} onDeleteDrone={() => {}} focusedNewChatActionId="" columnWidthPx={320} />;
  return <SideChatForkContext.Provider value={{ droneId: drone.id, chatName: chat.chatName, busy: false, supported: !draft && (agent.kind === 'native' || ['codex', 'claude', 'opencode'].includes(agent.id ?? '')) }}>
    {publishError && <div role="alert" className="shrink-0 px-3 py-2 text-[var(--red)]">{publishError}</div>}
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{content}</div>
  </SideChatForkContext.Provider>;
}

function DetachedPanel({ params }: IDockviewPanelProps<{ chatKey: string }>) {
  const context = React.useContext(WindowContext)!;
  const chat = useDetachedChatStore((state) => state.chats[params.chatKey]);
  if (!chat?.open) return null;
  const drone = context.drones.find((item) => item.id === chat.droneId);
  const foreign = context.currentDroneId !== chat.droneId;
  const available = drone && [...drone.chats, ...(drone.workflowChats ?? [])].includes(chat.chatName);
  return (
    <div tabIndex={-1} data-side-chat-name={params.chatKey} data-detached-chat-key={params.chatKey} data-chat-drone-id={chat.droneId} data-chat-name={chat.chatName}
      className="dh-floating-chat flex h-full min-h-0 min-w-0 flex-col bg-[var(--chat-background)]">
      <button type="button" onClick={() => dispatchAssistantOpenDroneChat(chat.droneId, chat.chatName)}
        title={`Open ${drone?.name ?? chat.droneId} / ${chat.chatName}`}
        className={`flex shrink-0 items-center gap-2 border-b px-2 py-1 text-left text-11 ${foreign ? 'border-[var(--info)] bg-[var(--info-subtle)] text-[var(--info)]' : 'border-[var(--border)] text-[var(--muted)]'}`}>
        <IconDetachedChat /><span className="min-w-0 flex-1 truncate">{drone?.name ?? 'Unavailable drone'} · {chat.chatName}</span>
        {foreign && <span className="shrink-0">Other drone ↗</span>}
      </button>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {available ? <DetachedChatContent chat={chat} drone={drone} context={context} /> : <div role="status" className="p-3 text-[var(--muted)]">This chat is unavailable. Close this window to return to the workspace.</div>}
      </div>
    </div>
  );
}

function DetachedTab(props: IDockviewPanelHeaderProps) {
  const context = React.useContext(WindowContext)!;
  const chat = useDetachedChatStore((state) => state.chats[props.api.id]);
  const onRenameChat = context.onRenameChat;
  const rename = React.useCallback(async (newName: string) => {
    if (!chat || !onRenameChat) return { ok: false, error: 'Renaming is unavailable.' };
    // The renamed chat mounts as a new window; keep it where this one is.
    const panel = props.containerApi.getPanel(props.api.id);
    const root = panel?.group.element.closest('.dh-detached-chats');
    if (panel && root) {
      const bounds = measureSideChatBounds(panel.group.element, root);
      if (bounds.width > 0 && bounds.height > 0) useDetachedChatStore.getState().saveBounds(props.api.id, bounds);
    }
    return onRenameChat(chat.droneId, chat.chatName, newName);
  }, [chat, onRenameChat, props.containerApi, props.api.id]);
  return <ChatWindowTab {...props} data-side-chat-name={props.api.id} chatName={chat?.chatName ?? ''} droneId={chat?.droneId}
    onRename={chat && onRenameChat && chat.chatName !== 'default' ? rename : undefined} />;
}
function DetachedHeaderActions({ activePanel }: IDockviewHeaderActionsProps) {
  if (!activePanel) return null;
  return <button type="button" className="dh-chat-window-action" title="Return chat to workspace" aria-label="Return chat to workspace"
    onPointerDown={(event) => event.stopPropagation()}
    onClick={() => useDetachedChatStore.getState().attach(activePanel.id)}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
  </button>;
}
const components = { detached: DetachedPanel };
const noWatermark = () => null;

export function DetachedChatWindows(props: DetachedChatWindowsProps) {
  const chats = useDetachedChatStore((state) => state.chats);
  const apiRef = React.useRef<DockviewApi | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const cancelPendingFocusRef = React.useRef<(() => void) | null>(null);
  const visibleRef = React.useRef(props.visible);
  visibleRef.current = props.visible;
  const [ready, setReady] = React.useState(0);
  const [hostBounds, setHostBounds] = React.useState<React.CSSProperties>({});
  React.useLayoutEffect(() => {
    if (!props.visible) return;
    const host = rootRef.current?.parentElement;
    if (!host) return;
    let workspace: HTMLElement | null = null;
    const measure = () => {
      if (!workspace?.isConnected) return;
      const outer = host.getBoundingClientRect();
      const rect = workspace.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const next = { left: rect.x - outer.x, top: rect.y - outer.y, width: rect.width, height: rect.height, right: 'auto', bottom: 'auto' };
      setHostBounds((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    const bindWorkspace = () => {
      const next = host.querySelector<HTMLElement>('.dh-dockable-workspace:not(.dh-detached-chats), .dh-mobile-workspace');
      if (next === workspace) return;
      if (workspace) observer.unobserve(workspace);
      workspace = next;
      if (workspace) observer.observe(workspace);
      measure();
    };
    bindWorkspace();
    // Suspense and the mobile breakpoint replace the workspace element without
    // changing the selected drone. Follow the new element when that happens.
    const mutations = new MutationObserver(bindWorkspace);
    mutations.observe(host, { childList: true, subtree: true });
    return () => { observer.disconnect(); mutations.disconnect(); };
  }, [props.visible, props.currentDroneId]);
  const save = React.useCallback(() => {
    const api = apiRef.current;
    const root = rootRef.current;
    if (!api || !root || !visibleRef.current || api.width <= 0 || api.height <= 0) return;
    for (const panel of api.panels) {
      const bounds = measureSideChatBounds(panel.group.element, root);
      if (bounds.width > 0 && bounds.height > 0) useDetachedChatStore.getState().saveBounds(panel.id, bounds);
    }
  }, []);
  const focus = React.useCallback((key: string) => {
    const panel = apiRef.current?.getPanel(key);
    if (!panel) return;
    panel.api.setActive();
    cancelPendingFocusRef.current?.();
    const root = rootRef.current;
    if (!root) return;
    cancelPendingFocusRef.current = focusChatWindow(root,
      () => [...root.querySelectorAll<HTMLElement>('[data-detached-chat-key]')].find((node) => node.dataset.detachedChatKey === key),
      () => visibleRef.current && Boolean(useDetachedChatStore.getState().chats[key]?.open),
    );
  }, []);
  React.useEffect(() => () => {
    cancelPendingFocusRef.current?.();
  }, []);
  React.useEffect(() => {
    if (!props.visible) cancelPendingFocusRef.current?.();
  }, [props.visible]);

  React.useEffect(() => {
    const api = apiRef.current;
    const root = rootRef.current;
    if (!api || !root || !props.visible) return;
    for (const panel of api.panels) if (!chats[panel.id]?.open) api.removePanel(panel);
    for (const [key, chat] of Object.entries(chats)) {
      if (!chat.open || api.getPanel(key)) continue;
      const rootRect = root.getBoundingClientRect();
      const occupied = [...(root.closest('[data-drone-workspace-root]')?.querySelectorAll('.dv-groupview') ?? [])].map((group) => {
        const rect = group.getBoundingClientRect();
        return { x: rect.x - rootRect.x, y: rect.y - rootRect.y, width: rect.width, height: rect.height, floating: Boolean(group.closest('.dv-resize-container')) };
      }).filter((rect) => rect.width > 0 && rect.height > 0);
      const bounds = placeDetachedChat(api, occupied, api.panels.length, chat.bounds);
      const panel = api.addPanel({ id: key, component: 'detached', title: chat.chatName, params: { chatKey: key }, floating: bounds,
        minimumWidth: Math.min(280, api.width), minimumHeight: Math.min(220, api.height), inactive: true });
      prepareSideChatPanel(panel);
      panel.group.element.querySelector('.dv-void-container')?.setAttribute('title', 'Drag to move this detached chat. Close to return it to the workspace.');
      focus(key);
    }
  }, [chats, ready, props.visible, focus]);
  React.useEffect(() => {
    const listener = (event: Event) => focus((event as CustomEvent).detail?.key);
    window.addEventListener(DETACHED_CHAT_FOCUS_EVENT, listener);
    window.addEventListener(DETACHED_CHAT_BEFORE_ATTACH_EVENT, save);
    return () => {
      window.removeEventListener(DETACHED_CHAT_FOCUS_EVENT, listener);
      window.removeEventListener(DETACHED_CHAT_BEFORE_ATTACH_EVENT, save);
    };
  }, [focus, save]);
  React.useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = api.onDidLayoutChange(() => { clearTimeout(timer); timer = setTimeout(save, 100); });
    return () => { clearTimeout(timer); save(); subscription.dispose(); };
  }, [ready, save]);
  return (
    <WindowContext.Provider value={props}>
      <div ref={rootRef} aria-hidden={!props.visible} className="dh-dockable-workspace dh-detached-chats absolute inset-0 z-30 pointer-events-none"
        style={{ ...hostBounds, visibility: props.visible ? 'visible' : 'hidden' }}>
        <DockviewReact className="dockview-theme-dark dh-dockview h-full" components={components} defaultTabComponent={DetachedTab} rightHeaderActionsComponent={DetachedHeaderActions}
          watermarkComponent={noWatermark} disableDnd floatingGroupBounds="boundedWithinViewport"
          onReady={({ api }) => { apiRef.current = api; setReady((n) => n + 1); }} />
      </div>
    </WindowContext.Provider>
  );
}

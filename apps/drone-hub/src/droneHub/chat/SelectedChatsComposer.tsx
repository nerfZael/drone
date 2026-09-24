import React from 'react';
import { ChatInput, type ChatInputProps } from './ChatInput';
import type { DroneSummary } from '../types';
import type { CanvasChatTarget } from '../canvas/canvas-messaging';
import { SelectedChatsModelOverrides } from './SelectedChatsModelOverrides';
import type { ChatModelOverrides } from './selected-chat-model-overrides';
import { useDroneHubActiveDrag } from '../app/drone-hub-dnd';
import { droneNamesForReferences, pastedChatReferences } from '../app/chat-clipboard-store';
import {
  COMPOSER_REFERENCE_DRAG_TYPES,
  appendComposerReferences,
  composerReferenceTile,
  composerReferencesFromDragData,
  composerReferencesFromTransfer,
  mergeComposerReferences,
  type ComposerReference,
} from './composer-references';

function pointInElement(element: Element | null, x: number, y: number): boolean {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

type SelectedChatsComposerProps = {
  surface?: 'canvas' | 'chats';
  selectionKey: string;
  selectedCount: number;
  selectedLabel?: string | null;
  targets: CanvasChatTarget[];
  droneById: Record<string, DroneSummary>;
  expanded: boolean;
  sending: boolean;
  draft: string;
  spawnCountEnabled?: boolean;
  spawnCount?: string;
  hasDrafts?: boolean;
  spawnAgentKey?: string;
  error: string | null;
  onExpand: () => void;
  onDraftChange: (next: string) => void;
  onDraftContentChange?: ChatInputProps['onDraftContentChange'];
  onSpawnCountChange?: (next: string) => void;
  onSpawnCountBlur?: (event: React.FocusEvent<HTMLInputElement>) => void;
  onSend: (payload: Parameters<ChatInputProps['onSend']>[0], context: Parameters<ChatInputProps['onSend']>[1], overrides: ChatModelOverrides) => Promise<boolean>;
  /** Drones and chats dropped on the composer; their names and IDs are appended to the next message. */
  references: ComposerReference[];
  onReferencesChange: (next: ComposerReference[]) => void;
  /** Set while the host drags its own cards over the composer. */
  referenceDropActive?: boolean;
};

export function SelectedChatsComposer(props: SelectedChatsComposerProps) {
  const surface = props.surface ?? 'canvas';
  const [voiceRecordingActive, setVoiceRecordingActive] = React.useState(false);
  const expanded = props.expanded || voiceRecordingActive;
  // Clearing canvas selection hides the current composition; it is not a switch
  // from a new-drone draft to the regular broadcast draft.
  const draftPropsRef = React.useRef(props);
  if (surface !== 'canvas' || props.selectedCount > 0) draftPropsRef.current = props;
  const draftProps = draftPropsRef.current;
  const [overrides, setOverrides] = React.useState<ChatModelOverrides>({});
  React.useEffect(() => setOverrides({}), [draftProps.selectionKey]);
  const targetLabel = props.selectedLabel?.trim() || `${props.selectedCount} chats`;
  const rootRef = React.useRef<HTMLDivElement>(null);
  const referencesRef = React.useRef(props.references);
  referencesRef.current = props.references;
  const addReferences = (next: ComposerReference[]) => {
    if (!next.length) return;
    props.onReferencesChange(mergeComposerReferences(referencesRef.current, next));
    props.onExpand();
  };
  const addReferencesRef = React.useRef(addReferences);
  addReferencesRef.current = addReferences;
  const [nativeDropActive, setNativeDropActive] = React.useState(false);
  // Sidebar drags run through dnd-kit, so follow the pointer instead of drop events.
  const sidebarDrag = useDroneHubActiveDrag();
  const [sidebarDropActive, setSidebarDropActive] = React.useState(false);
  React.useEffect(() => {
    const references = composerReferencesFromDragData(sidebarDrag);
    setSidebarDropActive(false);
    if (!references.length) return;
    const view = rootRef.current?.ownerDocument.defaultView;
    if (!view) return;
    const over = (event: PointerEvent) => !rootRef.current?.hidden && pointInElement(rootRef.current, event.clientX, event.clientY);
    const onMove = (event: PointerEvent) => setSidebarDropActive(over(event));
    const onUp = (event: PointerEvent) => { if (over(event)) addReferencesRef.current(references); };
    view.addEventListener('pointermove', onMove);
    view.addEventListener('pointerup', onUp);
    return () => {
      view.removeEventListener('pointermove', onMove);
      view.removeEventListener('pointerup', onUp);
    };
  }, [sidebarDrag]);
  const acceptsNativeDrag = (event: React.DragEvent) =>
    COMPOSER_REFERENCE_DRAG_TYPES.some((type) => event.dataTransfer?.types?.includes?.(type));
  const dropActive = nativeDropActive || sidebarDropActive || Boolean(props.referenceDropActive);
  // Names that came with pasted references, for drones this window has no summary of.
  const [pastedDroneNames, setPastedDroneNames] = React.useState<Record<string, string>>({});
  const referenceDroneNames = React.useMemo(
    () => ({ ...droneNamesForReferences(pastedDroneNames), ...props.droneById }),
    [pastedDroneNames, props.droneById],
  );
  const referenceTiles = props.references.map((reference) => ({
    ...composerReferenceTile(reference, referenceDroneNames),
    onRemove: () => props.onReferencesChange(referencesRef.current.filter((item) => item !== reference)),
  }));
  return (
    <div ref={rootRef} data-selected-chats-composer="1"
      data-reference-drop-active={dropActive ? 'true' : undefined}
      // Drones and chats dragged in become references; the composer's own file drop never sees them.
      onDragEnterCapture={(event) => { if (acceptsNativeDrag(event)) { event.preventDefault(); event.stopPropagation(); setNativeDropActive(true); } }}
      onDragOverCapture={(event) => { if (acceptsNativeDrag(event)) { event.preventDefault(); event.stopPropagation(); } }}
      onDragLeave={(event) => {
        if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setNativeDropActive(false);
      }}
      onDropCapture={(event) => {
        if (!acceptsNativeDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setNativeDropActive(false);
        addReferences(composerReferencesFromTransfer(event.dataTransfer));
      }}
      // Drones and chats copied on the canvas or in the Chats window paste as references, like a drop.
      onPasteCapture={(event) => {
        const pasted = pastedChatReferences(event.clipboardData);
        if (!pasted) return;
        event.preventDefault();
        event.stopPropagation();
        setPastedDroneNames((current) => ({ ...current, ...pasted.droneNames }));
        addReferences(pasted.references);
      }}
      hidden={props.selectedCount <= 0 && surface === 'canvas' && !voiceRecordingActive}
      data-canvas-message-bar={surface === 'canvas' ? '1' : undefined}
      data-canvas-message-input={surface === 'canvas' ? '1' : undefined}
      className={surface === 'canvas'
        ? 'absolute bottom-2 left-1/2 z-20 w-[min(34rem,calc(100%-1rem))] -translate-x-1/2'
        : 'flex-shrink-0 px-2 pb-2 pt-1'}
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        // Let buttons and model menus keep their native keyboard navigation.
        // Otherwise Tab/Enter can bubble into the canvas or Chats send shortcuts.
        if (event.defaultPrevented || target.closest('[role="dialog"], [role="menu"], select') ||
          (['Enter', 'Tab', ' '].includes(event.key) && target.closest('button, a[href]'))) {
          event.stopPropagation();
        }
      }}>
      {!expanded ? <button type="button" onClick={props.onExpand}
        className={`mx-auto flex h-7 items-center rounded-md border bg-[var(--panel-overlay)] px-3 text-11 text-[var(--accent)] shadow-lg ${
          dropActive ? 'border-[var(--accent)]' : 'border-[var(--accent-muted)]'}`}>
        Message {targetLabel}
      </button> : null}
      {/* Keep the draft, attachments and recording alive when the bar is collapsed. */}
      <div hidden={!expanded}>
        <ChatInput resetKey={draftProps.selectionKey} droneName={targetLabel} focusTargetId={`${surface}:${draftProps.selectionKey}`}
          onVoiceRecordingActiveChange={setVoiceRecordingActive}
          draftValue={draftProps.draft} onDraftValueChange={draftProps.onDraftChange} onDraftContentChange={draftProps.onDraftContentChange}
          promptError={props.error} waiting={props.sending} disabled={props.sending} sendDisabled={props.selectedCount === 0} attachmentsEnabled attachmentMode="files"
          onSend={async (payload, context) => {
            if (props.selectedCount === 0) return false;
            const references = props.references;
            const sent = await props.onSend({ ...payload, prompt: appendComposerReferences(payload.prompt, references, referenceDroneNames) }, context, overrides);
            if (sent) {
              setOverrides({});
              props.onReferencesChange(referencesRef.current.filter((reference) => !references.includes(reference)));
            }
            return sent;
          }} referenceTiles={referenceTiles} referenceDropActive={dropActive} composerTrailingControls={
            // In the toolbar, where the agent chat keeps its model picker.
            <SelectedChatsModelOverrides targets={props.targets} droneById={props.droneById}
              draftAgentKey={props.hasDrafts ? props.spawnAgentKey : undefined}
              value={overrides} onChange={setOverrides} disabled={props.sending || props.selectedCount === 0} />
          } composerTopAction={
            // One line of context above the composer, like the agent chat's runtime/branch row.
            <div data-selected-chats-composer-meta="true" className="flex min-w-0 flex-1 items-center gap-2 px-1 text-11 text-[var(--muted)]">
              <span className="min-w-0 flex-1 truncate" title={targetLabel}>{props.selectedCount ? `To ${targetLabel}` : 'Select chats to message'}</span>
              {props.spawnCountEnabled ? <label className="flex flex-shrink-0 items-center gap-1">Spawn
                <input aria-label="Number of drones" value={props.spawnCount ?? '1'} inputMode="numeric" pattern="[0-9]*"
                  onChange={(event) => props.onSpawnCountChange?.(event.target.value)} onBlur={props.onSpawnCountBlur}
                  className="h-5 w-9 rounded border border-[var(--border)] bg-[var(--panel)] px-1 text-[var(--fg)]" />
              </label> : null}
            </div>
          } />
      </div>
    </div>
  );
}

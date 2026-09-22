import React from 'react';
import { ChatInput, type ChatInputProps } from './ChatInput';
import type { DroneSummary } from '../types';
import type { CanvasChatTarget } from '../canvas/canvas-messaging';
import { SelectedChatsModelOverrides } from './SelectedChatsModelOverrides';
import type { ChatModelOverrides } from './selected-chat-model-overrides';

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
  onCollapse: () => void;
  onDraftChange: (next: string) => void;
  onDraftContentChange?: ChatInputProps['onDraftContentChange'];
  onSpawnCountChange?: (next: string) => void;
  onSpawnCountBlur?: (event: React.FocusEvent<HTMLInputElement>) => void;
  onSend: (payload: Parameters<ChatInputProps['onSend']>[0], context: Parameters<ChatInputProps['onSend']>[1], overrides: ChatModelOverrides) => Promise<boolean>;
};

export function SelectedChatsComposer(props: SelectedChatsComposerProps) {
  const surface = props.surface ?? 'canvas';
  // Clearing canvas selection hides the current composition; it is not a switch
  // from a new-drone draft to the regular broadcast draft.
  const draftPropsRef = React.useRef(props);
  if (surface !== 'canvas' || props.selectedCount > 0) draftPropsRef.current = props;
  const draftProps = draftPropsRef.current;
  const [overrides, setOverrides] = React.useState<ChatModelOverrides>({});
  React.useEffect(() => setOverrides({}), [draftProps.selectionKey]);
  const targetLabel = props.selectedLabel?.trim() || `${props.selectedCount} chats`;
  return (
    <div data-selected-chats-composer="1"
      hidden={props.selectedCount <= 0 && surface === 'canvas'}
      data-canvas-message-bar={surface === 'canvas' ? '1' : undefined}
      data-canvas-message-input={surface === 'canvas' ? '1' : undefined}
      className={surface === 'canvas'
        ? 'absolute bottom-2 left-1/2 z-20 w-[min(34rem,calc(100%-1rem))] -translate-x-1/2'
        : 'flex-shrink-0 border-t border-[var(--border)] px-2 pb-2 pt-1'}
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
      {!props.expanded ? <button type="button" onClick={props.onExpand}
        className="mx-auto flex h-7 items-center rounded-md border border-[var(--accent-muted)] bg-[var(--panel-overlay)] px-3 text-11 text-[var(--accent)] shadow-lg">
        Message {targetLabel}
      </button> : null}
      {/* Keep the draft, attachments and recording alive when the bar is collapsed. */}
      <div hidden={!props.expanded}>
        <ChatInput resetKey={draftProps.selectionKey} droneName={targetLabel} focusTargetId={`${surface}:${draftProps.selectionKey}`}
          draftValue={draftProps.draft} onDraftValueChange={draftProps.onDraftChange} onDraftContentChange={draftProps.onDraftContentChange}
          promptError={props.error} waiting={props.sending} disabled={props.sending} sendDisabled={props.selectedCount === 0} attachmentsEnabled attachmentMode="files"
          onSend={async (payload, context) => {
            if (props.selectedCount === 0) return false;
            const sent = await props.onSend(payload, context, overrides);
            if (sent) setOverrides({});
            return sent;
          }} composerTopAction={
            // One line of context above the composer, like the agent chat's runtime/branch row.
            <div data-selected-chats-composer-meta="true" className="flex min-w-0 flex-1 items-center gap-2 px-1 text-11 text-[var(--muted)]">
              <span className="min-w-0 flex-1 truncate" title={targetLabel}>{props.selectedCount ? `To ${targetLabel}` : 'Select chats to message'}</span>
              {props.spawnCountEnabled ? <label className="flex flex-shrink-0 items-center gap-1">Spawn
                <input aria-label="Number of drones" value={props.spawnCount ?? '1'} inputMode="numeric" pattern="[0-9]*"
                  onChange={(event) => props.onSpawnCountChange?.(event.target.value)} onBlur={props.onSpawnCountBlur}
                  className="h-5 w-9 rounded border border-[var(--border)] bg-[var(--panel)] px-1 text-[var(--fg)]" />
              </label> : null}
              <SelectedChatsModelOverrides targets={props.targets} droneById={props.droneById}
                draftAgentKey={props.hasDrafts ? props.spawnAgentKey : undefined}
                value={overrides} onChange={setOverrides} disabled={props.sending || props.selectedCount === 0} />
              <button type="button" onClick={props.onCollapse} aria-label={`Collapse ${surface} composer`} title="Collapse composer"
                className="flex-shrink-0 rounded px-1 leading-none hover:bg-[var(--hover)]">⌄</button>
            </div>
          } />
      </div>
    </div>
  );
}

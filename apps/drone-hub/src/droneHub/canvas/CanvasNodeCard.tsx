import React from 'react';
import { canvasPerf } from './canvas-perf';
import { UiSpinner } from '../../ui/components';
import type { DroneSummary } from '../types';
import { DroneRuntimeIcon } from '../app/DroneRuntimeIndicator';
import type { DetailedCard } from './detailed-card-model';
import { SidebarItemStateIndicator } from '../overview/DroneCard';

export type DroneCanvasIndicatorState = {
  statusOk: boolean;
  statusError: string | null;
  statusChecking?: boolean;
  hubPhase?: DroneSummary['hubPhase'];
  hubMessage?: DroneSummary['hubMessage'];
  busy: boolean;
  unreadAgentMessage: boolean;
  lastAgentSnippet: string | null;
};

export type CanvasNodeActions = {
  onNodeMouseDown: (id: string, event: React.MouseEvent<HTMLButtonElement>) => void;
  onNodeClick: (id: string, event: React.MouseEvent<HTMLButtonElement>) => void;
  /** Double click: on the global board, opens the card's drone on its own board. F2 renames. */
  onNodeDoubleClick: (id: string, event: React.MouseEvent<HTMLButtonElement>) => void;
  /** The pointer is over a card (an id) or left it (null): the steps panel follows it. */
  hoverCard: (id: string | null) => void;
  setInlineRenameDraft: (value: string) => void;
  submitInlineRename: () => Promise<void>;
  cancelInlineRename: () => void;
  focusViewportElement: () => void;
};

type CanvasNodeCardProps = {
  /** Positioned by its slot in CanvasCardsLayer, so moving a card does not render it. */
  nodeId: string;
  /** What the card says: state, what is going on, time and cost. */
  detail: DetailedCard;
  draftNode: boolean;
  droneNode: boolean;
  canvasDroneId: string | null;
  nodeDroneId: string | null;
  selected: boolean;
  dragging: boolean;
  inlineEditing: boolean;
  assignmentHoverTarget: boolean;
  assignmentHoverTargetCount: number;
  isActiveSidebarChat: boolean;
  indicatorState: DroneCanvasIndicatorState | null;
  deleting: boolean;
  nodeWidth: number;
  nodeHeight: number;
  repoLabel: string;
  repoBranch: string;
  primaryLabel: string;
  showCanvasLastMessagePreviews: boolean;
  inlineRenameDraft: string;
  inlineRenameBusy: boolean;
  runtime: string | undefined;
  actions: React.MutableRefObject<CanvasNodeActions>;
  nodeElementByDroneIdRef: React.MutableRefObject<Record<string, HTMLButtonElement | null>>;
  inlineRenameInputRef: React.MutableRefObject<HTMLInputElement | null>;
  inlineRenameSettledRef: React.MutableRefObject<boolean>;
};

export const CanvasNodeCard = React.memo(function CanvasNodeCard({
  nodeId,
  detail,
  draftNode,
  droneNode,
  canvasDroneId,
  nodeDroneId,
  selected,
  dragging,
  inlineEditing,
  assignmentHoverTarget,
  assignmentHoverTargetCount,
  isActiveSidebarChat,
  indicatorState,
  deleting,
  nodeWidth,
  nodeHeight,
  repoLabel,
  repoBranch,
  primaryLabel,
  showCanvasLastMessagePreviews,
  inlineRenameDraft,
  inlineRenameBusy,
  runtime,
  actions,
  nodeElementByDroneIdRef,
  inlineRenameInputRef,
  inlineRenameSettledRef,
}: CanvasNodeCardProps) {
  const perfStart = canvasPerf.renderStart();
  React.useLayoutEffect(() => canvasPerf.renderEnd('card', perfStart));
  // A button would treat Space typed in the title field as a click on the card.
  const CardElement = (inlineEditing ? 'div' : 'button') as 'button';
  const lastAgentSnippet = indicatorState?.lastAgentSnippet ?? null;
  const deletingBadge = deleting ? (
    <span
      className="inline-flex items-center gap-1 rounded-[4px] border border-[var(--red-border)] bg-[var(--panel-overlay)] px-1.5 py-[1px] text-8 font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--red)]"
      style={{ fontFamily: 'var(--display)' }}
    >
      <UiSpinner size="small" label={null} inheritColor className="[&>span]:h-2.5 [&>span]:w-2.5" />
      Deleting
    </span>
  ) : null;
  // As in the sidebar, a new reply is flagged once the chat is idle, not while it works on.
  const unread = detail.unread && detail.icon === 'idle';
  // The green frame says drone; the icon says where it runs.
  const runtimeIcon = droneNode ? (
    <span
      className="flex h-3.5 w-3.5 flex-shrink-0 text-[var(--canvas-chat-owner)]"
      data-canvas-drone-runtime={runtime === 'host' ? 'host' : 'container'}
      title={runtime === 'host' ? 'Drone on the host' : 'Drone in a container'}
    >
      <DroneRuntimeIcon runtime={runtime === 'host' ? 'host' : 'container'} className="h-3.5 w-3.5" />
    </span>
  ) : null;
  return (
    <CardElement
      type={inlineEditing ? undefined : 'button'}
      data-canvas-node="1"
      data-drone-id={nodeId}
      data-canvas-node-kind={draftNode ? 'draft' : droneNode ? 'drone' : 'chat'}
      data-fleet-assignment-owner-id={!draftNode && nodeDroneId ? nodeDroneId : undefined}
      ref={(el) => {
        if (el) nodeElementByDroneIdRef.current[nodeId] = el;
        else delete nodeElementByDroneIdRef.current[nodeId];
      }}
      onMouseDown={(event) => actions.current.onNodeMouseDown(nodeId, event)}
      onClick={(event) => actions.current.onNodeClick(nodeId, event)}
      onDoubleClick={(event) => actions.current.onNodeDoubleClick(nodeId, event)}
      onMouseEnter={() => actions.current.hoverCard(nodeId)}
      onMouseLeave={() => actions.current.hoverCard(null)}
      aria-pressed={selected}
      aria-busy={deleting || undefined}
      title={deleting ? 'Deleting…' : undefined}
      className={`dh-canvas-work work-card group/canvas-node absolute flex items-center overflow-visible rounded-[9px] border bg-[var(--panel)] text-left transition-[border-color,color] duration-100 ${
        // A finished chat reads quieter, brightening under the pointer. By colour, not opacity: an opacity change
        // runs on the GPU and lifts the card onto a layer of its own, drawn once and then stretched by a zoom.
        detail.state === 'done' && !detail.unread && !selected
          ? 'text-[color-mix(in_srgb,var(--fg)_72%,var(--panel))] hover:text-[var(--fg)]'
          : 'text-[var(--fg)]'
      } ${
        // Selected: only the border changes, to the accent. The chat that is open has its accent edge instead.
        selected || dragging || inlineEditing || assignmentHoverTarget
          ? 'border-[var(--accent)]'
          : draftNode
            ? 'border-dashed border-[var(--user-border)] hover:border-[var(--muted)]'
            : detail.state === 'need'
              ? 'border-[color-mix(in_srgb,var(--orange)_55%,var(--border))]'
              : 'border-[var(--border)] hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))]'
      }`}
      style={{
        left: 0,
        top: 0,
        padding: '0.4375rem 0.625rem',
        width: nodeWidth,
        height: nodeHeight,
      }}
    >
      {/* The chat that is open: the card's left edge in the accent, following its rounded corners. */}
      {isActiveSidebarChat ? (
        <span data-canvas-card-open="" className="pointer-events-none absolute -inset-px z-[2] rounded-[9px] shadow-[inset_2px_0_0_var(--accent)]" />
      ) : null}
      {/* The card says its state inside it; a deletion, which it does not know of, is said above it. */}
      {deletingBadge ? (
        <span className="pointer-events-none absolute right-0 bottom-full mb-1 z-[2]">{deletingBadge}</span>
      ) : null}
      {/* A new reply: a dot on the card's corner. */}
      {unread ? (
        <span className="pointer-events-none absolute -right-[3px] -top-[3px] z-[3] flex" data-canvas-card-unread>
          <span className="h-2 w-2 rounded-full bg-[var(--green)] shadow-[0_0_5px_var(--green-border)]" title="Unread agent message" aria-label="Unread agent message" />
        </span>
      ) : null}
      {showCanvasLastMessagePreviews && lastAgentSnippet ? (
        <span
          className="pointer-events-none absolute left-0 bottom-full mb-[18px] z-[1] inline-flex max-w-[280px] rounded-[4px] border border-[var(--border-subtle)] bg-[var(--panel-overlay)] px-2 py-1 text-10 leading-[1.35] text-[var(--muted)]"
          title={lastAgentSnippet}
        >
          <span className="line-clamp-2 break-words whitespace-pre-wrap">{lastAgentSnippet}</span>
        </span>
      ) : null}
      {draftNode ? (
        <span className="pointer-events-none absolute -top-2 left-2 z-[2] inline-flex items-center rounded-[4px] border border-[var(--user-border)] bg-[var(--panel-overlay)] px-1.5 py-[1px] text-8 font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--muted)]">
          Draft
        </span>
      ) : null}
      {repoLabel || repoBranch ? (
        // One row centred under the card: at least as wide as the card, and wider when the two
        // chips need it, so the repository and the branch spread apart instead of overlapping.
        <span
          className={`pointer-events-none absolute left-1/2 top-full mt-[3px] flex min-w-[calc(100%-1rem)] -translate-x-1/2 justify-between gap-1.5 whitespace-nowrap ${
            // Detailed drone cards always say where they work; compact ones on hover, to keep the board clear.
            (droneNode && detail) || draftNode || selected ? '' : 'invisible group-hover/canvas-node:visible'
          }`}
          data-canvas-card-repo
        >
          {repoLabel ? (
            <span className={`${CANVAS_NODE_META_CHIP_CLASS} max-w-[260px]`} title={repoLabel}>
              <span className="truncate">{repoLabel}</span>
            </span>
          ) : <span />}
          {repoBranch ? (
            <span className={`${CANVAS_NODE_META_CHIP_CLASS} max-w-[180px]`} title={repoBranch}>
              <span className="truncate">{repoBranch}</span>
            </span>
          ) : null}
        </span>
      ) : null}
      {/* The title fades while the chat is being deleted; the Deleting badge above says why. */}
      <span className={`min-w-0 flex-1 ${deleting ? 'opacity-45' : ''} ${inlineEditing && droneNode ? 'flex items-center gap-1.5' : ''}`}>
        {inlineEditing && droneNode ? runtimeIcon : null}
        {inlineEditing ? (
          <input
            ref={inlineRenameInputRef}
            value={inlineRenameDraft}
            disabled={inlineRenameBusy}
            onChange={(event) => actions.current.setInlineRenameDraft(event.target.value)}
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
            onDragStart={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
            }}
            // Clicking away keeps what was typed, as in a file explorer; only Escape discards it.
            onBlur={() => {
              if (inlineRenameBusy || inlineRenameSettledRef.current) return;
              inlineRenameSettledRef.current = true;
              void actions.current.submitInlineRename();
            }}
            onKeyDown={(event) => {
              if ((event.nativeEvent as any)?.isComposing) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                inlineRenameSettledRef.current = true;
                void actions.current.submitInlineRename();
                // Canvas keys (Q, Delete, arrows) keep working once the field closes.
                actions.current.focusViewportElement();
                return;
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                inlineRenameSettledRef.current = true;
                actions.current.cancelInlineRename();
                actions.current.focusViewportElement();
              }
            }}
            // Looks like the title it replaces: the card's own border already says it is being edited.
            className={`block w-full min-w-0 border-0 bg-transparent p-0 text-12-5 font-[var(--weight-semibold)] leading-[inherit] text-[var(--fg-secondary)] caret-[var(--accent)] outline-none focus:outline-none focus-visible:outline-none ${droneNode ? '' : 'text-center'}`}
          />
        ) : assignmentHoverTarget ? (
          <span className="block">
            <span className="block truncate text-12-5 font-[var(--weight-semibold)] text-[var(--fg-secondary)]">
              Release to choose action
            </span>
            <span className="block truncate text-10 text-[var(--muted-dim)]">
              {assignmentHoverTargetCount} drone{assignmentHoverTargetCount === 1 ? '' : 's'} dropped into this chat
            </span>
          </span>
        ) : (
          <span className="grid min-w-0" data-canvas-detailed-card={detail.state}>
            <span className="flex min-w-0 items-center gap-1.5">
              {runtimeIcon}
              <span className="min-w-0 truncate text-[13px] font-semibold" title={`${primaryLabel}\n${detail.text}`}>{primaryLabel}</span>
              {detail.workingSince !== null ? (
                <span className="ml-auto flex-shrink-0 font-mono text-[11px] tabular-nums text-[var(--muted)]" title="How long it has been working"
                  data-canvas-card-clock>
                  {detail.clock}
                </span>
              ) : null}
              {detail.showState ? (
                // The sidebar's icon for the same state; a new reply is the dot on the card's corner.
                <span className={`${detail.workingSince !== null ? '' : 'ml-auto'} inline-flex flex-shrink-0`} title={detail.unread ? `${detail.label} · new reply` : detail.label}
                  data-canvas-card-state={detail.icon}>
                  <SidebarItemStateIndicator state={detail.icon} unread={false} showReadyAnchor={detail.state === 'idle'} />
                </span>
              ) : null}
            </span>
          </span>
        )}
      </span>
    </CardElement>
  );
});

const CANVAS_NODE_META_CHIP_CLASS =
  'inline-flex min-w-0 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--panel-overlay)] px-1.5 py-[1px] text-9 font-mono text-[var(--muted-dim)]';

import React from 'react';
import { canvasPerf } from './canvas-perf';
import { UiSpinner } from '../../ui/components';
import type { DroneSummary } from '../types';
import { DroneRuntimeIcon } from '../app/DroneRuntimeIndicator';
import type { DetailedCard } from './detailed-card-model';
import { SidebarItemStateIndicator } from '../overview/DroneCard';
import { TypingDots } from '../overview/icons';

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
  /** Set when detailed cards are on: state, what is going on, time and cost. */
  detail: DetailedCard | null;
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
  labelTextBoostLimit: number;
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
  labelTextBoostLimit,
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
  const indicator = deleting ? (
    <span
      className="inline-flex items-center gap-1 rounded-[4px] border border-[var(--red-border)] bg-[var(--panel-overlay)] px-1.5 py-[1px] text-8 font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--red)] shadow-[0_4px_10px_var(--shadow-color)]"
      style={{ fontFamily: 'var(--display)' }}
    >
      <UiSpinner size="small" label={null} inheritColor className="[&>span]:h-2.5 [&>span]:w-2.5" />
      Deleting
    </span>
  ) : (
    renderNodeIndicator(indicatorState)
  );
  // As in the sidebar, a new reply is flagged once the chat is idle, not while it works on.
  const unread = detail ? detail.unread && detail.icon === 'idle' : hasUnreadAgentMessage(indicatorState);
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
      onMouseEnter={detail ? () => actions.current.hoverCard(nodeId) : undefined}
      onMouseLeave={detail ? () => actions.current.hoverCard(null) : undefined}
      aria-pressed={selected}
      aria-busy={deleting || undefined}
      title={deleting ? 'Deleting…' : undefined}
      className={detail ? `dh-canvas-work work-card group/canvas-node absolute flex items-center overflow-visible rounded-[9px] border bg-[var(--panel)] text-left text-[var(--fg)] transition-[border-color,opacity] duration-100 ${
        // One thin border says it all: full accent when selected, a softer one for the chat that is open.
        selected || dragging || inlineEditing || assignmentHoverTarget
          ? 'border-[var(--accent)]'
          : isActiveSidebarChat
            ? 'border-[color-mix(in_srgb,var(--accent)_60%,var(--border))]'
            : detail.state === 'need'
            ? 'border-[color-mix(in_srgb,var(--orange)_55%,var(--border))]'
            : 'border-[var(--border)] hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))]'
      } ${detail.state === 'done' && !detail.unread && !selected ? 'opacity-80 hover:opacity-100' : ''}` : `group/canvas-node absolute overflow-visible rounded-[var(--radius-medium)] border text-left shadow-[0_10px_20px_var(--shadow-color)] transition-[border-color,background-color] duration-100 flex items-center ${
        dragging
          ? 'border-[var(--accent)] bg-[var(--panel-raised)] shadow-[inset_0_0_0_1px_var(--accent-muted),0_14px_26px_var(--shadow-color)]'
          : assignmentHoverTarget
            ? 'border-[var(--accent)] bg-[var(--panel-raised)] shadow-[0_0_0_1px_var(--canvas-related-subtle),0_16px_28px_var(--shadow-color)]'
            : selected || inlineEditing
              ? 'border-[var(--accent-muted)] bg-[var(--panel-raised)] shadow-[inset_0_0_0_1px_var(--accent-subtle),0_10px_20px_var(--shadow-color)]'
              : draftNode
                ? 'border-[var(--user-border)] bg-[var(--panel-overlay-soft)] hover:border-[var(--muted)]'
                : droneNode
                  ? runtime === 'host'
                    ? 'border-[var(--canvas-chat-owner-muted)] bg-[linear-gradient(135deg,var(--canvas-chat-owner-subtle),var(--panel-overlay)_58%)] shadow-[inset_0_0_0_1px_var(--canvas-chat-owner-subtle),0_12px_24px_var(--shadow-color)] hover:border-[var(--canvas-chat-owner)]'
                    : 'border-[var(--canvas-chat-owner-muted)] bg-[var(--panel-overlay)] shadow-[inset_0_0_0_1px_var(--canvas-chat-owner-subtle),0_12px_24px_var(--shadow-color)] hover:border-[var(--canvas-chat-owner)]'
                  : 'border-[var(--border)] bg-[var(--panel-overlay)] hover:border-[var(--accent-muted)]'
      }`}
      style={{
        left: 0,
        top: 0,
        ...(detail
          ? {
              padding: '0.4375rem 0.625rem',
            }
          : { paddingInline: labelTextBoostLimit > 1 ? 'var(--canvas-node-padding, 0.625rem)' : '0.625rem' }),
        width: nodeWidth,
        height: nodeHeight,
      }}
    >
      {isActiveSidebarChat && !detail ? (
        <span className="pointer-events-none absolute left-0 top-0 bottom-0 w-[3px] rounded-l-md bg-[var(--accent)] z-[2]" />
      ) : null}
      {/* A detailed card says all of this inside it. */}
      {indicator && !detail ? (
        <span className="pointer-events-none absolute right-0 bottom-full mb-1 z-[2]">{indicator}</span>
      ) : null}
      {/* A new reply: a dot on the card's corner, in either card mode. */}
      {unread ? (
        <span className="pointer-events-none absolute -right-[3px] -top-[3px] z-[3] flex" data-canvas-card-unread>
          <span className="h-2 w-2 rounded-full bg-[var(--green)] shadow-[0_0_5px_var(--green-border)]" title="Unread agent message" aria-label="Unread agent message" />
        </span>
      ) : null}
      {showCanvasLastMessagePreviews && lastAgentSnippet && !detail ? (
        <span
          className="pointer-events-none absolute left-0 bottom-full mb-[18px] z-[1] inline-flex max-w-[280px] rounded-[4px] border border-[var(--border-subtle)] bg-[var(--panel-overlay)] px-2 py-1 text-10 leading-[1.35] text-[var(--muted)] shadow-[0_6px_14px_var(--shadow-color)]"
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
          className={`pointer-events-none absolute left-1/2 top-full mt-[3px] flex min-w-[calc(100%-1rem)] -translate-x-1/2 justify-between gap-1.5 whitespace-nowrap transition-opacity ${
            droneNode || draftNode || selected ? '' : 'opacity-0 group-hover/canvas-node:opacity-100'
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
      <span className={`min-w-0 flex-1 transition-opacity ${deleting ? 'opacity-45' : ''} ${inlineEditing && droneNode ? 'flex items-center gap-1.5' : ''}`}>
        {inlineEditing && droneNode ? runtimeIcon : null}
        {inlineEditing ? (
          <input
            ref={inlineRenameInputRef}
            data-canvas-rename-input=""
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
            style={
              labelTextBoostLimit > 1
                ? {
                    fontSize: `calc(var(--text-12-5) * min(var(--canvas-node-boost, 1), ${labelTextBoostLimit.toFixed(3)}))`,
                  }
                : undefined
            }
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
        ) : detail ? (
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
        ) : (
          <span className={`flex min-w-0 items-center ${droneNode ? 'gap-1.5' : ''}`}>
            {runtimeIcon}
            <span
              className={`min-w-0 flex-1 truncate text-12-5 font-[var(--weight-semibold)] text-[var(--fg-secondary)] ${droneNode ? '' : 'text-center'}`}
              // Grows with the zoom boost up to its limit by transform, set by CanvasWorldLayer's style rule:
              // a font size would lay out every label again on each zoom frame.
              data-canvas-label-boost={labelTextBoostLimit > 1 ? '' : undefined}
              style={
                labelTextBoostLimit > 1
                  ? ({ '--canvas-label-boost-limit': labelTextBoostLimit.toFixed(3) } as React.CSSProperties)
                  : undefined
              }
            >
              {primaryLabel}
            </span>
          </span>
        )}
      </span>
    </CardElement>
  );
});

const CANVAS_NODE_META_CHIP_CLASS =
  'inline-flex min-w-0 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--panel-overlay)] px-1.5 py-[1px] text-9 font-mono text-[var(--muted-dim)] shadow-[0_6px_14px_var(--shadow-color)]';

function renderNodeIndicator(state: DroneCanvasIndicatorState | null): React.ReactNode {
  if (!state) return null;

  const isStarting = state.hubPhase === 'creating' || state.hubPhase === 'starting' || state.hubPhase === 'seeding';
  if (isStarting || (state.busy && state.statusOk && state.hubPhase !== 'error')) {
    if (isStarting) {
      const label = state.hubPhase === 'seeding' ? 'Seeding' : 'Starting';
      return (
        <span
          className="inline-flex items-center rounded-[4px] border border-[var(--yellow-border)] bg-[var(--panel-overlay)] px-1.5 py-[1px] text-8 font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--yellow)] shadow-[0_4px_10px_var(--shadow-color)]"
          style={{ fontFamily: 'var(--display)' }}
          title={String(state.hubMessage ?? label)}
        >
          {label}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center" title="Active">
        <TypingDots color="var(--yellow)" />
      </span>
    );
  }

  if (state.statusChecking) {
    return (
      <span
        className="inline-flex items-center rounded-[4px] border border-[var(--yellow-border)] bg-[var(--warning-panel)] px-1.5 py-[1px] text-8 font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--yellow)] shadow-[0_4px_10px_var(--shadow-color)]"
        style={{ fontFamily: 'var(--display)' }}
        title={String(state.statusError ?? 'Checking status')}
      >
        Chk
      </span>
    );
  }

  if (state.hubPhase === 'error' || !state.statusOk) {
    const label = state.hubPhase === 'error' ? 'Error' : 'Offline';
    return (
      <span
        className="inline-flex items-center rounded-[4px] border border-[var(--red-border)] bg-[var(--danger-panel)] px-1.5 py-[1px] text-8 font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--red)] shadow-[0_4px_10px_var(--shadow-color)]"
        style={{ fontFamily: 'var(--display)' }}
        title={String(state.hubMessage ?? state.statusError ?? label)}
      >
        {state.hubPhase === 'error' ? 'Err' : 'Off'}
      </span>
    );
  }

  return null;
}

function hasUnreadAgentMessage(state: DroneCanvasIndicatorState | null): boolean {
  if (!state || !state.unreadAgentMessage) return false;
  const isStarting = state.hubPhase === 'creating' || state.hubPhase === 'starting' || state.hubPhase === 'seeding';
  return !isStarting && !(state.busy && state.statusOk && state.hubPhase !== 'error');
}

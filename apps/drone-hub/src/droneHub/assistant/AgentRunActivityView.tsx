import React from 'react';
import {
  messageVisibleText,
  renderItemsFromMessages,
  settleAgentRunActivity,
  type AgentRunActivity,
} from '@drone/assistant-chat';

import type { AgentMessageExtrasProps } from '../chat/AgentMessageExtras';
import { AgentRunSummaryLine } from '../chat/WorkingElapsedStatus';
import {
  AssistantMessageRow,
  RepeatedToolActivityRow,
  ToolActivityRow,
} from './AssistantTranscript';

function activityTimestampMs(value: string | number | null | undefined): number | null {
  const parsed = typeof value === 'number' ? value : Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function ActivityChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 3 4 4-4 4" />
    </svg>
  );
}

export function AgentRunActivityView({
  activity,
  active = false,
  startedAt,
  endedAt,
  at,
  autoExpandFinalMessage = false,
  messageExtras,
}: {
  activity?: AgentRunActivity;
  active?: boolean;
  startedAt?: string | number | null;
  endedAt?: string | number | null;
  at?: string;
  autoExpandFinalMessage?: boolean;
  messageExtras?: Omit<AgentMessageExtrasProps, 'text' | 'tasks'>;
}) {
  const displayActivity = React.useMemo(
    () => (active ? activity : settleAgentRunActivity(activity)),
    [active, activity],
  );
  const items = React.useMemo(
    () => (displayActivity ? renderItemsFromMessages(displayActivity.messages) : []),
    [displayActivity],
  );

  let finalAssistantIndex = -1;
  if (!active) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (
        item?.type === 'message' &&
        item.message.role === 'assistant' &&
        messageVisibleText(item.message).trim()
      ) {
        finalAssistantIndex = index;
        break;
      }
    }
  }

  const finalAssistantCandidate =
    finalAssistantIndex >= 0 ? items[finalAssistantIndex] : undefined;
  const finalAssistantItem =
    finalAssistantCandidate?.type === 'message' ? finalAssistantCandidate : null;
  const activityItems = items.filter(
    (item, index) => index !== finalAssistantIndex && item.type !== 'runSummary',
  );
  const toolCallCount = items.reduce((count, item) => {
    if (item.type === 'tool') return count + 1;
    if (item.type === 'toolGroup') return count + item.items.length;
    return count;
  }, 0);
  const hasActivityDetails = Boolean(displayActivity?.truncated || activityItems.length > 0);
  const fallbackStart = React.useRef(Date.now()).current;
  const parsedStart = activityTimestampMs(startedAt) ?? fallbackStart;
  const parsedEnd = activityTimestampMs(endedAt);
  const [now, setNow] = React.useState(() => Date.now());
  const [expanded, setExpanded] = React.useState(active);

  React.useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

  React.useEffect(() => {
    setExpanded(active);
  }, [active]);

  const durationMs = Math.max(0, (active ? now : (parsedEnd ?? parsedStart)) - parsedStart);
  const detail =
    toolCallCount > 0
      ? `${toolCallCount} tool ${toolCallCount === 1 ? 'call' : 'calls'}`
      : undefined;

  return (
    <div data-agent-run-activity={displayActivity?.source}>
      <div className="px-3">
        <AgentRunSummaryLine
          active={active}
          durationMs={durationMs}
          at={at}
          detail={detail}
          trailing={hasActivityDetails ? <ActivityChevron open={expanded} /> : undefined}
          expanded={expanded}
          onToggle={hasActivityDetails ? () => setExpanded((value) => !value) : undefined}
          toggleLabel="activity"
        />
      </div>
      {hasActivityDetails && expanded ? (
        <div className="ml-3 border-l border-[var(--border-subtle)] px-3 py-1 opacity-[0.82] transition-opacity hover:opacity-100 focus-within:opacity-100">
          <div className="space-y-1">
            {displayActivity?.truncated ? (
              <div className="py-1 text-[var(--text-10)] text-[var(--muted-dim)]">
                Earlier or oversized activity details were trimmed.
              </div>
            ) : null}
            {activityItems.map((item) => {
              if (item.type === 'message') {
                return (
                  <AssistantMessageRow
                    key={item.key}
                    message={item.message}
                    showToolCalls={false}
                    showReasoning
                    autoExpandMessage
                  />
                );
              }
              if (item.type === 'tool') {
                return (
                  <div className="-mx-3" key={item.key}>
                    <ToolActivityRow call={item.call} result={item.result} />
                  </div>
                );
              }
              if (item.type === 'toolGroup') {
                return (
                  <div className="-mx-3" key={item.key}>
                    <RepeatedToolActivityRow items={item.items} />
                  </div>
                );
              }
              return null;
            })}
          </div>
        </div>
      ) : null}
      {finalAssistantItem ? (
        <div className="mt-1 px-3">
          <AssistantMessageRow
            message={finalAssistantItem.message}
            messageExtras={messageExtras}
            showToolCalls={false}
            showReasoning={false}
            autoExpandMessage={autoExpandFinalMessage}
          />
        </div>
      ) : null}
    </div>
  );
}

import React from 'react';
import {
  renderItemsFromMessages,
  settleAgentRunActivity,
  type AgentRunActivity,
} from '@drone/assistant-chat';

import type { AgentMessageExtrasProps } from '../chat/AgentMessageExtras';
import {
  AssistantMessageRow,
  RepeatedToolActivityRow,
  ToolActivityRow,
} from './AssistantTranscript';

export function AgentRunActivityView({
  activity,
  active = false,
  messageExtras,
}: {
  activity?: AgentRunActivity;
  active?: boolean;
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
  if (items.length === 0) return null;

  let latestAssistantIndex = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.type === 'message' && item.message.role === 'assistant') {
      latestAssistantIndex = index;
      break;
    }
  }

  return (
    <div className="space-y-1" data-agent-run-activity={displayActivity?.source}>
      {displayActivity?.truncated ? (
        <div className="mx-3 text-[var(--text-10)] text-[var(--muted-dim)]">
          Earlier or oversized activity details were trimmed.
        </div>
      ) : null}
      {items.map((item, index) => {
        if (item.type === 'message') {
          return (
            <AssistantMessageRow
              key={item.key}
              message={item.message}
              messageExtras={index === latestAssistantIndex ? messageExtras : undefined}
              showToolCalls={false}
              showReasoning
              autoExpandMessage={active && index === latestAssistantIndex}
            />
          );
        }
        if (item.type === 'tool') {
          return <ToolActivityRow key={item.key} call={item.call} result={item.result} />;
        }
        if (item.type === 'toolGroup') {
          return <RepeatedToolActivityRow key={item.key} items={item.items} />;
        }
        return null;
      })}
    </div>
  );
}

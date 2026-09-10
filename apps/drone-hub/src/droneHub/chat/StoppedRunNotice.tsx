import React from 'react';
import { stoppedRunDetail } from '@drone/assistant-chat';

import { AgentRunSummaryLine } from './WorkingElapsedStatus';

function StopIcon() {
  return (
    <svg
      className="h-2.5 w-2.5 text-[var(--muted-dim)]"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="currentColor" />
    </svg>
  );
}

export function StoppedRunNotice({ reason, at }: { reason?: string; at?: string }) {
  const detail = stoppedRunDetail(reason);
  return (
    <div role="status" aria-label={`Run stopped. ${detail}`} data-stopped-run-notice="true">
      <AgentRunSummaryLine
        active={false}
        durationMs={0}
        label="Run stopped"
        leading={<StopIcon />}
        detail={detail}
        at={at}
      />
    </div>
  );
}

export type CompanionAutonomy = 'off' | 'observe' | 'act';

/** What the loop can perceive beyond speech. Hosts fill what they have; everything is optional but the backend status. */
export type CompanionObservation = {
  backend: {
    status: 'idle' | 'working';
    startedAt?: number | null;
    lastActivityAt?: number | null;
    /** Short summaries of the most recent tool calls, oldest first. */
    activity?: string[];
    lastReply?: string;
    lastReplyAt?: number | null;
    error?: string;
  };
  app?: { selectedDrone?: string; selectedChat?: string; repoPath?: string; pane?: string };
  /** Event notifications delivered to the Companion conversation since the last decision. */
  events?: string[];
};

export type CompanionSenseSources = {
  observe(): CompanionObservation;
  /** Show a short note to the user without speaking. */
  notify?(text: string): void;
};

export type CompanionFacts = {
  speechPending: boolean;
  /** No new transcript text for a short beat; enough to finish a greeting. */
  userPaused: boolean;
  /** No new transcript text for several seconds; the user has stopped talking. */
  userStopped: boolean;
  backendWorking: boolean;
  backendStalled: boolean;
  backendJustReplied: boolean;
  userSilent: boolean;
  hasEvents: boolean;
};

export const COMPANION_FACT_DESCRIPTIONS: Record<keyof CompanionFacts, string> = {
  speechPending: 'There is unsent speech in unsentTranscript.',
  userPaused: 'No transcript text has arrived for 0.8 seconds.',
  userStopped: 'No transcript text has arrived for 3 seconds.',
  backendWorking: 'A delegated request is still running.',
  backendStalled: 'The backend has been working with no tool activity or reply for 45 seconds.',
  backendJustReplied: 'The backend finished a request within the last 8 seconds.',
  userSilent: 'No transcript text has arrived for 10 seconds.',
  hasEvents: 'Event notifications arrived in the Companion conversation since the last decision.',
};

export const COMPANION_SENSE_THRESHOLDS = { stalledMs: 45_000, justRepliedMs: 8_000, silentMs: 10_000, pausedMs: 800, stoppedMs: 3_000 };

/** Speech-timing facts are available in every autonomy level, including off. */
export const COMPANION_SPEECH_FACTS = ['speechPending', 'userPaused', 'userStopped'] as const;

export function computeCompanionSpeechFacts(pending: string, silenceMs: number, lastSpeechAt: number | undefined, thresholds = COMPANION_SENSE_THRESHOLDS): Pick<CompanionFacts, 'speechPending' | 'userPaused' | 'userStopped'> {
  return {
    speechPending: pending.trim().length > 0,
    userPaused: lastSpeechAt !== undefined && silenceMs >= thresholds.pausedMs,
    userStopped: lastSpeechAt !== undefined && silenceMs >= thresholds.stoppedMs,
  };
}

export function computeCompanionFacts(observation: CompanionObservation, pending: string, silenceMs: number, now: number, lastSpeechAt: number | undefined, thresholds = COMPANION_SENSE_THRESHOLDS): CompanionFacts {
  const backend = observation.backend;
  const working = backend.status === 'working';
  const lastMovement = Math.max(backend.lastActivityAt ?? 0, backend.startedAt ?? 0);
  return {
    ...computeCompanionSpeechFacts(pending, silenceMs, lastSpeechAt, thresholds),
    backendWorking: working,
    backendStalled: working && lastMovement > 0 && now - lastMovement >= thresholds.stalledMs,
    backendJustReplied: !working && typeof backend.lastReplyAt === 'number' && now - backend.lastReplyAt <= thresholds.justRepliedMs,
    userSilent: lastSpeechAt !== undefined && silenceMs >= thresholds.silentMs,
    hasEvents: (observation.events?.length ?? 0) > 0,
  };
}

/** The part of an observation that Jev should read: trimmed, literal, no timestamps to compare. */
export function serializeCompanionObservation(observation: CompanionObservation, facts: CompanionFacts, now: number) {
  const backend = observation.backend;
  return {
    backend: {
      status: backend.status,
      ...(backend.status === 'working' && backend.startedAt ? { workingForSeconds: Math.round((now - backend.startedAt) / 1000) } : {}),
      ...(backend.activity?.length ? { recentActivity: backend.activity.slice(-5) } : {}),
      ...(backend.lastReply ? { lastReply: backend.lastReply.slice(0, 1_000) } : {}),
      ...(backend.error ? { error: backend.error.slice(0, 500) } : {}),
    },
    ...(observation.app ? { app: observation.app } : {}),
    ...(observation.events?.length ? { events: observation.events.slice(-5).map(event => event.slice(0, 500)) } : {}),
    facts,
  };
}

/** Identity of what the senses currently show; a change wakes the loop without speech. */
export function observationKey(observation: CompanionObservation, facts: CompanionFacts): string {
  const backend = observation.backend;
  return JSON.stringify([backend.status, backend.activity?.length ?? 0, backend.lastReply?.slice(-80) ?? '', backend.error ?? '', observation.events?.length ?? 0, observation.app ?? null,
    facts.backendStalled, facts.backendJustReplied, facts.userSilent, facts.hasEvents]);
}

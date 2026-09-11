import React from 'react';
import type { ChatQuestionRequest, ChatQuestionResponse } from '@drone/assistant-chat';
import { requestJson } from '../http';

export type QuestionRequestResolution =
  | { kind: 'submit'; responses: ChatQuestionResponse[]; notes?: string }
  | { kind: 'skip'; notes?: string };

export type ExternalQuestionRequests = {
  requests: ChatQuestionRequest[];
  pending: ChatQuestionRequest[];
  busyId: string | null;
  error: string | null;
  resolve(request: ChatQuestionRequest, resolution: QuestionRequestResolution): Promise<void>;
};

const EMPTY: ChatQuestionRequest[] = [];

/** Questionnaires an external (non-native) agent has asked in this chat, polled while enabled. */
export function useExternalQuestionRequests(
  droneId: string,
  chatName: string,
  enabled: boolean,
): ExternalQuestionRequests {
  const [requests, setRequests] = React.useState<ChatQuestionRequest[]>(EMPTY);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    setBusyId(null);
    setError(null);
    if (!enabled) {
      setRequests(EMPTY);
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const response = await requestJson<{ requests?: ChatQuestionRequest[] }>(
          `/api/chat-question-requests?${new URLSearchParams({
            droneId,
            chatName,
            includeResolved: 'true',
          }).toString()}`,
        );
        if (active) setRequests(response.requests ?? EMPTY);
      } catch {
        // The transcript and queue polling remain authoritative for connectivity errors.
      }
    };
    void load();
    const timer = window.setInterval(load, 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [chatName, droneId, enabled]);

  const resolve = React.useCallback(
    async (request: ChatQuestionRequest, resolution: QuestionRequestResolution) => {
      setBusyId(request.id);
      setError(null);
      try {
        const response = await requestJson<{ result: ChatQuestionRequest['result'] }>(
          `/api/chat-question-requests/${encodeURIComponent(request.id)}/${
            resolution.kind === 'submit' ? 'submit' : 'skip'
          }`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(
              resolution.kind === 'submit'
                ? { responses: resolution.responses, notes: resolution.notes }
                : { reason: 'user_skipped', notes: resolution.notes },
            ),
          },
        );
        if (response.result) {
          setRequests((current) =>
            current.map((candidate) =>
              candidate.id === request.id
                ? {
                    ...candidate,
                    status: response.result!.status,
                    result: response.result,
                    updatedAt: new Date().toISOString(),
                  }
                : candidate,
            ),
          );
        }
      } catch (err) {
        setError(
          String((err as any)?.message ?? err ?? '').trim() ||
            'Unable to resolve the question request.',
        );
      } finally {
        setBusyId((current) => (current === request.id ? null : current));
      }
    },
    [],
  );

  const pending = React.useMemo(
    () => requests.filter((request) => request.status === 'pending'),
    [requests],
  );
  return { requests, pending, busyId, error, resolve };
}

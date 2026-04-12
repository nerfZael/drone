import React from 'react';
import { stripAnsi } from '../../domain';
import { extractAgentCopilotFromAgentMessage, type AgentCopilotRequest } from '../chat/agent-copilot-parser';
import type { TranscriptItem } from '../types';
import { createDroneChatEntry, fetchDroneChatTranscript, sendDroneChatPrompt } from './chat-api';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

const AGENT_COPILOT_HANDLED_STORAGE_KEY = 'droneHub.agentCopilotHandledSourceMessages';
const AGENT_COPILOT_HANDLED_CAP = 500;
const AGENT_COPILOT_POLL_INTERVAL_MS = 1500;
const AGENT_COPILOT_POLL_TIMEOUT_MS = 5 * 60 * 1000;

const inFlightSourceMessageIds = new Set<string>();

let handledSourceMessageIdsLoaded = false;
const handledSourceMessageIds = new Set<string>();

function loadHandledSourceMessageIds(): void {
  if (handledSourceMessageIdsLoaded || typeof window === 'undefined') return;
  handledSourceMessageIdsLoaded = true;
  try {
    const raw = window.localStorage.getItem(AGENT_COPILOT_HANDLED_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      const id = String(entry ?? '').trim();
      if (!id) continue;
      handledSourceMessageIds.add(id);
    }
  } catch {
    // Ignore corrupted local storage and continue with an empty cache.
  }
}

function rememberHandledSourceMessageId(sourceMessageIdRaw: string): void {
  loadHandledSourceMessageIds();
  const sourceMessageId = String(sourceMessageIdRaw ?? '').trim();
  if (!sourceMessageId || handledSourceMessageIds.has(sourceMessageId)) return;
  handledSourceMessageIds.add(sourceMessageId);
  const snapshot = Array.from(handledSourceMessageIds);
  if (snapshot.length > AGENT_COPILOT_HANDLED_CAP) {
    const overflow = snapshot.length - AGENT_COPILOT_HANDLED_CAP;
    for (const entry of snapshot.slice(0, overflow)) handledSourceMessageIds.delete(entry);
  }
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      AGENT_COPILOT_HANDLED_STORAGE_KEY,
      JSON.stringify(Array.from(handledSourceMessageIds)),
    );
  } catch {
    // Best effort only.
  }
}

function hasHandledSourceMessage(sourceMessageIdRaw: string): boolean {
  loadHandledSourceMessageIds();
  const sourceMessageId = String(sourceMessageIdRaw ?? '').trim();
  return Boolean(sourceMessageId) && handledSourceMessageIds.has(sourceMessageId);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function buildSourceMessageId(droneIdRaw: string, chatNameRaw: string, item: TranscriptItem): string {
  const droneId = String(droneIdRaw ?? '').trim();
  const chatName = String(chatNameRaw ?? '').trim() || 'default';
  const turnId = String(item?.id ?? '').trim();
  if (turnId) return `${droneId}:${turnId}`;
  return `${droneId}:${chatName}:${item.turn}:${String(item.at ?? '').trim()}`;
}

function buildCopilotResponsePrompt(nameRaw: string, responseRaw: string): string {
  const name = String(nameRaw ?? '').trim();
  const response = String(responseRaw ?? '').trim();
  return `This is what copilot '${name}' responded with:\n${response}`;
}

function buildCopilotErrorPrompt(errorRaw: string, nameRaw?: string): string {
  const error = String(errorRaw ?? '').trim() || 'Unknown error.';
  const name = String(nameRaw ?? '').trim();
  if (!name) return `Agent copilot error: ${error}`;
  return `Copilot '${name}' failed: ${error}`;
}

async function ensureCopilotChat(opts: {
  requestJson: RequestJson;
  droneId: string;
  sourceChatName: string;
  copilotName: string;
}): Promise<void> {
  try {
    await createDroneChatEntry(opts.requestJson, {
      droneId: opts.droneId,
      chatName: opts.copilotName,
      copyFromChat: opts.sourceChatName,
    });
  } catch (error: any) {
    const status = Number(error?.status ?? 0);
    const message = String(error?.message ?? error ?? '').trim().toLowerCase();
    if (status === 409 || /already exists/.test(message)) return;
    throw error;
  }
}

async function sendPromptToChat(opts: {
  requestJson: RequestJson;
  droneId: string;
  chatName: string;
  prompt: string;
}): Promise<string> {
  const data = await sendDroneChatPrompt(opts.requestJson, {
    droneId: opts.droneId,
    chatName: opts.chatName,
    prompt: opts.prompt,
  });
  return String((data as any)?.promptId ?? '').trim();
}

async function waitForCopilotTranscriptTurn(opts: {
  requestJson: RequestJson;
  droneId: string;
  chatName: string;
  promptId: string;
}): Promise<TranscriptItem> {
  const startedAtMs = Date.now();
  while (Date.now() - startedAtMs < AGENT_COPILOT_POLL_TIMEOUT_MS) {
    let transcripts: TranscriptItem[];
    try {
      transcripts = await fetchDroneChatTranscript(opts.requestJson, {
        droneId: opts.droneId,
        chatName: opts.chatName,
        turn: 'all',
      });
    } catch (error: any) {
      const status = Number(error?.status ?? 0);
      const message = String(error?.message ?? error ?? '').trim().toLowerCase();
      if (status === 404 || /unknown chat/.test(message)) {
        await wait(AGENT_COPILOT_POLL_INTERVAL_MS);
        continue;
      }
      throw error;
    }
    const match =
      transcripts.find((item) => String(item?.id ?? '').trim() === opts.promptId) ??
      null;
    if (match && (String(match.completedAt ?? '').trim() || String(match.output ?? '').trim() || !match.ok)) {
      return match;
    }
    await wait(AGENT_COPILOT_POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for copilot '${opts.chatName}' to respond.`);
}

async function processAgentCopilotRequest(opts: {
  requestJson: RequestJson;
  sourceDroneId: string;
  sourceChatName: string;
  sourceMessageId: string;
  copilot: AgentCopilotRequest | null;
  parseError: string | null;
}): Promise<void> {
  if (opts.parseError) {
    await sendPromptToChat({
      requestJson: opts.requestJson,
      droneId: opts.sourceDroneId,
      chatName: opts.sourceChatName,
      prompt: buildCopilotErrorPrompt(opts.parseError),
    });
    rememberHandledSourceMessageId(opts.sourceMessageId);
    return;
  }

  if (!opts.copilot) return;

  await ensureCopilotChat({
    requestJson: opts.requestJson,
    droneId: opts.sourceDroneId,
    sourceChatName: opts.sourceChatName,
    copilotName: opts.copilot.name,
  });
  const promptId = await sendPromptToChat({
    requestJson: opts.requestJson,
    droneId: opts.sourceDroneId,
    chatName: opts.copilot.name,
    prompt: opts.copilot.message,
  });
  if (!promptId) {
    throw new Error(`Failed to send message to copilot '${opts.copilot.name}'.`);
  }

  const responseTurn = await waitForCopilotTranscriptTurn({
    requestJson: opts.requestJson,
    droneId: opts.sourceDroneId,
    chatName: opts.copilot.name,
    promptId,
  });

  const followupPrompt = responseTurn.ok
    ? buildCopilotResponsePrompt(opts.copilot.name, stripAnsi(responseTurn.output))
    : buildCopilotErrorPrompt(String(responseTurn.error ?? 'Copilot failed.'), opts.copilot.name);

  await sendPromptToChat({
    requestJson: opts.requestJson,
    droneId: opts.sourceDroneId,
    chatName: opts.sourceChatName,
    prompt: followupPrompt,
  });
  rememberHandledSourceMessageId(opts.sourceMessageId);
}

export function useAgentCopilotOrchestration(opts: {
  requestJson: RequestJson;
  sourceDroneId: string;
  sourceChatName: string;
  transcripts: TranscriptItem[] | null;
}): void {
  React.useEffect(() => {
    const sourceDroneId = String(opts.sourceDroneId ?? '').trim();
    const sourceChatName = String(opts.sourceChatName ?? '').trim() || 'default';
    const transcripts = Array.isArray(opts.transcripts) ? opts.transcripts : [];
    if (!sourceDroneId || transcripts.length === 0) return;

    for (const item of transcripts) {
      if (!item?.ok) continue;
      const cleanedOutput = stripAnsi(item.output);
      const extracted = extractAgentCopilotFromAgentMessage(cleanedOutput);
      if (!extracted.copilot && !extracted.error) continue;

      const sourceMessageId = buildSourceMessageId(sourceDroneId, sourceChatName, item);
      if (!sourceMessageId || hasHandledSourceMessage(sourceMessageId) || inFlightSourceMessageIds.has(sourceMessageId)) {
        continue;
      }

      inFlightSourceMessageIds.add(sourceMessageId);
      void processAgentCopilotRequest({
        requestJson: opts.requestJson,
        sourceDroneId,
        sourceChatName,
        sourceMessageId,
        copilot: extracted.copilot,
        parseError: extracted.error,
      })
        .catch(async (error: any) => {
          try {
            await sendPromptToChat({
              requestJson: opts.requestJson,
              droneId: sourceDroneId,
              chatName: sourceChatName,
              prompt: buildCopilotErrorPrompt(
                String(error?.message ?? error ?? 'Unknown error.'),
                extracted.copilot?.name,
              ),
            });
            rememberHandledSourceMessageId(sourceMessageId);
          } catch {
            // Leave the source message unhandled so the app can retry on the next poll.
          }
        })
        .finally(() => {
          inFlightSourceMessageIds.delete(sourceMessageId);
        });
    }
  }, [opts.requestJson, opts.sourceChatName, opts.sourceDroneId, opts.transcripts]);
}

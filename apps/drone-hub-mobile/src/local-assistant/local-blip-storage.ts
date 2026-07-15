import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import type { TranscriptEntry } from '@blip/core';
import type { LocalAssistantThread, LocalBlipSessionSnapshot } from './local-assistant-types';
import {
  cleanLocalBlipSessionSnapshot,
  createMobileBlipSessionState,
} from './mobile-session-snapshot';

const LEGACY_SNAPSHOT_KEY_PREFIX = 'droneHub.localAssistant.blip.v1.';
const SESSION_DIRECTORY_NAME = 'drone-hub-blip-sessions-v1';
const STATE_FILE_NAME = 'state.json';
const CHUNK_NAME = /^entries-(\d{12})-(\d{12})\.json$/;

type StoredState = {
  version: 1;
  state: LocalBlipSessionSnapshot['state'];
  transcriptEntryCount: number;
};

class CorruptMobileSessionError extends Error {}

function legacySnapshotKey(threadId: string): string {
  return `${LEGACY_SNAPSHOT_KEY_PREFIX}${encodeURIComponent(threadId)}`;
}

function rootDirectory(): Directory {
  return new Directory(Paths.document, SESSION_DIRECTORY_NAME);
}

function sessionDirectory(threadId: string): Directory {
  return new Directory(rootDirectory(), encodeURIComponent(threadId));
}

function ensureDirectory(directory: Directory): void {
  directory.create({ idempotent: true, intermediates: true });
}

function paddedIndex(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0 || index >= 1_000_000_000_000) {
    throw new Error(`Invalid mobile transcript index: ${index}`);
  }
  return String(index).padStart(12, '0');
}

function chunkName(startIndex: number, endIndex: number): string {
  return `entries-${paddedIndex(startIndex)}-${paddedIndex(endIndex)}.json`;
}

function atomicWrite(directory: Directory, name: string, contents: string): void {
  const target = new File(directory, name);
  const temporary = new File(
    directory,
    `${name}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
  );
  temporary.create({ overwrite: true });
  try {
    temporary.write(contents);
    temporary.moveSync(target, { overwrite: true });
  } finally {
    if (temporary.exists) temporary.delete();
  }
}

function chunkFiles(directory: Directory): Array<{ file: File; start: number; end: number }> {
  if (!directory.exists) return [];
  return directory
    .list()
    .flatMap((entry) => {
      if (!(entry instanceof File)) return [];
      const match = CHUNK_NAME.exec(entry.name);
      if (!match) return [];
      return [{ file: entry, start: Number(match[1]), end: Number(match[2]) }];
    })
    .sort((left, right) => left.start - right.start);
}

async function readTranscript(directory: Directory): Promise<TranscriptEntry[]> {
  const transcript: TranscriptEntry[] = [];
  for (const chunk of chunkFiles(directory)) {
    if (chunk.start !== transcript.length || chunk.end <= chunk.start) {
      throw new CorruptMobileSessionError(
        'Mobile transcript chunks are missing, overlapping, or out of order',
      );
    }
    const raw = await chunk.file.text();
    let entries: unknown;
    try {
      entries = JSON.parse(raw);
    } catch {
      throw new CorruptMobileSessionError('Mobile transcript chunk is not valid JSON');
    }
    if (!Array.isArray(entries) || entries.length !== chunk.end - chunk.start) {
      throw new CorruptMobileSessionError(
        'Mobile transcript chunk length does not match its filename',
      );
    }
    transcript.push(...(entries as TranscriptEntry[]));
  }
  return transcript;
}

function restoreCompactionMetadata(snapshot: LocalBlipSessionSnapshot): void {
  let compaction: Extract<TranscriptEntry, { type: 'compaction' }> | undefined;
  for (let index = snapshot.transcript.length - 1; index >= 0; index -= 1) {
    const entry = snapshot.transcript[index];
    if (entry.type === 'compaction') {
      compaction = entry;
      break;
    }
  }
  if (compaction) snapshot.state.compactedSummary = compaction.summary;
  else delete snapshot.state.compactedSummary;
}

async function migrateLegacySnapshot(
  thread: LocalAssistantThread,
): Promise<LocalBlipSessionSnapshot | null> {
  const key = legacySnapshotKey(thread.id);
  const stored = await AsyncStorage.getItem(key);
  if (!stored) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    await AsyncStorage.removeItem(key);
    return null;
  }
  const snapshot = cleanLocalBlipSessionSnapshot(thread.id, parsed);
  if (!snapshot) {
    await AsyncStorage.removeItem(key);
    return null;
  }
  // Do not remove the legacy value until its durable file replacement has succeeded.
  await saveLocalBlipSessionSnapshot(thread.id, snapshot, 0, snapshot.transcript);
  await AsyncStorage.removeItem(key);
  return snapshot;
}

export async function loadLocalBlipSessionSnapshot(
  thread: LocalAssistantThread,
): Promise<LocalBlipSessionSnapshot | null> {
  const directory = sessionDirectory(thread.id);
  if (!directory.exists) return await migrateLegacySnapshot(thread);
  try {
    const transcript = await readTranscript(directory);
    const stateFile = new File(directory, STATE_FILE_NAME);
    let storedState: StoredState | null = null;
    if (stateFile.exists) {
      const rawState = await stateFile.text();
      try {
        const candidate = JSON.parse(rawState) as StoredState;
        if (
          candidate?.version === 1 &&
          Number.isSafeInteger(candidate.transcriptEntryCount) &&
          candidate.transcriptEntryCount <= transcript.length
        ) {
          storedState = candidate;
        }
      } catch {
        // Transcript chunks remain canonical if the small replaceable state file was interrupted.
      }
    }
    if (!storedState && transcript.length === 0) {
      throw new CorruptMobileSessionError(
        'Mobile session directory has no recoverable state or transcript',
      );
    }
    let snapshot = cleanLocalBlipSessionSnapshot(thread.id, {
      version: 1,
      state: storedState?.state ?? createMobileBlipSessionState(thread),
      transcript,
    });
    if (!snapshot && storedState) {
      snapshot = cleanLocalBlipSessionSnapshot(thread.id, {
        version: 1,
        state: createMobileBlipSessionState(thread),
        transcript,
      });
    }
    if (!snapshot) throw new CorruptMobileSessionError('Invalid mobile Blip transcript');
    restoreCompactionMetadata(snapshot);
    return snapshot;
  } catch (error) {
    if (!(error instanceof CorruptMobileSessionError)) throw error;
    // Quarantine cannot help the runtime recover. Remove the damaged canonical snapshot and
    // safely rebuild it from the bounded visible thread on the next prompt.
    if (directory.exists) directory.delete();
    return await migrateLegacySnapshot(thread);
  }
}

export async function saveLocalBlipSessionSnapshot(
  threadId: string,
  snapshot: LocalBlipSessionSnapshot,
  startIndex: number,
  appendedEntries: TranscriptEntry[],
): Promise<void> {
  const clean = cleanLocalBlipSessionSnapshot(threadId, snapshot);
  if (!clean) throw new Error('Refusing to persist an invalid mobile Blip session snapshot');
  if (
    startIndex < 0 ||
    startIndex + appendedEntries.length !== clean.transcript.length ||
    appendedEntries.some((entry, index) => entry !== clean.transcript[startIndex + index])
  ) {
    throw new Error('Mobile transcript append does not match the session snapshot');
  }

  const directory = sessionDirectory(threadId);
  const existed = directory.exists;
  ensureDirectory(directory);
  const chunks = chunkFiles(directory);
  const storedEnd = chunks.at(-1)?.end ?? 0;
  let writeStart = startIndex;
  let entries = appendedEntries;
  if (!existed || (storedEnd === 0 && startIndex > 0)) {
    writeStart = 0;
    entries = clean.transcript;
  } else if (storedEnd !== startIndex) {
    const expectedRetry = chunks.some(
      (chunk) => chunk.start === startIndex && chunk.end === clean.transcript.length,
    );
    if (!expectedRetry) throw new Error('Mobile transcript append is not contiguous');
  }
  if (entries.length > 0) {
    atomicWrite(
      directory,
      chunkName(writeStart, writeStart + entries.length),
      JSON.stringify(entries),
    );
  }
  const state: StoredState = {
    version: 1,
    state: clean.state,
    transcriptEntryCount: clean.transcript.length,
  };
  atomicWrite(directory, STATE_FILE_NAME, JSON.stringify(state));
}

export async function deleteLocalBlipSessionSnapshot(threadId: string): Promise<void> {
  const directory = sessionDirectory(threadId);
  if (directory.exists) directory.delete();
  await AsyncStorage.removeItem(legacySnapshotKey(threadId));
}

export async function cloneLocalBlipSessionSnapshot(
  source: LocalAssistantThread,
  target: LocalAssistantThread,
): Promise<void> {
  const snapshot = await loadLocalBlipSessionSnapshot(source);
  if (!snapshot) return;
  const sessionId = `mobile_${target.id}`;
  const transcript = snapshot.transcript.map((entry) =>
    entry.type === 'runtime_event'
      ? { ...entry, event: { ...entry.event, sessionId } }
      : entry,
  );
  const cloned: LocalBlipSessionSnapshot = {
    version: 1,
    state: {
      ...snapshot.state,
      id: sessionId,
      parentSessionId: snapshot.state.id,
      transcriptPath: `mobile:${target.id}`,
      createdAt: target.createdAt,
      updatedAt: target.updatedAt,
      loadedSkills: [...snapshot.state.loadedSkills],
      changedFiles: [...snapshot.state.changedFiles],
      readFiles: [...snapshot.state.readFiles],
    },
    transcript,
  };
  await saveLocalBlipSessionSnapshot(target.id, cloned, 0, transcript);
}

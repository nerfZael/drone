import { afterEach, describe, expect, test } from 'bun:test';
import path from 'node:path';

import { VoiceStreamNextDb } from './db.js';

function tempDb(name: string): VoiceStreamNextDb {
  const dir = path.join(process.cwd(), 'server', 'data', 'tests');
  return new VoiceStreamNextDb(path.join(dir, `${name}-${crypto.randomUUID()}.sqlite`));
}

describe('transcript storage', () => {
  const dbs: VoiceStreamNextDb[] = [];

  afterEach(() => {
    for (const db of dbs) db.db.close();
    dbs.length = 0;
  });

  test('stores final transcripts with session and thread metadata', () => {
    const db = tempDb('transcript-meta');
    dbs.push(db);
    const user = db.upsertUser({
      clerkUserId: 'clerk_transcripts',
      displayName: 'Transcript User',
      email: 'transcripts@example.local',
      admin: false,
    });
    const device = db.registerDevice(user.id, { deviceType: 'desktop', displayName: 'Desk mic' });
    const session = db.createVoiceSession(user.id, device.device.id, 'patch');
    db.addTranscript(user.id, session.id, 'Patch me in with this note.');
    db.endVoiceSession(user.id, session.id);

    const transcripts = db.listTranscripts(user.id);
    expect(transcripts).toHaveLength(1);
    expect(transcripts[0]?.text).toBe('Patch me in with this note.');
    expect(transcripts[0]?.deviceName).toBe('Desk mic');
    expect(transcripts[0]?.mode).toBe('patch');
    expect(transcripts[0]?.assistantThreadId).toBe(session.assistantThreadId);
    expect(transcripts[0]?.sessionStartedAt).toBeTruthy();
    expect(transcripts[0]?.sessionEndedAt).toBeTruthy();
  });

  test('filters transcripts by device and voice session', () => {
    const db = tempDb('transcript-filters');
    dbs.push(db);
    const user = db.upsertUser({
      clerkUserId: 'clerk_filters',
      displayName: 'Filter User',
      email: 'filters@example.local',
      admin: false,
    });
    const phone = db.registerDevice(user.id, { deviceType: 'android', displayName: 'Phone' });
    const desktop = db.registerDevice(user.id, { deviceType: 'desktop', displayName: 'Desktop' });
    const phoneSession = db.createVoiceSession(user.id, phone.device.id, 'assistant');
    const desktopSession = db.createVoiceSession(user.id, desktop.device.id, 'clipboard');
    db.addTranscript(user.id, phoneSession.id, 'Phone transcript');
    db.addTranscript(user.id, desktopSession.id, 'Desktop transcript');

    expect(db.listTranscripts(user.id, 20, { deviceId: phone.device.id })).toHaveLength(1);
    expect(db.listTranscripts(user.id, 20, { deviceId: phone.device.id })[0]?.text).toBe('Phone transcript');
    expect(db.listTranscripts(user.id, 20, { voiceSessionId: desktopSession.id })).toHaveLength(1);
    expect(db.listTranscripts(user.id, 20, { voiceSessionId: desktopSession.id })[0]?.text).toBe('Desktop transcript');
  });

  test('ignores blank transcript text', () => {
    const db = tempDb('transcript-blank');
    dbs.push(db);
    const user = db.upsertUser({
      clerkUserId: 'clerk_blank',
      displayName: 'Blank User',
      email: 'blank@example.local',
      admin: false,
    });
    const device = db.registerDevice(user.id, { deviceType: 'desktop', displayName: 'Desk' });
    const session = db.createVoiceSession(user.id, device.device.id, 'assistant');
    db.addTranscript(user.id, session.id, '   ');
    expect(db.listTranscripts(user.id)).toHaveLength(0);
  });

  test('updates a live transcript row without creating duplicates', () => {
    const db = tempDb('transcript-live');
    dbs.push(db);
    const user = db.upsertUser({
      clerkUserId: 'clerk_live_transcript',
      displayName: 'Live User',
      email: 'live@example.local',
      admin: false,
    });
    const device = db.registerDevice(user.id, { deviceType: 'desktop', displayName: 'Live desk' });
    const session = db.createVoiceSession(user.id, device.device.id, 'computer');
    db.setTranscript(user.id, session.id, 'First live chunk', false);
    db.setTranscript(user.id, session.id, 'First live chunk second live chunk', true);

    const transcripts = db.listTranscripts(user.id, 20, { voiceSessionId: session.id });
    expect(transcripts).toHaveLength(1);
    expect(transcripts[0]?.text).toBe('First live chunk second live chunk');
    expect(transcripts[0]?.final).toBe(true);
  });

  test('stores voice recording metadata with paired transcript and prunes per mode', () => {
    const db = tempDb('voice-recordings');
    dbs.push(db);
    const user = db.upsertUser({
      clerkUserId: 'clerk_recordings',
      displayName: 'Recording User',
      email: 'recordings@example.local',
      admin: false,
    });
    const device = db.registerDevice(user.id, { deviceType: 'desktop', displayName: 'Desk' });
    const sessions = Array.from({ length: 12 }, (_, index) => db.createVoiceSession(user.id, device.device.id, 'clipboard'));
    for (const [index, session] of sessions.entries()) {
      db.addTranscript(user.id, session.id, `Transcript ${index}`);
      db.addVoiceRecording(user.id, {
        voiceSessionId: session.id,
        deviceId: device.device.id,
        assistantThreadId: session.assistantThreadId,
        mode: 'clipboard',
        filePath: `/tmp/${session.id}.wav`,
        mimeType: 'audio/wav',
        sizeBytes: 100 + index,
        durationMs: 1_000 + index,
        sampleRateHz: 16_000,
        channels: 1,
      });
    }

    expect(db.listVoiceRecordings(user.id, 20, { mode: 'clipboard' })).toHaveLength(12);
    const pruned = db.pruneVoiceRecordings(user.id, 'clipboard', 10);
    expect(pruned).toHaveLength(2);
    const recordings = db.listVoiceRecordings(user.id, 20, { mode: 'clipboard' });
    expect(recordings).toHaveLength(10);
    expect(recordings[0]?.transcriptText).toBe('Transcript 11');
    expect(recordings[0]?.deviceName).toBe('Desk');
    expect(recordings.some((recording) => recording.voiceSessionId === sessions[0]?.id)).toBe(false);
  });
});

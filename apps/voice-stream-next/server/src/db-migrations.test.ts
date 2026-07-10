import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { VoiceStreamNextDb, loadMigrations } from './db.js';

function tempDbPath(name: string): string {
  return path.join(process.cwd(), 'server', 'data', 'tests', `${name}-${crypto.randomUUID()}.sqlite`);
}

const BASELINE_MIGRATION_VERSION = '20260525173842';
const SPEECH_PLAYBACK_MIGRATION_VERSION = '20260525190000';
const ASSISTANT_EXTENSIONS_MIGRATION_VERSION = '20260526093000';
const DEVICE_INSTALLATION_MIGRATION_VERSION = '20260526120000';
const ASSISTANT_WEB_SEARCH_MIGRATION_VERSION = '20260526140000';
const ASSISTANT_FETCH_CONTENT_MIGRATION_VERSION = '20260526141000';
const ASSISTANT_API_KEYS_MIGRATION_VERSION = '20260526142000';
const ASSISTANT_DEFAULT_TOOLS_MIGRATION_VERSION = '20260527183000';
const DEVICE_AUTH_REQUEST_TYPE_MIGRATION_VERSION = '20260527190000';
const VOICE_SLEEP_PHRASES_MIGRATION_VERSION = '20260529120000';
const ASSISTANT_CREATE_NEW_THREAD_TOOL_MIGRATION_VERSION = '20260530120000';
const ASSISTANT_SKILLS_MIGRATION_VERSION = '20260531120000';
const ASSISTANT_THREAD_SKILLS_MIGRATION_VERSION = '20260531121000';
const VOICE_RECORDINGS_MIGRATION_VERSION = '20260601090000';
const ASSISTANT_PROFILES_MIGRATION_VERSION = '20260601100000';
const ANDROID_WEBVIEW_SESSIONS_MIGRATION_VERSION = '20260601120000';
const BILLING_CREDITS_MIGRATION_VERSION = '20260603120000';
const PENDING_CREDIT_GRANTS_MIGRATION_VERSION = '20260603130000';
const EXTENSION_SKILLS_AND_EXECUTION_TARGETS_MIGRATION_VERSION = '20260605120000';
const ASSISTANT_HANDS_FREE_MODE_MIGRATION_VERSION = '20260605130000';
const DESKTOP_AUTH_REMOTE_CLAIM_MIGRATION_VERSION = '20260606120000';
const PENDING_DESKTOP_AUTH_DEVICES_MIGRATION_VERSION = '20260606123000';
const LIVE_RECORDING_SEGMENTS_MIGRATION_VERSION = '20260612120000';
const ASSISTANT_VOICE_MODE_MIGRATION_VERSION = '20260613120000';
const REMOVE_THREAD_APPROVAL_CAPABILITY_MIGRATION_VERSION = '20260705010000';
const ASSISTANT_GPT_5_6_LUNA_DEFAULT_MIGRATION_VERSION = '20260710120000';

function migrationRows(db: VoiceStreamNextDb): Array<{ version: string; name: string; checksum: string }> {
  return db.db
    .query('SELECT version, name, checksum FROM schema_migrations ORDER BY version')
    .all() as Array<{ version: string; name: string; checksum: string }>;
}

function columnNames(db: VoiceStreamNextDb, table: string): string[] {
  return (db.db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
}

describe('database migrations', () => {
  const dbs: VoiceStreamNextDb[] = [];

  afterEach(() => {
    for (const db of dbs) db.db.close();
    dbs.length = 0;
  });

  test('applies the baseline migration for a fresh database', () => {
    const db = new VoiceStreamNextDb(tempDbPath('fresh-migration'));
    dbs.push(db);

    expect(migrationRows(db).map((row) => row.version)).toEqual([
      BASELINE_MIGRATION_VERSION,
      SPEECH_PLAYBACK_MIGRATION_VERSION,
      ASSISTANT_EXTENSIONS_MIGRATION_VERSION,
      DEVICE_INSTALLATION_MIGRATION_VERSION,
      ASSISTANT_WEB_SEARCH_MIGRATION_VERSION,
      ASSISTANT_FETCH_CONTENT_MIGRATION_VERSION,
      ASSISTANT_API_KEYS_MIGRATION_VERSION,
      ASSISTANT_DEFAULT_TOOLS_MIGRATION_VERSION,
      DEVICE_AUTH_REQUEST_TYPE_MIGRATION_VERSION,
      VOICE_SLEEP_PHRASES_MIGRATION_VERSION,
      ASSISTANT_CREATE_NEW_THREAD_TOOL_MIGRATION_VERSION,
      ASSISTANT_SKILLS_MIGRATION_VERSION,
      ASSISTANT_THREAD_SKILLS_MIGRATION_VERSION,
      VOICE_RECORDINGS_MIGRATION_VERSION,
      ASSISTANT_PROFILES_MIGRATION_VERSION,
      ANDROID_WEBVIEW_SESSIONS_MIGRATION_VERSION,
      BILLING_CREDITS_MIGRATION_VERSION,
      PENDING_CREDIT_GRANTS_MIGRATION_VERSION,
      EXTENSION_SKILLS_AND_EXECUTION_TARGETS_MIGRATION_VERSION,
      ASSISTANT_HANDS_FREE_MODE_MIGRATION_VERSION,
      DESKTOP_AUTH_REMOTE_CLAIM_MIGRATION_VERSION,
      PENDING_DESKTOP_AUTH_DEVICES_MIGRATION_VERSION,
      LIVE_RECORDING_SEGMENTS_MIGRATION_VERSION,
      ASSISTANT_VOICE_MODE_MIGRATION_VERSION,
      REMOVE_THREAD_APPROVAL_CAPABILITY_MIGRATION_VERSION,
      ASSISTANT_GPT_5_6_LUNA_DEFAULT_MIGRATION_VERSION,
    ]);
    expect(columnNames(db, 'devices')).toContain('revoked_at');
    expect(columnNames(db, 'devices')).toContain('installation_id');
    expect(columnNames(db, 'devices')).toContain('pending_auth_expires_at');
    expect(columnNames(db, 'devices')).toContain('pending_auth_installation_id');
    expect(columnNames(db, 'desktop_auth_requests')).toContain('installation_id');
    expect(columnNames(db, 'desktop_auth_requests')).toContain('claimed_server_url');
    expect(columnNames(db, 'desktop_auth_requests')).toContain('claimed_device_id');
    expect(columnNames(db, 'assistant_threads')).toContain('enabled_tools_json');
    expect(columnNames(db, 'assistant_settings')).toContain('default_enabled_tools_json');
    expect(columnNames(db, 'voice_settings')).toContain('speech_playback_target');
    expect(columnNames(db, 'voice_recordings')).toContain('file_path');
    expect(columnNames(db, 'assistant_threads')).toContain('assistant_profile_id');
    expect(columnNames(db, 'voice_sessions')).toContain('assistant_profile_id');
    expect(columnNames(db, 'assistant_profiles')).toContain('wake_phrase_aliases_json');
    expect(columnNames(db, 'credit_ledger')).toContain('balance_after_microcredits');
    expect(columnNames(db, 'billable_usage_events')).toContain('credential_source');
    expect(columnNames(db, 'pending_credit_grants')).toContain('normalized_email');
    expect(columnNames(db, 'pending_credit_grants')).toContain('claimed_ledger_id');
    expect(columnNames(db, 'assistant_skills')).toContain('managed_by_extension_id');
    expect(columnNames(db, 'assistant_thread_execution_targets')).toContain('target_device_id');
    expect(columnNames(db, 'assistant_threads')).toContain('hands_free_mode');
    expect(columnNames(db, 'assistant_profiles')).toContain('default_hands_free_mode');
    expect(columnNames(db, 'voice_recording_segments')).toContain('recording_id');
    expect(columnNames(db, 'voice_recording_segments')).toContain('sequence');
    expect(columnNames(db, 'assistant_threads')).toContain('voice_mode');
  });

  test('does not rerun already applied migrations', () => {
    const filePath = tempDbPath('idempotent-migration');
    const first = new VoiceStreamNextDb(filePath);
    first.db.close();

    const second = new VoiceStreamNextDb(filePath);
    dbs.push(second);

    expect(migrationRows(second)).toHaveLength(26);
  });

  test('rejects changed migration checksums', () => {
    const filePath = tempDbPath('checksum-migration');
    const db = new VoiceStreamNextDb(filePath);
    db.db
      .query('UPDATE schema_migrations SET checksum = $checksum WHERE version = $version')
      .run({ $checksum: 'changed', $version: BASELINE_MIGRATION_VERSION });
    db.db.close();

    expect(() => new VoiceStreamNextDb(filePath)).toThrow(/migration checksum mismatch/);
  });

  test('rejects existing app tables without migration history', () => {
    const filePath = tempDbPath('untracked-existing-db');
    const legacy = new Database(filePath, { create: true });
    legacy.exec('CREATE TABLE users (id TEXT PRIMARY KEY);');
    legacy.close();

    expect(() => new VoiceStreamNextDb(filePath)).toThrow(/has tables but no migration history/);
  });

  test('rejects invalid SQL migration file names', () => {
    const dir = path.join(process.cwd(), 'server', 'data', 'tests', `bad-migration-name-${crypto.randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, '20260525173842_initial.sql'), 'CREATE TABLE IF NOT EXISTS demo (id TEXT PRIMARY KEY);');
    writeFileSync(path.join(dir, '2_bad.sql'), 'SELECT 1;');

    try {
      expect(() => loadMigrations(dir)).toThrow(/invalid migration file name: 2_bad\.sql/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

import { describe, expect, test } from 'bun:test';
import { createEnvDraftEntry, envDraftEntriesToMap, envMapToDraftEntries, envValueEntriesToDraftEntries, mergeImportedEnvIntoDraftEntries, parseDotenvText, validateEnvDraftEntries } from '../src/droneHub/env/env-utils';

describe('env utils', () => {
  test('parses dotenv-style text', () => {
    const parsed = parseDotenvText([
      'FOO=bar',
      'export BAR="two words"',
      "BAZ='3'",
      'BROKEN LINE',
      'ZED=value # comment',
    ].join('\n'));

    expect(parsed.vars).toEqual({
      FOO: 'bar',
      BAR: 'two words',
      BAZ: '3',
      ZED: 'value',
    });
    expect(parsed.warnings.length).toBe(1);
  });

  test('merges imported vars into existing rows by key', () => {
    const merged = mergeImportedEnvIntoDraftEntries(
      [
        createEnvDraftEntry('FOO', 'one'),
        createEnvDraftEntry('BAR', 'two'),
      ],
      { BAR: 'updated', BAZ: 'three' },
    );

    expect(envDraftEntriesToMap(merged)).toEqual({
      FOO: 'one',
      BAR: 'updated',
      BAZ: 'three',
    });
  });

  test('round-trips env maps through draft entries', () => {
    const entries = envMapToDraftEntries({ BETA: '2', ALPHA: '1' });
    expect(entries.map((entry) => entry.key)).toEqual(['ALPHA', 'BETA']);
    expect(envDraftEntriesToMap(entries)).toEqual({ ALPHA: '1', BETA: '2' });
  });

  test('converts API value entries into draft entries', () => {
    const entries = envValueEntriesToDraftEntries([
      { key: 'BETA', value: '2' },
      { key: 'ALPHA', value: '1' },
    ]);
    expect(entries.map((entry) => [entry.key, entry.value])).toEqual([
      ['ALPHA', '1'],
      ['BETA', '2'],
    ]);
  });

  test('validates duplicate and invalid keys', () => {
    expect(validateEnvDraftEntries([
      createEnvDraftEntry('1NOPE', 'bad'),
    ])).toContain('Invalid');

    expect(validateEnvDraftEntries([
      createEnvDraftEntry('DUP', 'one'),
      createEnvDraftEntry('DUP', 'two'),
    ])).toContain('Duplicate');

    expect(validateEnvDraftEntries([
      createEnvDraftEntry('GOOD_KEY', 'ok'),
      createEnvDraftEntry('', ''),
    ])).toBeNull();
  });
});

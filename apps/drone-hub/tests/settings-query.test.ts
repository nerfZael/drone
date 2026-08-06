import { describe, expect, test } from 'bun:test';
import { settingsQueryError, settingsQueryKey } from '../src/droneHub/app/settings-query';

describe('settings query helpers', () => {
  test('namespaces settings resources consistently', () => {
    expect(settingsQueryKey('skills', 'source-1')).toEqual(['settings', 'skills', 'source-1']);
  });

  test('keeps local errors visible and query errors dismissible', () => {
    const failed = { error: new Error('Request failed'), isFetching: false };

    expect(settingsQueryError('Validation failed', false, failed)).toBe('Validation failed');
    expect(settingsQueryError(null, false, failed)).toBe('Request failed');
    expect(settingsQueryError(null, true, failed)).toBeNull();
    expect(settingsQueryError(null, false, { ...failed, isFetching: true })).toBeNull();
  });
});

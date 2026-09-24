import { expect, test } from 'bun:test';
import type React from 'react';
import { beginRecordBusyKey, removeRecordKey } from '../src/droneHub/app/keyed-record-state';

test('starts requests before deferred React updates and prevents duplicate requests', () => {
  const updates: React.SetStateAction<Record<string, true>>[] = [];
  const setBusy: React.Dispatch<React.SetStateAction<Record<string, true>>> = (update) => {
    updates.push(update);
  };
  const inFlight = new Set<string>();
  const requests: string[] = [];
  const cancel = (id: string) => {
    if (!beginRecordBusyKey(setBusy, inFlight, id)) return;
    requests.push(id);
  };

  cancel('first');
  cancel('first');
  cancel('second');
  // Requests must start even though React has not run any state updaters.
  expect(requests).toEqual(['first', 'second']);
  expect(updates).toHaveLength(2);

  let state: Record<string, true> = {};
  for (const update of updates) {
    if (typeof update !== 'function') throw new Error('expected a state updater');
    expect(update(state)).toEqual(update(state)); // React can replay updaters.
    state = update(state);
  }
  expect(state).toEqual({ first: true, second: true });
  expect(requests).toEqual(['first', 'second']);

  // Completion (including failure) releases the claim so the user can retry.
  inFlight.delete('first');
  state = removeRecordKey(state, 'first');
  cancel('first');
  expect(requests).toEqual(['first', 'second', 'first']);
  expect(state).toEqual({ second: true });
});

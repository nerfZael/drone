import { describe, expect, test } from 'bun:test';

import {
  consumeRequestedChangeRequest,
  requestOpenChangeRequest,
} from '../src/droneHub/changeRequests/change-request-navigation';

describe('change request navigation', () => {
  test('keeps a pending request until the side panel is ready to consume it', () => {
    requestOpenChangeRequest({ droneId: 'drone-1', requestNumber: 42 });

    expect(consumeRequestedChangeRequest('drone-1')).toBe(42);
    expect(consumeRequestedChangeRequest('drone-1')).toBeNull();
  });
});

import { describe, expect, test } from 'bun:test';
import type { ServerResponse } from 'node:http';

import { writeFileSseFrame } from '../src/hub/filesystem-route-service';

describe('filesystem file event stream', () => {
  test('destroys a slow client on event or heartbeat backpressure', () => {
    for (const frame of ['event: changed\ndata: {}\n\n', ': keepalive\n\n']) {
      let destroyed = false;
      const response = {
        writableEnded: false,
        destroyed: false,
        write: () => false,
        destroy() {
          destroyed = true;
          this.destroyed = true;
        },
      } as unknown as ServerResponse;

      expect(writeFileSseFrame(response, frame)).toBe(false);
      expect(destroyed).toBe(true);
    }
  });

  test('keeps healthy clients and closes clients whose write throws', () => {
    let destroyed = false;
    const healthy = {
      writableEnded: false,
      destroyed: false,
      write: () => true,
      destroy: () => {
        destroyed = true;
      },
    } as unknown as ServerResponse;
    expect(writeFileSseFrame(healthy, 'event: snapshot\ndata: {}\n\n')).toBe(true);
    expect(destroyed).toBe(false);

    const failed = {
      writableEnded: false,
      destroyed: false,
      write: () => {
        throw new Error('socket closed');
      },
      destroy: () => {
        destroyed = true;
      },
    } as unknown as ServerResponse;
    expect(writeFileSseFrame(failed, ': keepalive\n\n')).toBe(false);
    expect(destroyed).toBe(true);
  });
});

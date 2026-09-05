import { describe, expect, test } from 'bun:test';
import { DeviceEventParser, DeviceHttpEventClient } from '../src/http-event-client';

describe('HTTP device events', () => {
  test('parses UTF-8 event data across reads and split CRLF separators', () => {
    const events: string[] = [];
    const parser = new DeviceEventParser((data) => events.push(data));
    parser.push(': heartbeat\r\n\r');
    parser.push('\ndata: {"text":"ž');
    parser.push('"}\r\n\r');
    parser.push('\ndata: first\ndata: second\n\n');
    expect(events).toEqual(['{"text":"ž"}', 'first\nsecond']);
  });

  test('rejects non-private cleartext endpoints before making a request', () => {
    expect(() => new DeviceHttpEventClient('http://example.com', 'device')).toThrow('HTTPS');
  });
});

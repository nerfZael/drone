import { describe, expect, test } from 'bun:test';

import { parseControlClientMessage, parseVoiceClientMessage } from './protocol.js';

describe('parseControlClientMessage', () => {
  test('accepts status, ping, and command ack messages', () => {
    expect(parseControlClientMessage(JSON.stringify({ type: 'client_ping', sentAt: '2026-05-21T00:00:00.000Z' }))).toEqual({
      type: 'client_ping',
      sentAt: '2026-05-21T00:00:00.000Z',
    });
    expect(parseControlClientMessage(JSON.stringify({
      type: 'client_status',
      mode: 'awake',
      status: 'Ready',
      clientVersion: 1,
    }))).toMatchObject({
      type: 'client_status',
      mode: 'awake',
      status: 'Ready',
      clientVersion: 1,
    });
    expect(parseControlClientMessage(JSON.stringify({
      type: 'command_ack',
      commandId: 'cmd_1',
      ok: true,
      command: 'query_status',
      status: 'Ready',
    }))).toMatchObject({
      type: 'command_ack',
      commandId: 'cmd_1',
      ok: true,
      command: 'query_status',
      status: 'Ready',
    });
  });

  test('rejects unknown control messages', () => {
    expect(parseControlClientMessage(JSON.stringify({ type: 'server_command' }))).toBeNull();
    expect(parseControlClientMessage('not-json')).toBeNull();
  });
});

describe('parseVoiceClientMessage', () => {
  test('accepts pause and resume messages', () => {
    expect(parseVoiceClientMessage(JSON.stringify({ type: 'pause', reason: 'thinking' }))).toEqual({
      type: 'pause',
      reason: 'thinking',
    });
    expect(parseVoiceClientMessage(JSON.stringify({ type: 'resume', reason: 'ready' }))).toEqual({
      type: 'resume',
      reason: 'ready',
    });
  });

  test('rejects unknown voice messages', () => {
    expect(parseVoiceClientMessage(JSON.stringify({ type: 'paused' }))).toBeNull();
    expect(parseVoiceClientMessage('not-json')).toBeNull();
  });
});

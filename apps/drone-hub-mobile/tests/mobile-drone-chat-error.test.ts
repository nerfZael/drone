import { describe, expect, test } from 'bun:test';
import { mobileDroneChatErrorMessage } from '../src/drones/mobile-drone-chat-error';

describe('mobile drone chat errors', () => {
  test('keeps device connection state out of the chat error surface', () => {
    expect(mobileDroneChatErrorMessage('No paired device is connected')).toBeNull();
    expect(mobileDroneChatErrorMessage('No mesh connection is available')).toBeNull();
    expect(mobileDroneChatErrorMessage('Device connection closed')).toBeNull();
  });

  test('keeps real chat and operation errors visible', () => {
    expect(mobileDroneChatErrorMessage('Prompt was rejected')).toBe('Prompt was rejected');
  });
});

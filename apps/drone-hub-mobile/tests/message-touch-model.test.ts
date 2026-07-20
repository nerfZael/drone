import { describe, expect, test } from 'bun:test';
import { shouldToggleMessageTimestamp } from '../src/local-assistant/message-touch-model';

describe('mobile message timestamp gesture', () => {
  test('ignores a touch sequence owned by an inline control', () => {
    expect(
      shouldToggleMessageTimestamp({ active: false, moved: false, longPressed: false }),
    ).toBe(false);
  });

  test('only treats an uninterrupted message touch as a timestamp tap', () => {
    expect(
      shouldToggleMessageTimestamp({ active: true, moved: false, longPressed: false }),
    ).toBe(true);
    expect(
      shouldToggleMessageTimestamp({ active: true, moved: true, longPressed: false }),
    ).toBe(false);
    expect(
      shouldToggleMessageTimestamp({ active: true, moved: false, longPressed: true }),
    ).toBe(false);
  });
});

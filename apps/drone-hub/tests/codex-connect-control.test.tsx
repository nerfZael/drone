import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  CodexConnectComposerNotice,
  CodexConnectControl,
} from '../src/droneHub/app/CodexConnectControl';

describe('Codex connection notice', () => {
  test('does not claim sign-in is required before the initial status check completes', () => {
    const html = renderToStaticMarkup(<CodexConnectControl compact />);

    expect(html).toBe('');
    expect(html).not.toContain('Codex sign-in required');
  });

  test('uses the same inner width and horizontal padding as the chat composer', () => {
    const html = renderToStaticMarkup(<CodexConnectComposerNotice resetKey="drone:chat" />);

    expect(html).toContain('class="px-[.5625rem]"');
    expect(html).toContain('mx-auto max-w-[73.125rem]');
    expect(html).not.toContain('mx-3 rounded');
  });
});

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'bun:test';

import { ExternalAgentModelsSettingsSection } from '../src/droneHub/app/ExternalAgentModelsSettingsSection';

describe('External agent model settings', () => {
  test('renders the refresh action and supported-agent explanation', () => {
    const requestJson = async <T,>() => ({}) as T;
    const html = renderToStaticMarkup(
      <ExternalAgentModelsSettingsSection requestJson={requestJson} />,
    );

    expect(html).toContain('External agent model lists');
    expect(html).toContain('Refresh model lists');
    expect(html).toContain('Cursor Agent, Codex, Claude Code, OpenCode, Pi, and Blip');
  });
});

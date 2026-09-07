import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'bun:test';

import { ExternalAgentModelsSettingsSection } from '../src/droneHub/app/ExternalAgentModelsSettingsSection';

describe('External agent model settings', () => {
  test('renders the refresh action and supported-agent explanation', () => {
    const requestJson = async <T,>() => ({}) as T;
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <ExternalAgentModelsSettingsSection requestJson={requestJson} />
      </QueryClientProvider>,
    );

    expect(html).toContain('External agent model lists');
    expect(html).toContain('Refresh model lists');
    expect(html).toContain('Cursor Agent, Codex, Claude Code, OpenCode, Pi, and Blip');
  });
});

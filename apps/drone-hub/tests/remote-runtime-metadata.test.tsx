import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { RemoteRuntimeMetadata } from '../src/remote/RemoteRuntimeMetadata';

function renderMetadata(overrides: Partial<React.ComponentProps<typeof RemoteRuntimeMetadata>> = {}): string {
  return renderToStaticMarkup(
    <RemoteRuntimeMetadata
      hasDrone
      repoPath="/work/repo"
      agent={{ kind: 'builtin', id: 'codex' }}
      configuredModel={null}
      models={[{ id: 'gpt-test', label: 'GPT Test', isDefault: true }]}
      loading={false}
      error={null}
      draft={false}
      {...overrides}
    />,
  );
}

describe('RemoteRuntimeMetadata', () => {
  test('shows repo, agent CLI, and detected model without the old container-only subtitle', () => {
    const html = renderMetadata();
    expect(html).toContain('repo');
    expect(html).toContain('Codex (gpt-test)');
    expect(html).not.toContain('>CLI<');
    expect(html).not.toContain('>Model<');
    expect(html).not.toContain('Container-only remote surface');
  });

  test('renders loading and unavailable states without stale runtime values', () => {
    expect(renderMetadata({ loading: true })).toContain('Detecting runtime…');
    expect(renderMetadata({ agent: null, models: [], error: 'Unavailable' })).toContain('Runtime not reported');
  });

  test('does not claim a model for a custom agent command', () => {
    const html = renderMetadata({
      agent: { kind: 'custom', id: 'custom-agent', label: 'My Agent', command: 'my-agent' },
      models: [],
    });
    expect(html).toContain('Custom: My Agent (Not reported)');
  });
});

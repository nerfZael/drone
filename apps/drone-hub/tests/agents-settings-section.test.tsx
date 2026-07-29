import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'bun:test';

import { AgentsSettingsSection } from '../src/droneHub/app/AgentsSettingsSection';
import type { UseAgentsSettingsResult } from '../src/droneHub/app/use-agents-settings';

const agents: UseAgentsSettingsResult = {
  agentsSettings: {
    ok: true,
    agents: {
      content: '# Default instructions',
      enabled: true,
      updatedAt: '2026-07-29T00:00:00.000Z',
    },
    files: [
      {
        id: 'backend',
        name: 'Backend work',
        sizeBytes: 256,
        createdAt: '2026-07-29T00:00:00.000Z',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
    ],
  },
  agentsSettingsLoading: false,
  agentsSettingsError: null,
  agentsSettingsNotice: null,
  agentsContentDraft: '# Default instructions',
  savingAgentsSettings: false,
  selectedAgentsFile: {
    id: 'backend',
    name: 'Backend work',
    content: '# Backend instructions\n',
    sizeBytes: 256,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  },
  creatingAgentsFile: false,
  agentsFileDraftName: 'Backend work',
  agentsFileDraftContent: '# Backend instructions\n',
  agentsFileLoading: false,
  savingAgentsFile: false,
  deletingAgentsFile: false,
  importingAgentsFiles: false,
  agentsFileDraftDirty: false,
  setAgentsContentDraft: () => {},
  setAgentsFileDraftName: () => {},
  setAgentsFileDraftContent: () => {},
  loadAgentsSettings: async () => {},
  saveAgentsSettings: async () => {},
  selectAgentsFile: async () => {},
  beginAgentsFile: () => {},
  closeAgentsFile: () => {},
  saveAgentsFile: async () => {},
  deleteAgentsFile: async () => {},
  importAgentsFiles: async () => {},
};

describe('Agents settings library', () => {
  test('renders named AGENTS.md files and the selected editor', () => {
    const html = renderToStaticMarkup(<AgentsSettingsSection agents={agents} />);

    expect(html).toContain('Saved AGENTS.md files');
    expect(html).toContain('Backend work');
    expect(html).toContain('aria-label="Saved AGENTS.md content"');
    expect(html).toContain('# Backend instructions');
    expect(html).toContain('Each file is limited to 2 MiB.');
    expect(html).toContain('Drop Markdown or text files here');
    expect(html).toContain('aria-label="Import AGENTS.md files"');
    expect(html).toContain('multiple=""');
  });
});

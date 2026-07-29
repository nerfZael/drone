import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'bun:test';

import { NewDroneSetupPanel } from '../src/droneHub/app/NewDroneSetupPanel';

const baseProps: React.ComponentProps<typeof NewDroneSetupPanel> = {
  createRuntime: 'container',
  onCreateRuntimeChange: () => {},
  createAsDraft: false,
  onCreateAsDraftChange: () => {},
  createPersistVolume: false,
  onCreatePersistVolumeChange: () => {},
  spawnAgentPermissionMode: 'full-access',
  onSpawnAgentPermissionModeChange: () => {},
  spawnApprovalPolicy: 'ask',
  onSpawnApprovalPolicyChange: () => {},
  spawnAgentApprovalSupported: true,
  spawnAgentReadOnlySupported: true,
  spawnAgentConfig: { kind: 'native' },
  createRepoMenuEntries: [],
  draftCreateRepoPath: '/work/repo',
  agentsMdLibraryFiles: [
    {
      id: 'backend',
      name: 'Backend work',
      sizeBytes: 128,
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
    },
  ],
  agentsMdLibraryLoading: false,
  agentsMdLibraryError: null,
  draftAgentsMdLibraryFileId: '',
  onDraftAgentsMdLibraryFileIdChange: () => {},
  draftAgentsMdOverrideEnabled: true,
  onDraftAgentsMdOverrideEnabledChange: () => {},
  draftAgentsMdOverride: '# Per-drone instructions',
  onDraftAgentsMdOverrideChange: () => {},
  repoBranchSource: 'host',
  onRepoBranchSourceChange: () => {},
  repoCreateRemoteBranch: '',
  onRepoCreateRemoteBranchChange: () => {},
  draftRepoHostBranch: 'main',
  draftRepoRemoteBranches: [],
  draftRepoBranchesLoading: false,
  draftRepoBranchesError: null,
  controlsLocked: false,
};

describe('new drone setup AGENTS.md override', () => {
  test('renders the override editor for repo-attached container drones', () => {
    const html = renderToStaticMarkup(<NewDroneSetupPanel {...baseProps} />);

    expect(html).toContain('AGENTS.md source');
    expect(html).toContain('Backend work');
    expect(html).toContain('Custom override');
    expect(html).toContain('aria-label="AGENTS.md override content"');
    expect(html).toContain('# Per-drone instructions');
    expect(html).toContain('Leave it empty to create an empty file.');
    expect(html).toContain('Maximum 2 MiB.');
  });

  test('renders a saved AGENTS.md file as the selected source', () => {
    const html = renderToStaticMarkup(
      <NewDroneSetupPanel
        {...baseProps}
        draftAgentsMdLibraryFileId="backend"
        draftAgentsMdOverrideEnabled={false}
      />,
    );

    expect(html).toContain('Uses the saved “Backend work” file for this drone.');
    expect(html).not.toContain('aria-label="AGENTS.md override content"');
  });

  test('explains why host drones cannot use a per-drone override', () => {
    const html = renderToStaticMarkup(<NewDroneSetupPanel {...baseProps} createRuntime="host" />);

    expect(html).toContain('AGENTS.md source');
    expect(html).toContain(
      'AGENTS.md selection is available for container drones only; host drones use the repository’s existing file.',
    );
    expect(html).not.toContain('aria-label="AGENTS.md override content"');
  });
});

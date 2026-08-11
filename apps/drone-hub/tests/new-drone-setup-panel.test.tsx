import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'bun:test';

import { NewDroneSetupPanel } from '../src/droneHub/app/NewDroneSetupPanel';
import { NewDroneTargetControls } from '../src/droneHub/app/NewDroneTargetControls';
import { DroneRuntimeIndicator } from '../src/droneHub/app/DroneRuntimeIndicator';
import { AgentComposerPicker } from '../src/droneHub/app/AgentComposerPicker';
import { NewDroneAccessPicker } from '../src/droneHub/app/NewDroneAccessPicker';

const baseProps: React.ComponentProps<typeof NewDroneSetupPanel> = {
  createRuntime: 'container',
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
  controlsLocked: false,
};

const targetProps: React.ComponentProps<typeof NewDroneTargetControls> = {
  createRuntime: 'container',
  onCreateRuntimeChange: () => {},
  repoPath: '/work/repo',
  branchSource: 'host',
  onBranchSourceChange: () => {},
  remoteBranch: '',
  onRemoteBranchChange: () => {},
  hostBranch: 'main',
  remoteBranches: [],
  branchesLoading: false,
  branchesError: null,
  disabled: false,
};

describe('new drone setup panel', () => {
  test('keeps repository and advanced controls in the footer row', () => {
    const html = renderToStaticMarkup(<NewDroneSetupPanel {...baseProps} />);

    expect(html).not.toContain('Choose agent');
    expect(html).not.toContain('Choose chat access and approvals');
    expect(html).toContain('No repository');
    expect(html).toContain('Advanced');
    expect(html).not.toContain('Execution target: Container');
    expect(html).not.toContain('Branch: main');
    expect(html).not.toContain('Pull first');
    expect(html).not.toContain('Persistent volume');
    expect(html).not.toContain('Save as draft');
    expect(html).not.toContain('role="group" aria-label="Chat access"');
    expect(html).not.toContain('role="group" aria-label="Approvals"');
  });

  test('renders agent and access controls for the composer control rows', () => {
    const html = renderToStaticMarkup(
      <>
        <AgentComposerPicker
          value="builtin:codex"
          label="Codex"
          entries={[{ value: 'builtin:codex', label: 'Codex' }]}
          onChange={() => {}}
        />
        <NewDroneAccessPicker
          permissionMode="write"
          onPermissionModeChange={() => {}}
          approvalPolicy="auto"
          onApprovalPolicyChange={() => {}}
          readOnlySupported
          approvalsSupported
          agentIsCodex
        />
      </>,
    );

    expect(html).toContain('Choose agent');
    expect(html).toContain('Codex');
    expect(html).toContain('Choose chat access and approvals');
    expect(html).toContain('Write · Auto');
  });

  test('renders runtime and branch in the upper target row', () => {
    const html = renderToStaticMarkup(<NewDroneTargetControls {...targetProps} />);

    expect(html).toContain('Execution target: Container');
    expect(html).toContain('Branch: main');
  });

  test('shows access and approval labels without timing qualifiers', () => {
    const html = renderToStaticMarkup(
      <NewDroneAccessPicker
        permissionMode="execute"
        onPermissionModeChange={() => {}}
        approvalPolicy="none"
        onApprovalPolicyChange={() => {}}
        readOnlySupported
        approvalsSupported
        agentIsCodex
      />,
    );

    expect(html).toContain('Execute · Never ask');
    expect(html).not.toContain('next turn');
    expect(html).not.toContain('Never ask now');
    expect(html).not.toContain('disabled=""');
  });

  test('renders an existing drone runtime as a read-only indicator', () => {
    const html = renderToStaticMarkup(<DroneRuntimeIndicator runtime="host" />);

    expect(html).toContain('data-drone-runtime-indicator="host"');
    expect(html).toContain('aria-label="Execution target: Host"');
    expect(html).toContain('Host');
    expect(html).not.toContain('<button');
  });

  test('renders a selected remote branch in the upper target row', () => {
    const html = renderToStaticMarkup(
      <NewDroneTargetControls
        {...targetProps}
        branchSource="remote"
        remoteBranch="origin/feature/picker"
        remoteBranches={[
          {
            name: 'origin/feature/picker',
            remote: 'origin',
            branch: 'feature/picker',
            headSha: null,
          },
        ]}
      />,
    );

    expect(html).toContain('Branch: origin/feature/picker');
  });

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

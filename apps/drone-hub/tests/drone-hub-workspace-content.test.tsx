import { describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

type DroneHubWorkspaceContentProps = import('../src/droneHub/app/DroneHubWorkspaceContent').DroneHubWorkspaceContentProps;

function mockedView(name: string) {
  return function MockedWorkspaceView(props: Record<string, unknown>) {
    return React.createElement(
      'div',
      {
        'data-view': name,
        'data-has-preview-host': String(typeof props.onPersistentPreviewHostChange === 'function'),
      },
      name,
    );
  };
}

mock.module('../src/droneHub/app/NoDroneSelectedState', () => ({
  NoDroneSelectedState: () => React.createElement('div', { 'data-view': 'no-drone' }, 'No drone selected'),
}));

mock.module('../src/droneHub/app/SetupWelcomeView', () => ({
  SetupWelcomeView: mockedView('setup'),
}));

mock.module('../src/droneHub/app/SettingsView', () => ({
  SettingsView: mockedView('settings'),
}));

mock.module('../src/droneHub/app/DraftChatWorkspace', () => ({
  DraftChatWorkspace: mockedView('draft'),
}));

mock.module('../src/droneHub/app/GroupMultiChatWorkspace', () => ({
  GroupMultiChatWorkspace: mockedView('group'),
}));

mock.module('../src/droneHub/app/SelectedDroneWorkspace', () => ({
  SelectedDroneWorkspace: mockedView('selected'),
}));

const { DroneHubWorkspaceContent } = await import('../src/droneHub/app/DroneHubWorkspaceContent');

function baseProps(overrides: Partial<DroneHubWorkspaceContentProps> = {}): DroneHubWorkspaceContentProps {
  return {
    appView: 'workspace',
    setupWelcomeProps: null,
    settingsViewProps: {} as DroneHubWorkspaceContentProps['settingsViewProps'],
    draftChatWorkspaceProps: null,
    groupMultiChatWorkspaceProps: null,
    noDroneSelectedStateProps: {} as DroneHubWorkspaceContentProps['noDroneSelectedStateProps'],
    selectedDroneWorkspaceProps: null,
    renderPersistentPreviewContent: () => null,
    ...overrides,
  };
}

function renderWorkspace(props: DroneHubWorkspaceContentProps): string {
  return renderToStaticMarkup(<DroneHubWorkspaceContent {...props} />);
}

async function renderSettled(props: DroneHubWorkspaceContentProps): Promise<string> {
  let html = renderWorkspace(props);
  for (let attempt = 0; attempt < 10 && html.includes('Loading workspace...'); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    html = renderWorkspace(props);
  }
  return html;
}

describe('DroneHubWorkspaceContent lazy workspace views', () => {
  test('shows the workspace fallback while a lazy branch is loading', () => {
    const html = renderWorkspace(baseProps({ groupMultiChatWorkspaceProps: {} as DroneHubWorkspaceContentProps['groupMultiChatWorkspaceProps'] }));
    expect(html).toContain('Loading workspace...');
  });

  test('keeps the empty state on the static default branch', () => {
    const html = renderWorkspace(baseProps());
    expect(html).toContain('data-view="no-drone"');
    expect(html).not.toContain('Loading workspace...');
  });

  test.each([
    ['draft', { draftChatWorkspaceProps: {} as DroneHubWorkspaceContentProps['draftChatWorkspaceProps'] }],
    ['group', { groupMultiChatWorkspaceProps: {} as DroneHubWorkspaceContentProps['groupMultiChatWorkspaceProps'] }],
    [
      'selected',
      {
        selectedDroneWorkspaceProps: {
          currentDrone: { id: 'drone-1' },
          rightPanelOpen: false,
        } as DroneHubWorkspaceContentProps['selectedDroneWorkspaceProps'],
      },
    ],
  ])('renders the %s workspace branch lazily', async (viewName, overrides) => {
    const html = await renderSettled(baseProps(overrides));
    expect(html).toContain(`data-view="${viewName}"`);
  });

  test('keeps setup welcome ahead of other workspace branches', async () => {
    const html = await renderSettled(
      baseProps({
        setupWelcomeProps: {} as DroneHubWorkspaceContentProps['setupWelcomeProps'],
        draftChatWorkspaceProps: {} as DroneHubWorkspaceContentProps['draftChatWorkspaceProps'],
      }),
    );
    expect(html).toContain('data-view="setup"');
    expect(html).not.toContain('data-view="draft"');
  });

  test('keeps settings ahead of setup welcome when settings is active', async () => {
    const html = await renderSettled(
      baseProps({
        appView: 'settings',
        setupWelcomeProps: {} as DroneHubWorkspaceContentProps['setupWelcomeProps'],
      }),
    );
    expect(html).toContain('data-view="settings"');
    expect(html).not.toContain('data-view="setup"');
  });

  test('passes selected-drone preview callbacks through the lazy wrapper', async () => {
    const html = await renderSettled(
      baseProps({
        selectedDroneWorkspaceProps: {
          currentDrone: { id: 'drone-1' },
          rightPanelOpen: false,
        } as DroneHubWorkspaceContentProps['selectedDroneWorkspaceProps'],
      }),
    );
    expect(html).toContain('data-view="selected"');
    expect(html).toContain('data-has-preview-host="true"');
  });

  test('does not mount the removed standalone assistant surface', async () => {
    const html = await renderSettled(
      baseProps({
        selectedDroneWorkspaceProps: {
          currentDrone: { id: 'drone-1' },
          rightPanelOpen: true,
          rightPanelTab: 'terminal',
          rightPanelSplit: false,
          rightPanelBottomTab: 'terminal',
        } as DroneHubWorkspaceContentProps['selectedDroneWorkspaceProps'],
      }),
    );
    expect(html).not.toContain('data-assistant-embedded');
  });
});

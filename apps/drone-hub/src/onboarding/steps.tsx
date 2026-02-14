import React from 'react';
import type { GuidedOnboardingStep } from './GuidedOnboarding';

export const GUIDED_ONBOARDING_STEPS: GuidedOnboardingStep[] = [
  {
    id: 'sidebar.droneCard',
    version: 1,
    selector: '[data-onboarding-id="sidebar.droneCard"]',
    title: 'Drone list actions',
    body: (
      <div className="space-y-2">
        <div>
          Click a drone to open it. Hover a drone row to reveal quick actions (clone, rename, delete) on the right.
        </div>
        <div className="text-[10px] text-[var(--muted-dim)]">
          Tip: use Ctrl/Cmd to multi-select, Shift for range selection.
        </div>
      </div>
    ),
  },
  {
    id: 'chat.toolbar.agent',
    version: 1,
    selector: '[data-onboarding-id="chat.toolbar.agent"]',
    title: 'Agent selector',
    body: (
      <div className="space-y-2">
        <div>Pick which agent implementation runs this chat (built-in or custom agents).</div>
      </div>
    ),
  },
  {
    id: 'chat.toolbar.model',
    version: 1,
    selector: '[data-onboarding-id="chat.toolbar.model"]',
    title: 'Model override',
    body: (
      <div className="space-y-2">
        <div>Optionally override the model for the current chat. You can also refresh the model list from inside the drone.</div>
      </div>
    ),
  },
  {
    id: 'chat.toolbar.chats',
    version: 1,
    selector: '[data-onboarding-id="chat.toolbar.chats"]',
    title: 'Chat tabs',
    body: (
      <div className="space-y-2">
        <div>Switch between chats within the selected drone session.</div>
      </div>
    ),
  },
  {
    id: 'rightPanel.toggle',
    version: 1,
    selector: '[data-onboarding-id="rightPanel.toggle"]',
    title: 'Right panel',
    body: (
      <div className="space-y-2">
        <div>Toggle the right panel for terminal, files, browser preview, links, and changes.</div>
      </div>
    ),
  },
  {
    id: 'rightPanel.tab.changes',
    version: 1,
    selector: '[data-onboarding-id="rightPanel.tab.changes"]',
    title: 'Changes tab',
    body: (
      <div className="space-y-2">
        <div>Open the Changes panel to inspect repo edits inside the drone (diffs, staged vs unstaged, untracked).</div>
      </div>
    ),
  },
  {
    id: 'changes.viewMode',
    version: 1,
    selector: '[data-onboarding-id="changes.viewMode"]',
    title: 'Diff view modes',
    body: (
      <div className="space-y-2">
        <div>Switch between PR-style stacked diffs and a split explorer + focused diff view.</div>
      </div>
    ),
  },
  {
    id: 'chat.input',
    version: 1,
    selector: '[data-onboarding-id="chat.input"]',
    title: 'Send prompts',
    body: (
      <div className="space-y-2">
        <div>Type a message and press Enter to send (Shift+Enter for a newline).</div>
      </div>
    ),
  },
];


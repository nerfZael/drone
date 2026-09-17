import React from 'react';
import { createRoot } from 'react-dom/client';
import { CompanionOverlay } from '../../src/droneHub/companion/CompanionOverlay';
import '../../src/styles.css';

// The smoke server substitutes only useCompanion; the actual overlay, menus,
// layout, CSS and native window hosting are exercised without starting voice.
const root = createRoot(document.getElementById('root')!);
const state = {
  status: 'recording', recordingPaused: false, durationMillis: 7000,
  activity: [], proposalHistory: [], proposals: [], subscriptions: [], actionNotifications: [],
  transcript: '', reply: '', error: '', autoApprove: false,
  toggleAutoApprove() {}, discardRecording() {},
  close() { update({ status: 'idle' }); },
};
function update(patch: object) {
  Object.assign(state, patch);
  root.render(<CompanionOverlay />);
}
Object.assign(window, { companionPanelState: state, updateCompanionPanel: update });
document.documentElement.dataset.theme = 'catppuccin-mocha';
update({});

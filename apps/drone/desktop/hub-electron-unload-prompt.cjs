const UNSAVED_CHANGES_CHANNEL = 'drone-hub:unsaved-changes';
const DISCARD = 0;
const KEEP_EDITING = 1;
const LISTED_CHANGES = 8;

function unsavedChangesDetail(unsaved) {
  if (unsaved.length === 0) return "Changes you haven't saved will be lost.";
  const listed = unsaved.slice(0, LISTED_CHANGES).map((label) => `• ${label}`);
  if (unsaved.length > LISTED_CHANGES) listed.push(`• and ${unsaved.length - LISTED_CHANGES} more`);
  return `Unsaved changes in:\n${listed.join('\n')}\n\nThey will be lost.`;
}

function unloadPromptOptions(forClose, unsaved = []) {
  return {
    type: 'warning',
    title: forClose ? 'Close Drone Hub' : 'Reload Drone Hub',
    message: forClose ? 'Close Drone Hub without saving?' : 'Reload Drone Hub without saving?',
    detail: unsavedChangesDetail(unsaved),
    buttons: [forClose ? 'Discard and Close' : 'Discard and Reload', 'Keep Editing'],
    defaultId: KEEP_EDITING,
    cancelId: KEEP_EDITING,
    noLink: true,
  };
}

function cleanUnsavedChanges(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((label) => typeof label === 'string' && label.trim()).slice(0, 200).map((label) => label.trim().slice(0, 200));
}

// A page with unsaved changes (an edited file, Companion settings) objects to unloading. A browser would ask
// "Leave site?", but Electron silently keeps the page unless the app asks, so the window just would not close.
// The page reports what is unsaved as it changes, since the objection itself carries no details.
function installUnloadPrompt({ window, dialog, ipcMain, isQuitting }) {
  let closing = false;
  let unsaved = [];
  ipcMain.removeAllListeners(UNSAVED_CHANGES_CHANNEL);
  ipcMain.on(UNSAVED_CHANGES_CHANNEL, (event, labels) => {
    if (window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return;
    unsaved = cleanUnsavedChanges(labels);
  });
  // A new document starts with nothing unsaved and reports its own changes.
  window.webContents.on('did-navigate', () => { unsaved = []; });
  // 'close' comes before the page's beforeunload, so it tells a close from a reload or a navigation.
  window.on('close', () => { closing = true; });
  window.webContents.on('will-prevent-unload', (event) => {
    const forClose = closing;
    closing = false;
    // Quitting has already stopped the desktop proxy, so the page could not keep working anyway.
    if (isQuitting() || dialog.showMessageBoxSync(window, unloadPromptOptions(forClose, unsaved)) === DISCARD) event.preventDefault();
  });
}

module.exports = { installUnloadPrompt, unloadPromptOptions, UNSAVED_CHANGES_CHANNEL };

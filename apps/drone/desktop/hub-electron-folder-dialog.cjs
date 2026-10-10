const FOLDER_DIALOG_CHANNEL = 'drone-hub:choose-folder';

// Settings → Workspaces asks for a folder on this computer. Only Drone Hub's own pages may open the dialog, and it
// returns the chosen path (or null), never anything about the filesystem beyond that.
function installFolderDialog({ ipcMain, BrowserWindow, dialog, isTrustedSender }) {
  ipcMain.removeHandler(FOLDER_DIALOG_CHANNEL);
  ipcMain.handle(FOLDER_DIALOG_CHANNEL, async (event, options) => {
    if (!isTrustedSender(event)) throw new Error('Choosing a folder is only available to Drone Hub.');
    const owner = BrowserWindow.fromWebContents(event.sender);
    const title = typeof options?.title === 'string' && options.title.length <= 200 ? options.title : 'Choose a folder';
    const defaultPath = typeof options?.defaultPath === 'string' && options.defaultPath.length <= 4096 ? options.defaultPath : undefined;
    const settings = { title, ...(defaultPath ? { defaultPath } : {}), properties: ['openDirectory', 'createDirectory'] };
    // Without a window the options must come first: Electron reads a leading undefined as the options.
    const result = owner ? await dialog.showOpenDialog(owner, settings) : await dialog.showOpenDialog(settings);
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  });
}

module.exports = { installFolderDialog, FOLDER_DIALOG_CHANNEL };

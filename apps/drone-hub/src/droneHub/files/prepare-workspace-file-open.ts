import { readDesktopFile } from './read-desktop-file';

export type InitialFileRead = ReturnType<typeof readDesktopFile>;

// A successful file read is sufficient to identify a file. Directory lookup
// remains necessary on read errors, including links to extensionless folders.
export async function prepareWorkspaceFileOpen(
  read: () => InitialFileRead,
  isDirectory: () => Promise<boolean>,
): Promise<{ directory: boolean; initialRead: InitialFileRead }> {
  const initialRead = read();
  const directory = isDirectory().catch(() => false);
  const resolved = await Promise.race([
    directory,
    initialRead.then(() => false, () => directory),
  ]);
  return { directory: resolved, initialRead };
}
